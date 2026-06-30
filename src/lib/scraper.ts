/**
 * Google Maps business scraper using Patchright (Playwright fork).
 *
 * THREE-PHASE ARCHITECTURE:
 *   Phase 1 (collect): Scroll the results feed, extract cards, save leads
 *     immediately with basic data (name, rating, category, placeUrl).
 *   Phase 2 (enrich): Open each place's URL for phone/website/address.
 *     Save enriched data immediately. Leads appear in DB FAST.
 *   Phase 3 (reviews): Open each place's URL with !9m1!1b1 for reviews.
 *     Only runs if extractReviews=true. Does NOT block core data.
 *
 * If the job is cancelled during Phase 3, all leads still have core data.
 *
 * ANTI-BOT:
 *  - Patchright patches Runtime.enable leak + Console.enable leak
 *  - 3 retry attempts for feed loading with exponential backoff
 *  - Warmup navigation (google.com → maps) to look human
 *  - Auto-proxy fallback: if direct fails, retry with proxy
 *  - Random delays between all actions
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'patchright'
import { ProxyRotator, type ParsedProxy } from './proxy'

export interface ScrapedLead {
  placeId: string
  businessName: string
  address?: string
  phone?: string
  website?: string
  placeUrl?: string
  category?: string
  rating?: number
  reviewsCount?: number
  priceLevel?: string
  lat?: number
  lng?: number
  businessStatus?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  detailUrl?: string
  reviews?: Review[]
}

export interface Review {
  authorName: string
  rating: number
  text: string
  relativeDate?: string
}

export interface ScrapeOptions {
  query: string
  location: string
  maxResults: number
  proxyRotator?: ProxyRotator
  onProgress?: (phase: 'collect' | 'enrich' | 'reviews', count: number, total: number) => void
  onLead?: (lead: ScrapedLead) => void
  shouldCancel?: () => boolean
  shouldPause?: () => boolean
  headless?: boolean
  concurrency?: number
  extractReviews?: boolean  // default: true
}

export interface ScrapeResult {
  leads: ScrapedLead[]
  error?: string
  blocked?: boolean
}

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jitter = (min: number, max: number) => min + Math.random() * (max - min)

export async function scrapeGoogleMaps(opts: ScrapeOptions): Promise<ScrapeResult> {
  const {
    query,
    location,
    maxResults,
    proxyRotator,
    onProgress,
    onLead,
    shouldCancel,
    shouldPause,
    headless = true,
    concurrency = 3,
    extractReviews = true,
  } = opts

  if (!query || !location) {
    return { leads: [], error: 'query and location are required' }
  }

  const proxy = proxyRotator?.next() ?? null
  let browser: Browser | null = null

  try {
    browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    })

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: DEFAULT_UA,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { latitude: 39.0458, longitude: -76.6413 },
      permissions: ['geolocation'],
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      ...(proxy
        ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } }
        : {}),
    })

    await context.addCookies([
      { name: 'goog-lr', value: 'lang_en', domain: '.google.com', path: '/' },
    ])

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    })

    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.setDefaultNavigationTimeout(60_000)

    // === WARMUP: Visit google.com first to establish a session ===
    // This makes the subsequent Maps navigation look more human
    try {
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15_000 })
      await sleep(jitter(1500, 2500))
    } catch {
      // If warmup fails, continue anyway
    }

    // === PHASE 1: COLLECT — Load search results + scroll feed ===
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(
      `${query} ${location}`
    )}?hl=en&gl=us`

    // Retry feed loading up to 3 times with exponential backoff
    let feedLoaded = false
    let lastError = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (shouldCancel?.()) break

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await sleep(jitter(2000, 3000))

        // Handle EU consent banner
        try {
          const consentBtn = page.locator('button:has-text("Accept all"), button:has-text("Reject all")').first()
          if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await consentBtn.click()
            await sleep(800)
          }
        } catch { /* ignore */ }

        // Wait for feed
        await page.waitForSelector('[role="feed"]', { timeout: 20_000 })
        feedLoaded = true
        break
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        console.log(`[scraper] feed load attempt ${attempt}/3 failed: ${lastError.slice(0, 100)}`)

        // Check if blocked
        const bodyText = await page.content().catch(() => '')
        if (/unusual traffic|captcha|detected unusual/i.test(bodyText)) {
          return {
            leads: [],
            blocked: true,
            error: 'Google detected unusual traffic. The worker IP may be rate-limited. Try using a proxy or wait 10-30 minutes.',
          }
        }

        if (attempt < 3) {
          const backoff = attempt * 5000  // 5s, 10s
          console.log(`[scraper] retrying in ${backoff / 1000}s...`)
          await sleep(backoff)
        }
      }
    }

    if (!feedLoaded) {
      await context.close()
      return {
        leads: [],
        error: `Google Maps results feed did not load after 3 attempts. ${lastError ? `Last error: ${lastError.slice(0, 100)}` : ''} Try enabling a proxy or wait 10-30 minutes for the rate limit to reset.`,
      }
    }

    // Scroll + collect all leads
    const collectedLeads = await scrollAndCollect(page, {
      maxResults,
      onProgress: (count) => onProgress?.('collect', count, maxResults),
      shouldCancel,
      shouldPause,
    })

    // Save each collected lead immediately with basic data
    for (const lead of collectedLeads) {
      onLead?.(lead)
    }

    // === PHASE 2: ENRICH — Open each place URL for phone/website/address ===
    if (collectedLeads.length > 0) {
      onProgress?.('enrich', 0, collectedLeads.length)
      let enrichedCount = 0

      for (let i = 0; i < collectedLeads.length; i += concurrency) {
        if (shouldCancel?.()) break
        while (shouldPause?.()) { await sleep(2000); if (shouldCancel?.()) break }
        if (shouldCancel?.()) break

        const batch = collectedLeads.slice(i, i + concurrency)
        const batchResults = await Promise.allSettled(
          batch.map(async (lead) => {
            if (lead.phone && lead.website && lead.address) return lead
            try {
              await enrichLead(context, lead, false)  // false = no reviews yet
              return lead
            } catch { return lead }
          })
        )

        for (const result of batchResults) {
          if (result.status === 'fulfilled') onLead?.(result.value)
          enrichedCount++
          onProgress?.('enrich', enrichedCount, collectedLeads.length)
        }
        await sleep(jitter(300, 600))
      }
    }

    // === PHASE 3: REVIEWS — Only if enabled, after all core data saved ===
    if (extractReviews && collectedLeads.length > 0 && !shouldCancel?.()) {
      onProgress?.('reviews', 0, collectedLeads.length)
      let reviewsCount = 0

      for (let i = 0; i < collectedLeads.length; i += concurrency) {
        if (shouldCancel?.()) break
        while (shouldPause?.()) { await sleep(2000); if (shouldCancel?.()) break }
        if (shouldCancel?.()) break

        const batch = collectedLeads.slice(i, i + concurrency)
        const batchResults = await Promise.allSettled(
          batch.map(async (lead) => {
            try {
              await enrichLead(context, lead, true)  // true = reviews only
              return lead
            } catch { return lead }
          })
        )

        for (const result of batchResults) {
          if (result.status === 'fulfilled') onLead?.(result.value)
          reviewsCount++
          onProgress?.('reviews', reviewsCount, collectedLeads.length)
        }
        await sleep(jitter(300, 600))
      }
    }

    await context.close()
    return { leads: collectedLeads }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { leads: [], error: msg }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

