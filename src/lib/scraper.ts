/**
 * Google Maps business scraper using Patchright (Playwright fork).
 *
 * Strategy:
 *  1. Open https://www.google.com/maps/search/{query}+{location}
 *  2. Wait for the results feed `[role="feed"]`
 *  3. Auto-scroll the feed until we hit maxResults or no new results load
 *  4. For each result, extract business fields via DOM scraping
 *  5. Enrich each lead by navigating directly to its Google Maps place URL
 *
 * Anti-bot:
 *  - Patchright patches Runtime.enable leak + Console.enable leak
 *  - Realistic user-agent, viewport, locale, timezone
 *  - Random delays between scrolls and between navigations
 *  - Optional proxy rotation (one proxy per browser context)
 *  - If Google shows a captcha / "unusual traffic", abort and report
 *
 * Leads are saved to DB immediately as they're enriched (via onLead callback).
 * This means partial results are preserved even if the job is cancelled or
 * the worker crashes.
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
}

export interface ScrapeOptions {
  query: string
  location: string
  maxResults: number
  proxyRotator?: ProxyRotator
  onProgress?: (phase: 'collect' | 'enrich', count: number, total: number) => void
  onLead?: (lead: ScrapedLead) => void  // Called immediately when a lead is ready
  shouldCancel?: () => boolean
  shouldPause?: () => boolean
  headless?: boolean
  concurrency?: number  // Number of leads to enrich in parallel (default: 3)
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
      geolocation: { latitude: 39.0458, longitude: -76.6413 }, // Maryland
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
      ...(proxy
        ? {
            proxy: {
              server: proxy.server,
              username: proxy.username,
              password: proxy.password,
            },
          }
        : {}),
    })

    // Force Google cookies to English/US
    await context.addCookies([
      {
        name: 'goog-lr',
        value: 'lang_en',
        domain: '.google.com',
        path: '/',
      },
    ])

    // Hide webdriver flag
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      })
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      })
    })

    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.setDefaultNavigationTimeout(60_000)

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(
      `${query} ${location}`
    )}?hl=en&gl=us`

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
    } catch {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {})
    }

    // Handle Google consent banner if present (EU)
    try {
      const consentBtn = page.locator('button:has-text("Accept all"), button:has-text("Reject all")').first()
      if (await consentBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await consentBtn.click()
        await sleep(800)
      }
    } catch {
      // ignore
    }

    // Wait for the results feed
    const feedSelector = '[role="feed"]'
    try {
      await page.waitForSelector(feedSelector, { timeout: 30_000 })
    } catch {
      const bodyText = await page.content()
      if (/unusual traffic|captcha|detected unusual/i.test(bodyText)) {
        return {
          leads: [],
          blocked: true,
          error: 'Google detected unusual traffic. Try again later, use a proxy, or reduce rate.',
        }
      }
      return { leads: [], error: 'Google Maps results feed did not load' }
    }

    // Phase 1: Scroll and collect all lead cards (with basic data)
    const collectedLeads = await scrollAndCollect(page, {
      maxResults,
      onProgress: (count) => onProgress?.('collect', count, maxResults),
      shouldCancel,
      shouldPause,
    })

    // Save each collected lead immediately (even without enrichment)
    // so partial results are preserved if the job is cancelled
    for (const lead of collectedLeads) {
      onLead?.(lead)
    }

    // Phase 2: Enrich leads in parallel (navigate to each place's URL for phone/website/address)
    if (collectedLeads.length > 0) {
      onProgress?.('enrich', 0, collectedLeads.length)
      let enrichedCount = 0

      // Process in batches of `concurrency` to avoid opening too many tabs
      for (let i = 0; i < collectedLeads.length; i += concurrency) {
        if (shouldCancel?.()) break

        // Check for pause
        while (shouldPause?.()) {
          await sleep(2000)
          if (shouldCancel?.()) break
        }
        if (shouldCancel?.()) break

        const batch = collectedLeads.slice(i, i + concurrency)
        const batchResults = await Promise.allSettled(
          batch.map(async (lead) => {
            // Skip if already has phone + website from card
            if (lead.phone && lead.website && lead.address) {
              return lead
            }
            try {
              await enrichLead(context, lead)
              return lead
            } catch {
              return lead
            }
          })
        )

        // Re-save enriched leads
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            onLead?.(result.value)
          }
          enrichedCount++
          onProgress?.('enrich', enrichedCount, collectedLeads.length)
        }

        // Small delay between batches
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

  for (let iter = 0; iter < 200 && leads.length < opts.maxResults; iter++) {
    if (opts.shouldCancel?.()) break
    while (opts.shouldPause?.()) {
      await sleep(2000)
      if (opts.shouldCancel?.()) break
    }
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

        // Place ID + detail URL: from the href of the anchor
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

        // Rating extraction — try multiple formats Google Maps uses:
        // "4.5(123)" / "4.5 (123)" / "4.5 · (123)" / "4.5" alone / "Rated 4.5 out of 5"
        for (const line of lines.slice(1, 10)) {
          if (rating !== undefined) break
          // Try: number followed by (count) with optional space/separator
          const m1 = line.match(/(\d\.\d)\s*[\(]?\s*(\d[\d,]*)\s*[\)]?/)
          if (m1) {
            rating = parseFloat(m1[1])
            reviewsCount = parseInt(m1[2].replace(/,/g, ''), 10)
            break
          }
          // Try: just a rating number (no review count)
          const m2 = line.match(/^[★\s]*(\d\.\d)\s*$/)
          if (m2) {
            rating = parseFloat(m2[1])
            break
          }
        }

        // Category + price level + status — parse from lines with · separator
        for (const line of lines.slice(1, 10)) {
          if (/·/.test(line)) {
            const parts = line.split('·').map((p) => p.trim()).filter(Boolean)
            for (const part of parts) {
              // Skip if it's a rating we already captured
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
        if (coordMatch) {
          lat = parseFloat(coordMatch[1])
          lng = parseFloat(coordMatch[2])
        }

        // Try to extract phone from the card itself
        let phone: string | undefined
        const phoneEl = el.querySelector('[data-item-id^="phone:"]') as HTMLElement | null
        if (phoneEl) {
          const raw = phoneEl.getAttribute('data-item-id') || ''
          let digits = raw.replace(/^phone:/, '').trim()
          if (!digits) {
            digits = (phoneEl.innerText || '').trim().replace(/^tel:/, '').trim()
          }
          digits = digits.replace(/^tel:/, '').trim()
          if (digits) {
            const usMatch = digits.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/)
            phone = usMatch ? `+1 ${usMatch[1]}-${usMatch[2]}-${usMatch[3]}` : digits
          }
        }

        // Try to extract website from the card itself
        let website: string | undefined
        const websiteEl = el.querySelector('[data-item-id="authority"]') as HTMLElement | null
        if (websiteEl) {
          let url = websiteEl.getAttribute('href') || ''
          if (url.startsWith('/url?q=')) {
            url = new URL(url, location.origin).searchParams.get('q') || url
          }
          website = url || undefined
        }

        results.push({
          placeId,
          businessName: businessName.trim(),
          rating,
          reviewsCount,
          category,
          priceLevel,
          businessStatus,
          address,
          phone,
          website,
          lat,
          lng,
          detailUrl,
          placeUrl: detailUrl,
        })
      })
      return results
    },
    seenPlaceIds
  )
}

/**
 * Navigate directly to the place's Google Maps URL to open its detail page,
 * then extract phone + website + address. Uses a new page (tab) so the
 * main feed page is preserved for concurrent enrichment.
 */
