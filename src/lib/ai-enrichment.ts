/**
 * Mistral AI owner-name extraction service.
 *
 * Fetches each lead's website, parses the HTML with cheerio, then asks
 * Mistral's free API to extract owner/manager names from the text.
 *
 * Free tier: 1 request per second. We batch with 1.1s delays between calls.
 *
 * The AI extracts:
 *  - Owner/Founder/Manager name
 *  - Their title (Owner, CEO, Manager, etc.)
 *  - Email addresses found on the page
 *  - Phone numbers found on the page (if different from what we have)
 *  - Social media links (Facebook, Instagram, LinkedIn)
 */

import * as cheerio from 'cheerio'

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'
const MISTRAL_MODEL = 'mistral-small-latest'
const RATE_LIMIT_MS = 1100

let lastRequestTime = 0

async function rateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed)
  }
  lastRequestTime = Date.now()
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export interface ExtractedContact {
  name: string
  title?: string
  email?: string
  confidence: number
  source: string
}

export interface WebsiteEnrichment {
  contacts: ExtractedContact[]
  emails: string[]
  socialLinks: { facebook?: string; instagram?: string; linkedin?: string; twitter?: string }
  description?: string
}

/**
 * Fetch a URL and extract visible text + structured data.
 */
async function fetchWebsiteData(url: string): Promise<{ text: string; emails: string[]; socialLinks: WebsiteEnrichment['socialLinks'] } | null> {
  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    })
    clearTimeout(timeout)

    if (!res.ok) return null

    const html = await res.text()
    const $ = cheerio.load(html)

    $('script, style, noscript, svg, head, nav, footer').remove()

    // Extract emails from the entire HTML
    const emailMatches = html.match(/[\w.+-]+@[\w-]+\.[\w.-]+\.[a-z]{2,}/gi) || []
    const emailMatches2 = html.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) || []
    const allEmails = [...new Set([...emailMatches, ...emailMatches2])]
      .filter((e) => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif'))
      .slice(0, 10)

    // Extract social links
    const socialLinks: WebsiteEnrichment['socialLinks'] = {}
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || ''
      if (href.includes('facebook.com')) socialLinks.facebook = href
      else if (href.includes('instagram.com')) socialLinks.instagram = href
      else if (href.includes('linkedin.com')) socialLinks.linkedin = href
      else if (href.includes('twitter.com') || href.includes('x.com')) socialLinks.twitter = href
    })

    // Get text from main content areas
    const contentSelectors = [
      'main', 'article', '#content', '.content',
      '#about', '.about', '#team', '.team',
      '#staff', '.staff', '#contact', '.contact',
      'section', 'div',
    ]

    let text = ''
    for (const sel of contentSelectors) {
      const el = $(sel).first()
      if (el.length) {
        text = el.text().replace(/\s+/g, ' ').trim()
        if (text.length > 500) break
      }
    }

    if (!text) {
      text = $('body').text().replace(/\s+/g, ' ').trim()
    }

    // Also grab meta tags
    const metaAuthor = $('meta[name="author"]').attr('content')
    if (metaAuthor) text = `Author: ${metaAuthor}\n${text}`

    const metaDescription = $('meta[name="description"]').attr('content')
    if (metaDescription) text = `Description: ${metaDescription}\n${text}`

    return {
      text: text.slice(0, 4000),
      emails: allEmails,
      socialLinks,
    }
  } catch {
    return null
  }
}

/**
 * Ask Mistral AI to extract owner/manager names from website text.
 */
async function extractOwnerViaMistral(websiteText: string): Promise<ExtractedContact[]> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) return []

  await rateLimit()

  const prompt = `You are a B2B sales intelligence assistant. Analyze this business website text and extract the names of people who own, run, or manage the business.

Look for:
- "Founded by John Smith"
- "Owner: Jane Doe"
- "Meet our team" / "Our staff" sections
- "CEO", "President", "Manager", "Director", "Founder", "Owner", "Principal" titles
- Sign-offs like "— John Smith, Owner"
- About page bios

Return ONLY a JSON array (no markdown fences, no explanation). Each object must have:
  name: string (the person's full name)
  title: string (their role: Owner, CEO, Manager, etc.)
  email: string or null (if found)
  confidence: number (0.0 to 1.0 — how sure you are this is a real decision-maker)

If no people are found, return: []

Website text:
---
${websiteText}
---`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const res = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 500,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      console.error(`[ai] Mistral API error: ${res.status} ${res.statusText}`)
      return []
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content || ''

    // Parse JSON — Mistral might wrap in markdown code fences
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const contacts = JSON.parse(jsonMatch[0]) as Array<{
      name?: string
      title?: string
      email?: string
      confidence?: number
    }>

    return contacts
      .filter((c) => c.name && c.name.length > 2 && !c.name.toLowerCase().includes('example'))
      .map((c) => ({
        name: String(c.name).slice(0, 200),
        title: c.title ? String(c.title).slice(0, 100) : undefined,
        email: c.email && c.email !== 'null' ? String(c.email).slice(0, 200) : undefined,
        confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
        source: 'llm',
      }))
  } catch (e) {
    console.error('[ai] Mistral extraction failed:', e instanceof Error ? e.message : String(e))
    return []
  }
}

/**
 * Enrich a lead by fetching their website and extracting:
 *  - Owner/manager names (via Mistral AI)
 *  - Email addresses found on the page
 *  - Social media links
 */
export async function enrichLeadWithOwner(websiteUrl: string): Promise<ExtractedContact[]> {
  if (!websiteUrl) return []

  const data = await fetchWebsiteData(websiteUrl)
  if (!data || data.text.length < 50) return []

  // First, add any emails found on the page as low-confidence contacts
  const contacts: ExtractedContact[] = []

  // Extract owner names via Mistral
  const aiContacts = await extractOwnerViaMistral(data.text)
  contacts.push(...aiContacts)

  // If we found emails on the page but AI didn't return any contacts with emails,
  // try to match emails to names, or add them as generic contacts
  if (data.emails.length > 0) {
    const existingEmails = new Set(contacts.map((c) => c.email?.toLowerCase()).filter(Boolean))
    for (const email of data.emails) {
      if (existingEmails.has(email.toLowerCase())) continue
      // Only add if it looks like a real person email (not info@, contact@, etc.)
      const localPart = email.split('@')[0].toLowerCase()
      if (localPart === 'info' || localPart === 'contact' || localPart === 'support' ||
          localPart === 'admin' || localPart === 'sales' || localPart === 'hello') {
        continue  // Skip generic emails
      }
      // Try to extract a name from the email
      const nameParts = localPart.split(/[._-]/)
      if (nameParts.length >= 2) {
        const name = nameParts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
        contacts.push({
          name,
          email,
          confidence: 0.3,
          source: 'email-extraction',
        })
      }
    }
  }

  return contacts
}

/**
 * Get website enrichment data (emails + social links) without AI.
 * Useful for batch processing or when AI is rate-limited.
 */
export async function getWebsiteEnrichment(websiteUrl: string): Promise<WebsiteEnrichment | null> {
  if (!websiteUrl) return null

  const data = await fetchWebsiteData(websiteUrl)
  if (!data) return null

  return {
    contacts: [],
    emails: data.emails,
    socialLinks: data.socialLinks,
    description: data.text.slice(0, 500),
  }
}