/**
 * Scroll the Google Maps results feed and collect business entries.
 */
async function scrollAndCollect(
  page: Page,
  opts: {
    maxResults: number
    onProgress?: (n: number) => void
    shouldCancel?: () => boolean
    shouldPause?: () => boolean
  }
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = []
  const seenPlaceIds = new Set<string>()
  let stableCount = 0
  const maxStableIterations = 6

  const feed = page.locator('[role="feed"]').first()

  for (let iter = 0; iter < 500 && leads.length < opts.maxResults; iter++) {
    if (opts.shouldCancel?.()) break
    while (opts.shouldPause?.()) { await sleep(2000); if (opts.shouldCancel?.()) break }
    if (opts.shouldCancel?.()) break

    const newLeads = await extractLeadsFromFeed(page, Array.from(seenPlaceIds))
    for (const lead of newLeads) {
      if (leads.length >= opts.maxResults) break
      leads.push(lead)
      seenPlaceIds.add(lead.placeId)
    }

    opts.onProgress?.(leads.length)

    if (newLeads.length === 0) {
      stableCount++
      if (stableCount >= maxStableIterations) break
    } else {
      stableCount = 0
    }

    try {
      await feed.evaluate((el: HTMLElement) => {
        el.scrollBy({ top: el.clientHeight * 2, behavior: 'smooth' })
      })
    } catch {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
    }

    await sleep(jitter(700, 1500))
  }

  return leads
}

