import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const DEFAULT_PROMPTS: Record<string, { value: string; category: string }> = {
  ai_score_prompt: {
    category: 'ai',
    value: `You are a B2B sales intelligence assistant for a web design agency (cybershare.tech). Score this lead 0-100.

Higher score = more likely to need a website and have budget.

Factors:
- No website = HIGHER priority
- Low rating/negative reviews = opportunity
- High review count = established business
- Service businesses = good targets

Business: {businessName}
Category: {category}
Rating: {rating} ({reviewsCount} reviews)
Has website: {hasWebsite}

Reviews:
{reviews}

Return ONLY JSON: {"score": <0-100>, "reason": "<one sentence>", "recommendation": "<one sentence>"}`,
  },
  ai_email_prompt: {
    category: 'ai',
    value: `Write a cold outreach email for cybershare.tech reaching out to this business.

Business: {businessName}
Category: {category}
Rating: {rating} ({reviewsCount} reviews)
Has website: {hasWebsite}

Reviews:
{reviews}

Requirements:
- Subject: catchy, mentions business name, under 60 chars
- Body: 3-4 short paragraphs, friendly but professional
- Reference something specific from reviews
- If no website, mention that. If has website, suggest improvements.
- End with: "Would you be open to a quick 10-min call this week?"
- Sign off as "Manny from cybershare.tech"

Return ONLY JSON: {"subject": "<subject>", "body": "<email body>"}`,
  },
  ai_sentiment_prompt: {
    category: 'ai',
    value: `Analyze these reviews. Extract positive/negative themes.

Reviews:
{reviews}

Return ONLY JSON: {"positiveThemes": ["theme1","theme2"], "negativeThemes": ["theme1"], "summary": "<2-3 sentences>"}`,
  },
  ai_call_pitch_prompt: {
    category: 'ai',
    value: `Write a 30-second cold call script for cybershare.tech calling this business.

Business: {businessName}
Category: {category}
Rating: {rating} ({reviewsCount} reviews)
Has website: {hasWebsite}

Reviews:
{reviews}

Requirements:
- Start with friendly opener mentioning something from reviews
- 2-3 sentences (30 seconds spoken)
- Mention you help businesses improve online presence
- End with: "Would you be against a quick 10-minute call later this week?"

Return ONLY the script text (no JSON, no markdown).`,
  },
  ai_owner_prompt: {
    category: 'ai',
    value: `Extract owner/manager names from this business website text.

Look for: "Founded by", "Owner:", team pages, CEO/President/Manager titles, sign-offs.

Return ONLY a JSON array: [{"name":"John Smith","title":"Owner","email":null,"confidence":0.9}]
If no people found, return: []

Website text:
---
{websiteText}
---`,
  },
}

// GET /api/settings
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = await db.setting.findMany()
  const result: Record<string, { value: string; category: string; updatedAt?: string }> = {}
  for (const [key, def] of Object.entries(DEFAULT_PROMPTS)) {
    result[key] = { value: def.value, category: def.category }
  }
  for (const s of settings) {
    result[s.key] = { value: s.value, category: s.category, updatedAt: s.updatedAt.toISOString() }
  }
  return NextResponse.json({ settings: result })
}

// PUT /api/settings (admin only)
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { key, value } = body as { key?: string; value?: string }
  if (!key || value === undefined) return NextResponse.json({ error: 'key and value required' }, { status: 400 })
  if (!DEFAULT_PROMPTS[key]) return NextResponse.json({ error: `Unknown key: ${key}` }, { status: 400 })

  const setting = await db.setting.upsert({
    where: { key },
    create: { key, value, category: DEFAULT_PROMPTS[key].category, updatedBy: session.user.id },
    update: { value, updatedBy: session.user.id },
  })
  return NextResponse.json({ setting })
}

// POST /api/settings (reset to default, admin only)
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { key, action } = body as { key?: string; action?: 'reset' }
  if (action === 'reset' && key) {
    if (!DEFAULT_PROMPTS[key]) return NextResponse.json({ error: `Unknown key: ${key}` }, { status: 400 })
    await db.setting.deleteMany({ where: { key } })
    return NextResponse.json({ ok: true, value: DEFAULT_PROMPTS[key].value })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
