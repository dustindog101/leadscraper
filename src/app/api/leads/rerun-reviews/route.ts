import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { chromium } from 'patchright'

// POST /api/leads/rerun-reviews — re-extract reviews for a single lead
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { leadId } = body as { leadId?: string }
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (!lead.placeUrl) return NextResponse.json({ error: 'Lead has no Google Maps URL' }, { status: 400 })

  if (process.env.VERCEL) {
    return NextResponse.json({
      error: 'Review extraction requires the Railway worker. This endpoint only works from the worker or locally.',
    }, { status: 200 })
  }

  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    })

    await context.addCookies([{ name: 'goog-lr', value: 'lang_en', domain: '.google.com', path: '/' }])
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })

    const page = await context.newPage()
    let reviewsUrl = lead.placeUrl
    if (!reviewsUrl.includes('!9m1!1b1')) {
      const qIdx = reviewsUrl.indexOf('?')
      reviewsUrl = qIdx > 0 ? reviewsUrl.slice(0, qIdx) + '!9m1!1b1' + reviewsUrl.slice(qIdx) : reviewsUrl + '!9m1!1b1'
    }

    await page.goto(reviewsUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await new Promise((r) => setTimeout(r, 2000))

    await db.review.deleteMany({ where: { leadId } })
    const reviews = await extractReviews(page, 5)

    for (const review of reviews) {
      await db.review.create({
        data: {
          leadId,
          authorName: review.authorName,
          rating: review.rating,
          text: review.text,
          relativeDate: review.relativeDate || null,
        },
      })
    }

    await context.close()
    await browser.close()

    return NextResponse.json({
      leadId,
      businessName: lead.businessName,
      reviewsCaptured: reviews.length,
      reviews: reviews.slice(0, 3).map((r) => ({ authorName: r.authorName, rating: r.rating, text: r.text.slice(0, 100) })),
    })
  } catch (e) {
    if (browser) await browser.close().catch(() => {})
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

async function extractReviews(page: any, maxReviews: number) {
  try {
    const rpc = await extractViaRPC(page, maxReviews)
    if (rpc.length > 0) return rpc
  } catch {}
  try { return await extractFromDOM(page, maxReviews) } catch { return [] }
}

async function extractViaRPC(page: any, maxReviews: number) {
  const url = page.url()
  const m = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/)
  if (!m) return []
  const placeId = m[1]
  const reqId = Math.random().toString(36).slice(2, 23)
  const pb = `!1m6!1s${encodeURIComponent(placeId)}!6m4!4m1!1e1!4m1!1e3!2m2!1i${Math.min(20, maxReviews)}!2s!5m2!1s${reqId}!7e81!8m9!2b1!3b1!5b1!7b1!12m4!1b1!2b1!4m1!1e1!11m0!13m1!1e1`
  const rpcUrl = `https://www.google.com/maps/rpc/listugcposts?authuser=0&hl=en&pb=${pb}`
  const result = await page.evaluate(async (u: string) => {
    try { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) return null; return await r.text() } catch { return null }
  }, rpcUrl)
  if (!result) return []
  const clean = result.replace(/^\)\]\}'\s*\n/, '')
  let parsed: any[]
  try { parsed = JSON.parse(clean) } catch { return [] }
  const list = Array.isArray(parsed?.[2]) ? parsed[2] : []
  const out: any[] = []
  for (const entry of list) {
    try {
      const rev = entry[0]
      const authorName = String(rev?.[1]?.[0]?.[0] || rev?.[1]?.[0]?.[4] || '')
      const rating = Number(rev?.[2]) || 0
      const text = String((rev?.[3]?.[0]) || rev?.[3] || '')
      const relativeDate = String(rev?.[1]?.[0]?.[8] || '')
      if (authorName && (text || rating > 0)) out.push({ authorName: authorName.slice(0, 200), rating, text: text.slice(0, 1000), relativeDate: relativeDate.slice(0, 50) })
      if (out.length >= maxReviews) break
    } catch {}
  }
  return out
}

async function extractFromDOM(page: any, maxReviews: number) {
  await page.waitForSelector('[data-review-id]', { timeout: 5000 }).catch(() => {})
  return await page.evaluate((max: number) => {
    const out: any[] = []
    document.querySelectorAll('[data-review-id]').forEach((card) => {
      const el = card as HTMLElement
      if (out.length >= max) return
      try {
        let authorName = ''
        for (const sel of ['.d4r55', '.WNxzHc', '.TSUbDb a', '.bHrnEe']) {
          const n = el.querySelector(sel); if (n?.textContent?.trim()) { authorName = n.textContent.trim(); break }
        }
        let rating = 0
        const rEl = el.querySelector('[role="img"][aria-label*="star"], [aria-label*="out of 5"]') as HTMLElement
        if (rEl) { const m = (rEl.getAttribute('aria-label') || '').match(/(\d+)/); if (m) rating = parseInt(m[1]) }
        let text = ''
        for (const sel of ['.wiI7pd', '.MyEned span']) { const t = el.querySelector(sel); if (t?.textContent?.trim()) { text = t.textContent.trim(); break } }
        let relativeDate = ''
        for (const sel of ['.rsqaWe', '.DU9Pgb']) { const d = el.querySelector(sel); if (d?.textContent?.trim()) { relativeDate = d.textContent.trim(); break } }
        if (authorName && (text || rating > 0)) out.push({ authorName: authorName.slice(0, 200), rating, text: text.slice(0, 1000), relativeDate: relativeDate.slice(0, 50) })
      } catch {}
    })
    return out
  }, maxReviews)
}