/**
 * Extract leads from the currently-visible Google Maps results feed.
 */
async function extractLeadsFromFeed(
  page: Page,
  seenPlaceIds: string[]
): Promise<ScrapedLead[]> {
  return await page.evaluate(
    (seen) => {
      const results: any[] = []
      const feed = document.querySelector('[role="feed"]')
      if (!feed) return results

      const cards = feed.querySelectorAll('a[role="article"], [role="article"]')
      cards.forEach((card) => {
        const el = card as HTMLElement
        const text = (el.innerText || '').trim()
        if (!text) return

        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
        const businessName = (el.getAttribute('aria-label') || lines[0] || '').trim()
        if (!businessName || businessName.length < 2) return

        const anchor = el.tagName === 'A' ? el : el.querySelector('a')
        const href = anchor?.getAttribute('href') || ''
        const detailUrl = href.startsWith('http') ? href : (href ? `https://www.google.com${href}` : '')
        let placeId = ''
        const cidMatch = href.match(/0x[0-9a-f]+:0x[0-9a-f]+/)
        if (cidMatch) placeId = cidMatch[0]
        else {
          const coordMatch = href.match(/@(-?\d+\.\d+),(-?\d+\.\d+),/)
          if (coordMatch) placeId = `coord:${coordMatch[1]},${coordMatch[2]}`
        }
        if (!placeId) {
          const stableText = [businessName, ...lines.slice(1, 4)].join('|')
          placeId = `name:${stableText.slice(0, 120)}`
        }
        if (seen.includes(placeId)) return

        let rating: number | undefined
        let reviewsCount: number | undefined
        let category: string | undefined
        let priceLevel: string | undefined
        let businessStatus: string | undefined
        let address: string | undefined

        for (const line of lines.slice(1, 10)) {
          if (rating !== undefined) break
          const m1 = line.match(/(\d\.\d)\s*[\(]?\s*(\d[\d,]*)\s*[\)]?/)
          if (m1) {
            rating = parseFloat(m1[1])
            reviewsCount = parseInt(m1[2].replace(/,/g, ''), 10)
            break
          }
          const m2 = line.match(/^[★\s]*(\d\.\d)\s*$/)
          if (m2) { rating = parseFloat(m2[1]); break }
        }

        for (const line of lines.slice(1, 10)) {
          if (/·/.test(line)) {
            const parts = line.split('·').map((p) => p.trim()).filter(Boolean)
            for (const part of parts) {
              if (/^\d\.\d/.test(part)) continue
              if (/^\$\d?$/.test(part) || /^\${1,4}$/.test(part)) {
                if (!priceLevel) priceLevel = part
              } else if (!category && !/open|closes|opens|closed|temporarily|permanently/i.test(part)) {
                category = part
              }
            }
            continue
          }
          if (/open|closes|opens|closed|temporarily|permanently/i.test(line)) {
            if (!businessStatus) businessStatus = line
            continue
          }
          if (/\d+\s+[A-Z]/.test(line) || /\b[A-Z]{2}\s+\d{5}\b/.test(line)) {
            if (!address) address = line
          }
        }

        let lat: number | undefined
        let lng: number | undefined
        const innerHtml = el.innerHTML
        const coordMatch = innerHtml.match(/(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/)
        if (coordMatch) { lat = parseFloat(coordMatch[1]); lng = parseFloat(coordMatch[2]) }

        let phone: string | undefined
        const phoneEl = el.querySelector('[data-item-id^="phone:"]') as HTMLElement | null
        if (phoneEl) {
          const raw = phoneEl.getAttribute('data-item-id') || ''
          let digits = raw.replace(/^phone:/, '').trim()
          if (!digits) digits = (phoneEl.innerText || '').trim().replace(/^tel:/, '').trim()
          digits = digits.replace(/^tel:/, '').trim()
          if (digits) {
            const usMatch = digits.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/)
            phone = usMatch ? `+1 ${usMatch[1]}-${usMatch[2]}-${usMatch[3]}` : digits
          }
        }

        let website: string | undefined
        const websiteEl = el.querySelector('[data-item-id="authority"]') as HTMLElement | null
        if (websiteEl) {
          let url = websiteEl.getAttribute('href') || ''
          if (url.startsWith('/url?q=')) url = new URL(url, location.origin).searchParams.get('q') || url
          website = url || undefined
        }

        results.push({
          placeId, businessName: businessName.trim(), rating, reviewsCount,
          category, priceLevel, businessStatus, address, phone, website,
          lat, lng, detailUrl, placeUrl: detailUrl,
        })
      })
      return results
    },
    seenPlaceIds
  )
}

