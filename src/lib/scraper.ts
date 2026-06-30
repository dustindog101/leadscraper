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
        if (leads[i].phone && leads[i].website) {
          onProgress?.(i + 1, leads.length)
          continue
        }
        try {
          await enrichLead(page, i, leads[i])
        } catch (e) {
          // ignore individual failures
        }
        onProgress?.(i + 1, leads.length)
        await sleep(jitter(400, 1200))
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

        // Place ID: from the href of the anchor (cid=... or 0x... format)
        const anchor = el.tagName === 'A' ? el : el.querySelector('a')
        const href = anchor?.getAttribute('href') || ''
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

        results.push({
          placeId,
          businessName: businessName.trim(),
          rating,
          reviewsCount,
          category,
          priceLevel,
          businessStatus,
          address,
          lat,
          lng,
        })
      })
      return results
    },
    Array.from(seenPlaceIds)
  )
}

/**
 * Click on a result card to open the detail panel, then extract phone + website.
 * Uses business name to find the right card (index-based fails due to feed virtualization).
 */
async function enrichLead(page: Page, _index: number, lead: ScrapedLead): Promise<void> {
  // Close any open detail panel first (the back button or Escape)
  try {
    const backButton = page.locator('[aria-label="Back"]').first()
    if (await backButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await backButton.click({ timeout: 3000 }).catch(() => {})
      await sleep(500)
    } else {
      await page.keyboard.press('Escape').catch(() => {})
      await sleep(300)
    }
  } catch {
    // ignore
  }

  // Find the card matching this lead's business name
  const cards = page.locator('[role="feed"] [role="article"]')
  const count = await cards.count().catch(() => 0)
  if (count === 0) return

  let card = null
  // Try exact match first, then partial match (first 20 chars)
  for (let i = 0; i < count; i++) {
    const c = cards.nth(i)
    const label = await c.getAttribute('aria-label').catch(() => null)
    if (!label) continue
    const labelText = label.trim()
    if (labelText === lead.businessName) {
      card = c
      break
    }
    // Partial match: first 20 chars (handles truncation)
    if (labelText.length >= 20 && lead.businessName.length >= 20) {
      if (labelText.startsWith(lead.businessName.substring(0, 20)) ||
          lead.businessName.startsWith(labelText.substring(0, 20))) {
        card = c
        break
      }
    }
  }

  // If no match found, SKIP enrichment — don't use wrong card's data
  if (!card) {
    return
  }

  // Scroll the card into view before clicking
  await card.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
  await sleep(jitter(200, 500))

  if (!(await card.isVisible().catch(() => false))) return

  await card.click({ timeout: 10_000 }).catch(() => {})
  await sleep(jitter(1000, 2000))

  // Wait for detail panel — Google shows phone + website in buttons with data-item-id
  try {
    await page.waitForSelector('[data-item-id^="phone:"], [data-item-id="authority"]', { timeout: 8_000 }).catch(() => {})
  } catch {
    // ignore
  }

  // Extract from detail panel
  const detail = await page.evaluate(() => {
    let phone: string | undefined
    let website: string | undefined
    let address: string | undefined

    // Phone
    const phoneEl = document.querySelector('[data-item-id^="phone:"]') as HTMLElement | null
    if (phoneEl) {
      const raw = phoneEl.getAttribute('data-item-id') || ''
      // Format is "phone:+13012319100" — strip prefix, keep "+1 301-231-9100" formatted
      const digits = raw.replace(/^phone:/, '').trim()
      if (digits) {
        // Try to format US numbers nicely
        const usMatch = digits.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/)
        if (usMatch) {
          phone = `+1 ${usMatch[1]}-${usMatch[2]}-${usMatch[3]}`
        } else {
          phone = digits
        }
      }
      if (!phone) phone = phoneEl.innerText?.trim()
    }

    // Website
    const websiteEl = document.querySelector('[data-item-id="authority"]') as HTMLElement | null
    if (websiteEl) {
      let href = websiteEl.getAttribute('href') || ''
      // Google sometimes wraps URLs — strip tracking prefixes if present
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

    // Verify we're on the right business — check the H1 in the detail panel
    const h1 = document.querySelector('h1') as HTMLElement | null
    const panelName = h1?.innerText?.trim() || ''

    return { phone, website, address, panelName }
  })

  // Verify the detail panel is showing the right business
  // If the panel name doesn't match the lead, discard the data (wrong card was clicked)
  if (detail.panelName && lead.businessName) {
    const panelLower = detail.panelName.toLowerCase()
    const leadLower = lead.businessName.toLowerCase()
    // Check if either contains the other (handles partial matches)
    if (!panelLower.includes(leadLower.substring(0, Math.min(15, leadLower.length))) &&
        !leadLower.includes(panelLower.substring(0, Math.min(15, panelLower.length)))) {
      // Mismatch — don't use this data
      return
    }
  }

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
