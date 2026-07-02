/**
 * AI-powered lead analysis using Mistral AI.
 * Results are PERSISTED on the Lead model.
 * Uses configurable prompts from the Setting table.
 */

import { db } from './db'
import type { Review } from './scraper'

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'
const MISTRAL_MODEL = 'mistral-small-latest'
const RATE_LIMIT_MS = 1100
let lastRequestTime = 0
let promptCache: Record<string, string> | null = null
let promptCacheTime = 0

async function rateLimit() {
  const now = Date.now()
  if (now - lastRequestTime < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - (now - lastRequestTime))
  lastRequestTime = Date.now()
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function getPrompt(key: string, vars: Record<string, string>): Promise<string> {
  if (!promptCache || Date.now() - promptCacheTime > 60_000) {
    try { const s = await db.setting.findMany(); promptCache = {}; s.forEach(x => promptCache![x.key] = x.value) } catch { promptCache = {} }
    promptCacheTime = Date.now()
  }
  let tpl = promptCache?.[key] || DEFAULT_PROMPTS[key] || ''
  for (const [k, v] of Object.entries(vars)) tpl = tpl.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
  return tpl
}

const DEFAULT_PROMPTS: Record<string, string> = {
  ai_score_prompt: `You are a B2B sales intelligence assistant for a web design agency (cybershare.tech). Score this lead 0-100.\n\nHigher score = more likely to need a website and have budget.\n\nFactors:\n- No website = HIGHER priority\n- Low rating/negative reviews = opportunity\n- High review count = established business\n- Service businesses = good targets\n\nBusiness: {businessName}\nCategory: {category}\nRating: {rating} ({reviewsCount} reviews)\nHas website: {hasWebsite}\n\nReviews:\n{reviews}\n\nReturn ONLY JSON: {"score": <0-100>, "reason": "<one sentence>", "recommendation": "<one sentence>"}`,
  ai_email_prompt: `Write a cold outreach email for cybershare.tech reaching out to this business.\n\nBusiness: {businessName}\nCategory: {category}\nRating: {rating} ({reviewsCount} reviews)\nHas website: {hasWebsite}\n\nReviews:\n{reviews}\n\nRequirements:\n- Subject: catchy, mentions business name, under 60 chars\n- Body: 3-4 short paragraphs, friendly but professional\n- Reference something specific from reviews\n- If no website, mention that. If has website, suggest improvements.\n- End with: "Would you be open to a quick 10-min call this week?"\n- Sign off as "Manny from cybershare.tech"\n\nReturn ONLY JSON: {"subject": "<subject>", "body": "<email body>"}`,
  ai_sentiment_prompt: `Analyze these reviews. Extract positive/negative themes.\n\nReviews:\n{reviews}\n\nReturn ONLY JSON: {"positiveThemes": ["theme1","theme2"], "negativeThemes": ["theme1"], "summary": "<2-3 sentences>"}`,
  ai_call_pitch_prompt: `Write a 30-second cold call script for cybershare.tech calling this business.\n\nBusiness: {businessName}\nCategory: {category}\nRating: {rating} ({reviewsCount} reviews)\nHas website: {hasWebsite}\n\nReviews:\n{reviews}\n\nRequirements:\n- Start with friendly opener mentioning something from reviews\n- 2-3 sentences (30 seconds spoken)\n- Mention you help businesses improve online presence\n- End with: "Would you be against a quick 10-minute call later this week?"\n\nReturn ONLY the script text (no JSON, no markdown).`,
  ai_owner_prompt: `Extract owner/manager names from this business website text.\n\nReturn ONLY a JSON array: [{"name":"John Smith","title":"Owner","email":null,"confidence":0.9}]\nIf no people found, return: []\n\nWebsite text:\n---\n{websiteText}\n---`,
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MISTRAL_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: maxTokens }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const data = await res.json()
    return data?.choices?.[0]?.message?.content || ''
  } catch { return null }
}

function fmtReviews(reviews: Review[]): string {
  if (!reviews?.length) return '(no reviews captured)'
  return reviews.slice(0, 5).map(r => `[${r.rating}★] ${r.authorName}: ${r.text.slice(0, 200)}`).join('\n')
}

export interface LeadScore { score: number; reason: string; recommendation: string }