/**
 * Enrich a lead by navigating to its Google Maps place URL.
 * If reviewsOnly=true, only extract reviews (core data already saved).
 * If reviewsOnly=false, extract phone/website/address/rating (no reviews).
 */
async function enrichLead(
  context: BrowserContext,
  lead: ScrapedLead,
  reviewsOnly: boolean
): Promise<void> {
  if (!lead.detailUrl) return

  const page = await context.newPage()
  try {
    let targetUrl = lead.detailUrl

    if (reviewsOnly) {
      // Append !9m1!1b1 to open reviews panel directly
      if (!targetUrl.includes('!9m1!1b1')) {
        const qIdx = targetUrl.indexOf('?')
        targetUrl = qIdx > 0
          ? targetUrl.slice(0, qIdx) + '!9m1!1b1' + targetUrl.slice(qIdx)
          : targetUrl + '!9m1!1b1'
      }
    }

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await sleep(jitter(1500, 2500))

    if (!reviewsOnly) {
      // Phase 2: Extract phone/website/address/rating
      await page
        .waitForSelector('[data-item-id^="phone:"], [data-item-id="authority"], [data-item-id="address"]', { timeout: 8_000 })
        .catch(() => {})

      const detail = await page.evaluate(() => {
        let phone: string | undefined
        let website: string | undefined
        let address: string | undefined
        let rating: number | undefined
        let reviewsCount: number | undefined

        const phoneEl = document.querySelector('[data-item-id^="phone:"]') as HTMLElement | null
        if (phoneEl) {
          const raw = phoneEl.getAttribute('data-item-id') || ''
          let digits = raw.replace(/^phone:/, '').trim()
          if (!digits) digits = (phoneEl.innerText || '').trim().replace(/^tel:/, '').trim()
          digits = digits.replace(/^tel:/, '').trim()
          if (digits) {
            const usMatch = digits.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/)
            phone = usMatch ? `+1 ${usMatch[1]}-${usMatch[2]}-${usMatch[3]}` : digits
          }
        }

        const websiteEl = document.querySelector('[data-item-id="authority"]') as HTMLElement | null
        if (websiteEl) {
          let href = websiteEl.getAttribute('href') || ''
          if (href.startsWith('/url?q=')) href = new URL(href, location.origin).searchParams.get('q') || href
          website = href || undefined
        }

        const addrEl = document.querySelector('[data-item-id="address"]') as HTMLElement | null
        if (addrEl) address = addrEl.innerText?.trim()

        const ratingEls = document.querySelectorAll('[aria-label*="out of 5"], [aria-label*="stars"]')
        for (const el of Array.from(ratingEls)) {
          const label = el.getAttribute('aria-label') || ''
          const m = label.match(/(\d\.?\d?)\s*(?:out of|stars?)?\s*5?.*?(\d[\d,]*)\s*review/i)
          if (m) { rating = parseFloat(m[1]); reviewsCount = parseInt(m[2].replace(/,/g, ''), 10); break }
          const m2 = label.match(/(\d\.?\d?)\s*(?:out of|stars?)?\s*5/i)
          if (m2) { rating = parseFloat(m2[1]); break }
        }

        if (rating === undefined) {
          const bodyText = document.body.innerText || ''
          const m = bodyText.match(/(\d\.\d)\s*\(?\s*(\d[\d,]*)\s*\)?\s*review/i)
          if (m) { rating = parseFloat(m[1]); reviewsCount = parseInt(m[2].replace(/,/g, ''), 10) }
        }

        return { phone, website, address, rating, reviewsCount }
      })

      if (detail.phone && !lead.phone) lead.phone = detail.phone
      if (detail.website && !lead.website) lead.website = detail.website
      if (detail.address && !lead.address) lead.address = detail.address
      if (detail.rating !== undefined && lead.rating === undefined) lead.rating = detail.rating
      if (detail.reviewsCount !== undefined && lead.reviewsCount === undefined) lead.reviewsCount = detail.reviewsCount

      if (detail.address) {
        const parsed = parseAddress(detail.address)
        if (parsed.city) lead.city = parsed.city
        if (parsed.state) lead.state = parsed.state
        if (parsed.zip) lead.zip = parsed.zip
      }
    } else {
      // Phase 3: Extract reviews only
      lead.reviews = await extractReviews(page, 5)
    }
  } finally {
    await page.close().catch(() => {})
  }
}

