/**
 * Google Maps business scraper using Playwright.
 *
 * Strategy:
 *  1. Open https://www.google.com/maps/search/{query}+{location}
 *  2. Wait for the results feed `[role="feed"]`
 *  3. Auto-scroll the feed until we hit maxResults or no new results load
 *  4. For each result, extract business fields via DOM scraping
 *  5. Optionally click into each result to fetch phone + website (slower)
 *
 * Anti-bot:
 *  - Stealth: realistic user-agent, viewport, locale, timezone
 *  - Random delays between scrolls and between clicks
 *  - Optional proxy rotation (one proxy per browser context)
 *  - If Google shows a captcha / "unusual traffic", abort and report
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'patchright'
import { ProxyRotator, type ParsedProxy } from './proxy'

export interface ScrapedLead {
  placeId: string
  businessName: string
  address?: string
  phone?: string
  website?: string
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
  // Slow path: open each result panel to fetch phone + website. ~3s per result.
  deepScrape?: boolean
  onProgress?: (count: number, total: number) => void
  shouldCancel?: () => boolean
  headless?: boolean
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
    deepScrape = true,
    onProgress,
    shouldCancel,
    headless = true,
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

    // Force Google cookies to English/US — prevents Chinese category names like 牙醫
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
      // Overwrite the `plugins` and `languages` properties.
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
    } catch (e) {
      // Retry once with longer timeout
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
      // Maybe blocked — check for captcha
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

    // Auto-scroll the feed until we have maxResults or no new results
    const leads = await scrollAndCollect(page, {
      maxResults,
      onProgress,
      shouldCancel,
    })

    if (deepScrape && leads.length > 0) {
      onProgress?.(0, leads.length)
      for (let i = 0; i < leads.length; i++) {
        if (shouldCancel?.()) break
        // Skip if we already have both phone + website from the card
        if (leads[i].phone && leads[i].website) {
          onProgress?.(i + 1, leads.length)
          continue
        }
        try {
          // Add a per-lead timeout so one hanging card doesn't block the whole job
          await Promise.race([
            enrichLead(page, i, leads[i]),
            new Promise((resolve) => setTimeout(resolve, 15_000)), // 15s max per lead
          ])
        } catch (e) {
          // ignore individual failures
        }
        onProgress?.(i + 1, leads.length)
        await sleep(jitter(400, 800))
      }
    }

    await context.close()
    return { leads }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { leads: [], error: msg }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

/**
 * Scroll the Google Maps results feed and collect business entries.
 * Uses robust selectors based on aria roles, not brittle XPaths.
 */
async function scrollAndCollect(
  page: Page,
  opts: { maxResults: number; onProgress?: (n: number, total: number) => void; shouldCancel?: () => boolean }
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = []
  const seenPlaceIds = new Set<string>()
  let stableCount = 0
  const maxStableIterations = 6 // give up after 6 scrolls with no new results

  const feed = page.locator('[role="feed"]').first()

  for (let iter = 0; iter < 200 && leads.length < opts.maxResults; iter++) {
    if (opts.shouldCancel?.()) break

    // Extract current visible results
    const newLeads = await extractLeadsFromFeed(page, Array.from(seenPlaceIds))
    for (const lead of newLeads) {
      if (leads.length >= opts.maxResults) break
      leads.push(lead)
      seenPlaceIds.add(lead.placeId)
    }

    opts.onProgress?.(leads.length, opts.maxResults)

    if (newLeads.length === 0) {
      stableCount++
      if (stableCount >= maxStableIterations) break
    } else {
      stableCount = 0
    }

    // Scroll feed down
    try {
      await feed.evaluate((el: HTMLElement) => {
        el.scrollBy({ top: el.clientHeight * 2, behavior: 'smooth' })
      })
    } catch {
      // Some Google Maps versions render the feed differently — try scrolling window
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
    }

    await sleep(jitter(700, 1500))
  }

  return leads
}

/**
 * Extract leads from the currently-visible Google Maps results feed.
 * Each result is an `<a role="article">` or similar — we look for the link to the
 * place and parse the visible card text.
 */