export async function scoreLead(leadId: string): Promise<LeadScore | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { reviews: { take: 5, orderBy: { capturedAt: 'desc' } } } })
  if (!lead) return null
  const prompt = await getPrompt('ai_score_prompt', {
    businessName: lead.businessName, category: lead.category || 'unknown',
    rating: String(lead.rating || 'no rating'), reviewsCount: String(lead.reviewsCount || 0),
    hasWebsite: lead.website ? 'yes' : 'NO',
    reviews: fmtReviews(lead.reviews.map(r => ({ authorName: r.authorName, rating: r.rating, text: r.text, relativeDate: r.relativeDate || undefined }))),
  })
  const result = await callMistral(prompt, 300)
  if (!result) return null
  try {
    const m = result.match(/\{[\s\S]*\}/); if (!m) return null
    const p = JSON.parse(m[0])
    const score: LeadScore = { score: Math.min(100, Math.max(0, Number(p.score) || 50)), reason: String(p.reason || '').slice(0, 300), recommendation: String(p.recommendation || '').slice(0, 300) }
    await db.lead.update({ where: { id: leadId }, data: { aiScore: score.score, aiScoreReason: score.reason, aiScoreRec: score.recommendation, aiScoreAt: new Date() } })
    return score
  } catch { return null }
}

export interface EmailTemplate { subject: string; body: string }

export async function generateOutreachEmail(leadId: string): Promise<EmailTemplate | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { reviews: { take: 3, orderBy: { capturedAt: 'desc' } } } })
  if (!lead) return null
  const prompt = await getPrompt('ai_email_prompt', {
    businessName: lead.businessName, category: lead.category || 'unknown',
    rating: String(lead.rating || 'no rating'), reviewsCount: String(lead.reviewsCount || 0),
    hasWebsite: lead.website ? 'yes' : 'NO',
    reviews: fmtReviews(lead.reviews.map(r => ({ authorName: r.authorName, rating: r.rating, text: r.text, relativeDate: r.relativeDate || undefined }))),
  })
  const result = await callMistral(prompt, 800)
  if (!result) return null
  try {
    const m = result.match(/\{[\s\S]*\}/); if (!m) return null
    const p = JSON.parse(m[0])
    const email: EmailTemplate = { subject: String(p.subject || '').slice(0, 200), body: String(p.body || '').slice(0, 2000) }
    await db.lead.update({ where: { id: leadId }, data: { aiEmailSubject: email.subject, aiEmailBody: email.body, aiEmailAt: new Date() } })
    return email
  } catch { return null }
}

export interface ReviewSentiment { positiveThemes: string[]; negativeThemes: string[]; summary: string }

export async function analyzeReviewSentiment(leadId: string): Promise<ReviewSentiment | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { reviews: { take: 5, orderBy: { capturedAt: 'desc' } } } })
  if (!lead || lead.reviews.length === 0) return null
  const reviewText = lead.reviews.map(r => `[${r.rating}★] ${r.text}`).join('\n')
  const prompt = await getPrompt('ai_sentiment_prompt', { reviews: reviewText })
  const result = await callMistral(prompt, 400)
  if (!result) return null
  try {
    const m = result.match(/\{[\s\S]*\}/); if (!m) return null
    const p = JSON.parse(m[0])
    const sentiment: ReviewSentiment = {
      positiveThemes: Array.isArray(p.positiveThemes) ? p.positiveThemes.slice(0, 5).map(String) : [],
      negativeThemes: Array.isArray(p.negativeThemes) ? p.negativeThemes.slice(0, 5).map(String) : [],
      summary: String(p.summary || '').slice(0, 500),
    }
    await db.lead.update({ where: { id: leadId }, data: { aiSentimentSummary: sentiment.summary, aiSentimentPositive: JSON.stringify(sentiment.positiveThemes), aiSentimentNegative: JSON.stringify(sentiment.negativeThemes), aiSentimentAt: new Date() } })
    return sentiment
  } catch { return null }
}

export async function generateCallPitch(leadId: string): Promise<string | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { reviews: { take: 3, orderBy: { capturedAt: 'desc' } } } })
  if (!lead) return null
  const prompt = await getPrompt('ai_call_pitch_prompt', {
    businessName: lead.businessName, category: lead.category || 'unknown',
    rating: String(lead.rating || 'no rating'), reviewsCount: String(lead.reviewsCount || 0),
    hasWebsite: lead.website ? 'yes' : 'NO',
    reviews: fmtReviews(lead.reviews.map(r => ({ authorName: r.authorName, rating: r.rating, text: r.text, relativeDate: r.relativeDate || undefined }))),
  })
  return await callMistral(prompt, 400)
}