/**
 * Extract up to `maxReviews` reviews. RPC first, DOM fallback.
 */
async function extractReviews(page: Page, maxReviews: number): Promise<Review[]> {
  try {
    const rpcReviews = await extractReviewsViaRPC(page, maxReviews)
    if (rpcReviews.length > 0) return rpcReviews
  } catch { /* fall through */ }
  try {
    return await extractReviewsFromDOM(page, maxReviews)
  } catch { return [] }
}

async function extractReviewsViaRPC(page: Page, maxReviews: number): Promise<Review[]> {
  const currentUrl = page.url()
  const placeIdMatch = currentUrl.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/)
  if (!placeIdMatch) return []
  const placeId = placeIdMatch[1]

  const pageSize = Math.min(20, Math.max(maxReviews, 10))
  const requestId = Math.random().toString(36).slice(2, 23)
  const pb = [
    `!1m6!1s${encodeURIComponent(placeId)}`,
    '!6m4!4m1!1e1!4m1!1e3',
    `!2m2!1i${pageSize}!2s`,
    `!5m2!1s${requestId}!7e81`,
    '!8m9!2b1!3b1!5b1!7b1',
    '!12m4!1b1!2b1!4m1!1e1!11m0!13m1!1e1',
  ].join('')
  const rpcUrl = `https://www.google.com/maps/rpc/listugcposts?authuser=0&hl=en&pb=${pb}`

  const result = await page.evaluate(async (url: string) => {
    try {
      const r = await fetch(url, { credentials: 'include' })
      if (!r.ok) return null
      return await r.text()
    } catch { return null }
  }, rpcUrl)
  if (!result) return []

  const clean = result.replace(/^\)\]\}'\s*\n/, '')
  let parsed: unknown[]
  try { parsed = JSON.parse(clean) } catch { return [] }

  const reviewList = Array.isArray(parsed?.[2]) ? (parsed as unknown[])[2] as unknown[] : []
  const out: Review[] = []
  for (const entry of reviewList) {
    try {
      const rev = (entry as unknown[])[0] as unknown
      const authorName = String(
        ((rev as unknown[][])?.[1]?.[0] as unknown[])?.[0] ||
        (rev as unknown[][])?.[1]?.[0]?.[4] || ''
      )
      const rating = Number((rev as unknown[])?.[2]) || 0
      const text = String(
        ((rev as unknown[])?.[3] as unknown[])?.[0] ||
        (rev as unknown[])?.[3] || ''
      )
      const relativeDate = String((rev as unknown[][])?.[1]?.[0]?.[8] || '')
      if (authorName && (text || rating > 0)) {
        out.push({
          authorName: authorName.slice(0, 200), rating,
          text: text.slice(0, 1000),
          relativeDate: relativeDate.slice(0, 50),
        })
      }
      if (out.length >= maxReviews) break
    } catch { continue }
  }
  return out
}