async function extractLeadsFromFeed(
  page: Page,
  seenPlaceIds: string[]
): Promise<ScrapedLead[]> {
  // Google Maps renders each result as an `<a>` with role="article" inside the feed.
  // We extract data via DOM evaluation for speed.
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
        // Store the full href for later deep-scrape (navigate directly to place page)
        const detailUrl = href.startsWith('http') ? href : (href ? `https://www.google.com${href}` : '')
        let placeId = ''
        const cidMatch = href.match(/0x[0-9a-f]+:0x[0-9a-f]+/)
        if (cidMatch) placeId = cidMatch[0]
        else {
          const coordMatch = href.match(/@(-?\d+\.\d+),(-?\d+\.\d+),/)
          if (coordMatch) placeId = `coord:${coordMatch[1]},${coordMatch[2]}`
        }
        if (!placeId) {
          // Stable fallback: hash of business name + first 3 lines of text
          // (avoids "Open 24 hours" / "Closes 9 PM" volatility causing dupes)
          const stableText = [businessName, ...lines.slice(1, 4)].join('|')
          placeId = `name:${stableText.slice(0, 120)}`
        }
        if (seen.includes(placeId)) return

        // Parse the visible card text — Google Maps cards have a predictable format:
        // Line 1: Business Name
        // Line 2: ★ rating (reviews) · Category · Price
        // Line 3: Address
        // Sometimes followed by "Open 24 hours", "Closes 9 PM", etc.
        // (lines + businessName already extracted above)

        let rating: number | undefined
        let reviewsCount: number | undefined
        let category: string | undefined
        let priceLevel: string | undefined
        let businessStatus: string | undefined
        let address: string | undefined

        for (const line of lines.slice(1, 8)) {
          const ratingMatch = line.match(/^(\d\.\d)\s*\(?(\d[\d,]*)\)?/)
          if (ratingMatch && rating === undefined) {
            rating = parseFloat(ratingMatch[1])
            reviewsCount = parseInt(ratingMatch[2].replace(/,/g, ''), 10)
            continue
          }
          if (/·/.test(line)) {
            const parts = line.split('·').map((p) => p.trim())
            // First part might be "★ 4.5 (123)" or just rating
            for (const part of parts) {
              const r = part.match(/^(\d\.\d)\s*\(?(\d[\d,]*)\)?/)
              if (r && rating === undefined) {
                rating = parseFloat(r[1])
                reviewsCount = parseInt(r[2].replace(/,/g, ''), 10)
              } else if (/^\$\d?$/.test(part) || /^\${1,4}$/.test(part)) {
                priceLevel = part
              } else if (!category && !/open|closes|opens|closed/i.test(part)) {
                category = part
              }
            }
            continue
          }
          if (/open|closes|opens|closed|temporarily|permanently/i.test(line)) {
            businessStatus = line
            continue
          }
          // Address lines usually contain a street number or city/state/zip
          if (/\d+\s+[A-Z]/.test(line) || /\b[A-Z]{2}\s+\d{5}\b/.test(line)) {
            if (!address) address = line
          }
        }

        // Extract coordinates from any embedded data
        let lat: number | undefined
        let lng: number | undefined
        // Look for data in the card's data attributes or innerHTML
        const innerHtml = el.innerHTML
        const coordMatch = innerHtml.match(/(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/)
        if (coordMatch) {
          lat = parseFloat(coordMatch[1])
          lng = parseFloat(coordMatch[2])
        }

        // Try to extract phone + website from the card itself (faster than deep-scrape)
        let phone: string | undefined
        let website: string | undefined
        // Phone: look for tel: links or data-item-id="phone:..." within the card
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
        // Website: look for data-item-id="authority" within the card
        const websiteEl = el.querySelector('[data-item-id="authority"]') as HTMLElement | null
        if (websiteEl) {
          let href = websiteEl.getAttribute('href') || ''
          if (href.startsWith('/url?q=')) {
            href = new URL(href, location.origin).searchParams.get('q') || href
          }
          website = href || undefined
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
        })
      })
      return results
    },
    Array.from(seenPlaceIds)
  )
}

/**
 * Navigate directly to the place's Google Maps URL to open its detail page,
 * then extract phone + website + address. This is more reliable than clicking
 * cards in the feed (which virtualizes and causes mismatches).
 */
async function enrichLead(page: Page, _index: number, lead: ScrapedLead): Promise<void> {
  if (!lead.detailUrl) return

  // Navigate directly to the place's URL
  try {
    await page.goto(lead.detailUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  } catch {
    return
  }
  await sleep(jitter(1500, 2500))

  // Wait for the detail panel to load
  try {
    await page.waitForSelector('[data-item-id^="phone:"], [data-item-id="authority"], [data-item-id="address"]', { timeout: 8_000 }).catch(() => {})
  } catch {
    // ignore
  }

  // Extract from detail page
  const detail = await page.evaluate(() => {
    let phone: string | undefined
    let website: string | undefined
    let address: string | undefined

    // Phone
    const phoneEl = document.querySelector('[data-item-id^="phone:"]') as HTMLElement | null
    if (phoneEl) {
      const raw = phoneEl.getAttribute('data-item-id') || ''
      // Attribute format is "phone:+13012319100" — strip prefix
      let digits = raw.replace(/^phone:/, '').trim()
      // If attribute is empty, fall back to innerText (which may be "tel:+1...")
      if (!digits) {
        digits = (phoneEl.innerText || '').trim().replace(/^tel:/, '').trim()
      }
      // Also handle case where digits starts with "tel:"
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

    return { phone, website, address }
  })

  if (detail.phone && !lead.phone) lead.phone = detail.phone
  if (detail.website && !lead.website) lead.website = detail.website
  if (detail.address && !lead.address) lead.address = detail.address

  // Parse city/state/zip from address
  if (detail.address) {
    const parsed = parseAddress(detail.address)
    if (parsed.city) lead.city = parsed.city
    if (parsed.state) lead.state = parsed.state
    if (parsed.zip) lead.zip = parsed.zip
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
  // US: "123 Main St, Rockville, MD 20850"
  const us = address.match(/,\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/)
  if (us) {
    result.city = us[1].trim()
    result.state = us[2]
    result.zip = us[3]
    result.country = 'US'
  }
  // Just state + zip
  const stateZip = address.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/)
  if (stateZip && !result.state) {
    result.state = stateZip[1]
    result.zip = stateZip[2]
    result.country = 'US'
  }
  return result
}
