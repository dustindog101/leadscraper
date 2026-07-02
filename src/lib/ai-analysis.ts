/**
 * AI-powered lead analysis using Mistral AI.
 *
 * Features:
 * 1. Lead scoring — rates lead quality based on reviews + website status
 * 2. Cold outreach email generation — personalized email using review themes
 * 3. Review sentiment analysis — extracts positive/negative themes from reviews
 */

import type { Review } from './scraper'

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

async function callMistral(prompt: string, maxTokens = 500): Promise<string | null> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) return null

  await rateLimit()

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
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      console.error(`[ai] Mistral API error: ${res.status} ${res.statusText}`)
      return null
    }

    const data = await res.json()
    return data?.choices?.[0]?.message?.content || ''
  } catch (e) {
    console.error('[ai] Mistral call failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}

export interface LeadScore {
  score: number  // 0-100
  reason: string
  recommendation: string
}

/**
 * Score a lead based on its data + reviews.
 * Higher score = better prospect for cybershare.tech (needs a website).
 */
export async function scoreLead(params: {
  businessName: string
  category?: string | null
  rating?: number | null
  reviewsCount?: number | null
  hasWebsite: boolean
  city?: string | null
  reviews?: Review[]
}): Promise<LeadScore | null> {
  const { businessName, category, rating, reviewsCount, hasWebsite, city, reviews } = params

  const reviewText = reviews && reviews.length > 0
    ? reviews.map((r) => `[${r.rating}★] ${r.authorName}: ${r.text.slice(0, 200)}`).join('\n')
    : '(no reviews captured)'

  const prompt = `You are a B2B sales intelligence assistant for a web design agency (cybershare.tech). Score this lead on a scale of 0-100 for how good a prospect they are.

Higher score = more likely to need a website and have budget to pay for one.

Factors to consider:
- No website = HIGHER priority (they need one!)
- Low rating or negative reviews = opportunity to help them improve
- High review count = established business with revenue
- Service businesses (barbers, plumbers, etc.) are good targets
- Chain/franchise locations = lower priority (corporate decides)

Business: ${businessName}
Category: ${category || 'unknown'}
Location: ${city || 'unknown'}
Rating: ${rating || 'no rating'} (${reviewsCount || 0} reviews)
Has website: ${hasWebsite ? 'yes' : 'NO'}

Reviews:
${reviewText}

Return ONLY a JSON object (no markdown):
{
  "score": <0-100>,
  "reason": "<one sentence why this score>",
  "recommendation": "<one sentence on how to approach this lead>"
}`

  const result = await callMistral(prompt, 300)
  if (!result) return null

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    return {
      score: Math.min(100, Math.max(0, Number(parsed.score) || 50)),
      reason: String(parsed.reason || '').slice(0, 300),
      recommendation: String(parsed.recommendation || '').slice(0, 300),
    }
  } catch {
    return null
  }
}

export interface EmailTemplate {
  subject: string
  body: string
}

/**
 * Generate a personalized cold outreach email using the lead's review themes.
 */
export async function generateOutreachEmail(params: {
  businessName: string
  category?: string | null
  city?: string | null
  rating?: number | null
  reviewsCount?: number | null
  hasWebsite: boolean
  reviews?: Review[]
}): Promise<EmailTemplate | null> {
  const { businessName, category, city, rating, reviewsCount, hasWebsite, reviews } = params

  const reviewSummary = reviews && reviews.length > 0
    ? reviews.slice(0, 3).map((r) => `- "${r.text.slice(0, 150)}" — ${r.authorName} (${r.rating}★)`)
    : '(no reviews available)'

  const prompt = `Write a personalized cold outreach email for a web design agency (cybershare.tech) reaching out to this business.

Business: ${businessName}
Category: ${category || 'unknown'}
Location: ${city || 'unknown'}
Rating: ${rating || 'no rating'} (${reviewsCount || 0} reviews)
Has website: ${hasWebsite ? 'yes' : 'NO — they need one!'}

Recent reviews:
${reviewSummary}

Requirements:
- Subject line: catchy, mentions their business name, under 60 chars
- Body: 3-4 short paragraphs, friendly but professional
- Reference something specific from their reviews (shows you did research)
- If they have no website, mention that. If they have a website, suggest improvements.
- End with a soft CTA: "Would you be open to a quick 10-min call this week?"
- Sign off as "Manny from cybershare.tech"

Return ONLY a JSON object:
{
  "subject": "<subject line>",
  "body": "<full email body with line breaks>"
}`

  const result = await callMistral(prompt, 800)
  if (!result) return null

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    return {
      subject: String(parsed.subject || '').slice(0, 200),
      body: String(parsed.body || '').slice(0, 2000),
    }
  } catch {
    return null
  }
}

export interface ReviewSentiment {
  positiveThemes: string[]
  negativeThemes: string[]
  summary: string
}

/**
 * Analyze review sentiment — extract positive/negative themes.
 */
export async function analyzeReviewSentiment(reviews: Review[]): Promise<ReviewSentiment | null> {
  if (!reviews || reviews.length === 0) return null

  const reviewText = reviews.map((r) => `[${r.rating}★] ${r.text}`).join('\n')

  const prompt = `Analyze these Google Maps reviews for a business. Extract the main positive and negative themes.

Reviews:
${reviewText}

Return ONLY a JSON object:
{
  "positiveThemes": ["theme 1", "theme 2", "theme 3"],
  "negativeThemes": ["theme 1", "theme 2"],
  "summary": "<2-3 sentence summary of what customers think>"
}`

  const result = await callMistral(prompt, 400)
  if (!result) return null

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    return {
      positiveThemes: Array.isArray(parsed.positiveThemes) ? parsed.positiveThemes.slice(0, 5).map(String) : [],
      negativeThemes: Array.isArray(parsed.negativeThemes) ? parsed.negativeThemes.slice(0, 5).map(String) : [],
      summary: String(parsed.summary || '').slice(0, 500),
    }
  } catch {
    return null
  }
}

/**
 * Generate a 30-second cold call script.
 */
export async function generateCallPitch(params: {
  businessName: string
  category?: string | null
  city?: string | null
  rating?: number | null
  reviewsCount?: number | null
  hasWebsite: boolean
  reviews?: Review[]
}): Promise<string | null> {
  const { businessName, category, rating, reviewsCount, hasWebsite, reviews } = params

  const reviewSummary = reviews && reviews.length > 0
    ? reviews.slice(0, 3).map((r) => `- "${r.text.slice(0, 150)}" — ${r.authorName} (${r.rating}★)`)
    : '(no reviews available)'

  const prompt = `Write a 30-second cold call script for a web design agency (cybershare.tech) calling this business.

Business: ${businessName}
Category: ${category || 'unknown'}
Rating: ${rating || 'no rating'} (${reviewsCount || 0} reviews)
Has website: ${hasWebsite ? 'yes' : 'NO — they need one!'}

Reviews summary:
${reviewSummary}

Requirements:
- Start with a friendly opener mentioning something specific from their reviews
- 2-3 sentences max (30 seconds when spoken)
- Mention you help businesses like theirs improve their online presence
- End with: "Would you be against a quick 10-minute call later this week?"
- Sound natural, not scripted

Return ONLY the script text (no JSON, no markdown).`

  return await callMistral(prompt, 400)
}