async function extractReviewsFromDOM(page: Page, maxReviews: number): Promise<Review[]> {
  await page.waitForSelector('[data-review-id]', { timeout: 5000 }).catch(() => {})

  return await page.evaluate((max: number) => {
    const out: Array<{ authorName: string; rating: number; text: string; relativeDate: string }> = []
    const cards = document.querySelectorAll('[data-review-id]')
    cards.forEach((card) => {
      const el = card as HTMLElement
      if (out.length >= max) return
      try {
        const authorSel = ['.d4r55', '.WNxzHc', '.TSUbDb a', 'button.al6Kxe', '.bHrnEe']
        let authorName = ''
        for (const sel of authorSel) {
          const n = el.querySelector(sel)
          if (n?.textContent?.trim()) { authorName = n.textContent.trim(); break }
        }

        let rating = 0
        const ratingEl = el.querySelector('[role="img"][aria-label*="star"], [aria-label*="out of 5"]') as HTMLElement | null
        if (ratingEl) {
          const label = ratingEl.getAttribute('aria-label') || ''
          const m = label.match(/(\d+(?:\.\d+)?)/)
          if (m) rating = Math.round(parseFloat(m[1]))
        }

        const textSel = ['.wiI7pd', '.MyEned span', '.Jtu6Td span']
        let text = ''
        for (const sel of textSel) {
          const t = el.querySelector(sel)
          if (t?.textContent?.trim()) { text = t.textContent.trim(); break }
        }

        const dateSel = ['.rsqaWe', '.DU9Pgb', '.tTVLSc', '.dehysf']
        let relativeDate = ''
        for (const sel of dateSel) {
          const d = el.querySelector(sel)
          if (d?.textContent?.trim()) { relativeDate = d.textContent.trim(); break }
        }

        if (authorName && (text || rating > 0)) {
          out.push({
            authorName: authorName.slice(0, 200), rating,
            text: text.slice(0, 1000), relativeDate: relativeDate.slice(0, 50),
          })
        }
      } catch { /* skip */ }
    })
    return out
  }, maxReviews)
}

interface ParsedAddress {
  city?: string
  state?: string
  zip?: string
  country?: string
}

export function parseAddress(address: string): ParsedAddress {
  const result: ParsedAddress = {}
  const us = address.match(/,\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/)
  if (us) {
    result.city = us[1].trim()
    result.state = us[2]
    result.zip = us[3]
    result.country = 'US'
  }
  const stateZip = address.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/)
  if (stateZip && !result.state) {
    result.state = stateZip[1]
    result.zip = stateZip[2]
    result.country = 'US'
  }
  return result
}
