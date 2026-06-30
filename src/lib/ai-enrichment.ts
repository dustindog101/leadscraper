/**
 * Mistral AI owner-name extraction service.
 *
 * Fetches each lead's website, parses the HTML with cheerio, then asks
 * Mistral's free API to extract owner/manager names from the text.
 *
 * Free tier: 1 request per second. We batch with 1.1s delays between calls.
 *
 * Usage:
 *   import { enrichLeadWithOwner } from './ai-enrichment'
 *   const contacts = await enrichLeadWithOwner(lead)
 *   // → [{ name: 'John Smith', title: 'Owner', confidence: 0.8, source: 'llm' }]
 */

import * as cheerio from 'cheerio'

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'
const MISTRAL_MODEL = 'mistral-small-latest'  // Free tier, fast, good enough
const RATE_LIMIT_MS = 1100  // 1 req/sec + 100ms buffer

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

/**
 * Fetch a URL and extract visible text (limited to ~3000 chars for the LLM).
 */
async function fetchWebsiteText(url: string): Promise<string | null> {
  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CybershareLeadScraper/1.0)',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    })
    clearTimeout(timeout)

    if (!res.ok) return null

    const html = await res.text()
    const $ = cheerio.load(html)

    // Remove scripts, styles, noscript
    $('script, style, noscript, svg, head').remove()

    // Try to get text from common content areas first
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

    // Fallback to body text
    if (!text) {
      text = $('body').text().replace(/\s+/g, ' ').trim()
    }

    // Also grab meta tags that might have owner info
    const metaAuthor = $('meta[name="author"]').attr('content')
    if (metaAuthor) text = `Author: ${metaAuthor}\n${text}`

    // Also check for email addresses in the page
    const emailMatches = html.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g)
    if (emailMatches && emailMatches.length > 0) {
      text += `\n\nEmails found: ${emailMatches.slice(0, 5).join(', ')}`
    }

    // Truncate to 3000 chars for the LLM
    return text.slice(0, 3000)
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

  const prompt = `You are a B2B lead enrichment assistant. Extract the business owner, founder, or manager's name from the following website text. Also extract their title and email if available.

Return ONLY a JSON array (no markdown, no explanation). Each object should have: name, title, email, confidence (0-1).

If no owner/manager name is found, return an empty array [].

Website text:
---
${websiteText}
---

Examples:
- "Founded by John Smith in 2015" → [{"name":"John Smith","title":"Founder","email":null,"confidence":0.9}]
- "Contact our manager Jane Doe at jane@example.com" → [{"name":"Jane Doe","title":"Manager","email":"jane@example.com","confidence":0.8}]
- "Welcome to our website" → []`

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
        max_tokens: 300,
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

    // Parse the JSON array from the response
    // Mistral might wrap it in markdown code blocks
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const contacts = JSON.parse(jsonMatch[0]) as Array<{
      name?: string
      title?: string
      email?: string
      confidence?: number
    }>

    return contacts
      .filter((c) => c.name && c.name.length > 2)
      .map((c) => ({
        name: String(c.name).slice(0, 200),
        title: c.title ? String(c.title).slice(0, 100) : undefined,
        email: c.email ? String(c.email).slice(0, 200) : undefined,
        confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
        source: 'llm',
      }))
  } catch (e) {
    console.error('[ai] Mistral extraction failed:', e instanceof Error ? e.message : String(e))
    return []
  }
}

/**
 * Enrich a lead with owner/manager names by fetching their website
 * and asking Mistral AI to extract contact info.
 *
 * @param websiteUrl - The lead's website URL
 * @returns Array of extracted contacts (may be empty)
 */
export async function enrichLeadWithOwner(websiteUrl: string): Promise<ExtractedContact[]> {
  if (!websiteUrl) return []

  // Step 1: Fetch the website text
  const text = await fetchWebsiteText(websiteUrl)
  if (!text || text.length < 50) return []

  // Step 2: Ask Mistral to extract owner names
  const contacts = await extractOwnerViaMistral(text)
  return contacts
}