async function enrichLead(context: BrowserContext, lead: ScrapedLead): Promise<void> {
  if (!lead.detailUrl) return

  const page = await context.newPage()
  try {
    await page.goto(lead.detailUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await sleep(jitter(1500, 2500))

    // Wait for detail panel elements
    await page
      .waitForSelector('[data-item-id^="phone:"], [data-item-id="authority"], [data-item-id="address"]', { timeout: 8_000 })
      .catch(() => {})

    const detail = await page.evaluate(() => {
      let phone: string | undefined
      let website: string | undefined
      let address: string | undefined
      let rating: number | undefined
      let reviewsCount: number | undefined

      // Phone
      const phoneEl = document.querySelector('[data-item-id^="phone:"]') as HTMLElement | null
      if (phoneEl) {
        const raw = phoneEl.getAttribute('data-item-id') || ''
        let digits = raw.replace(/^phone:/, '').trim()
        if (!digits) {
          digits = (phoneEl.innerText || '').trim().replace(/^tel:/, '').trim()
        }
        digits = digits.replace(/^tel:/, '').trim()
        if (digits) {
          const usMatch = digits.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/)
          phone = usMatch ? `+1 ${usMatch[1]}-${usMatch[2]}-${usMatch[3]}` : digits
        }
      }

      // Website
      const websiteEl = document.querySelector('[data-item-id="authority"]') as HTMLElement | null
      if (websiteEl) {
        let href = websiteEl.getAttribute('href') || ''
        if (href.startsWith('/url?q=')) {
          href = new URL(href, location.origin).searchParams.get('q') || href
        }
        website = href || undefined
      }

      // Address
      const addrEl = document.querySelector('[data-item-id="address"]') as HTMLElement | null
      if (addrEl) {
        address = addrEl.innerText?.trim()
      }

      // Rating + reviews count — try aria-label first (most reliable)
      // Google Maps uses: aria-label="Rated 4.5 out of 5, 123 reviews"
      const ratingEls = document.querySelectorAll('[aria-label*="out of 5"], [aria-label*="stars"]')
      for (const el of Array.from(ratingEls)) {
        const label = el.getAttribute('aria-label') || ''
        const m = label.match(/(\d\.?\d?)\s*(?:out of|stars?)?\s*5?.*?(\d[\d,]*)\s*review/i)
        if (m) {
          rating = parseFloat(m[1])
          reviewsCount = parseInt(m[2].replace(/,/g, ''), 10)
          break
        }
        const m2 = label.match(/(\d\.?\d?)\s*(?:out of|stars?)?\s*5/i)
        if (m2) {
          rating = parseFloat(m2[1])
          break
        }
      }

      // Fallback: look for rating in the page text
      if (rating === undefined) {
        const bodyText = document.body.innerText || ''
        // "4.5(123 reviews)" or "4.5 (123)" or "4.5 stars 123 reviews"
        const m = bodyText.match(/(\d\.\d)\s*\(?\s*(\d[\d,]*)\s*\)?\s*review/i)
        if (m) {
          rating = parseFloat(m[1])
          reviewsCount = parseInt(m[2].replace(/,/g, ''), 10)
        }
      }

      return { phone, website, address, rating, reviewsCount }
    })

    if (detail.phone && !lead.phone) lead.phone = detail.phone
    if (detail.website && !lead.website) lead.website = detail.website
    if (detail.address && !lead.address) lead.address = detail.address
    if (detail.rating !== undefined && lead.rating === undefined) lead.rating = detail.rating
    if (detail.reviewsCount !== undefined && lead.reviewsCount === undefined) lead.reviewsCount = detail.reviewsCount

    // Parse city/state/zip from address
    if (detail.address) {
      const parsed = parseAddress(detail.address)
      if (parsed.city) lead.city = parsed.city
      if (parsed.state) lead.state = parsed.state
      if (parsed.zip) lead.zip = parsed.zip
    }
  } finally {
    await page.close().catch(() => {})
  }
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
