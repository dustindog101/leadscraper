import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { scoreLead } from '@/lib/ai-analysis'

// POST /api/leads/score — AI score a lead
// Body: { leadId }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.MISTRAL_API_KEY) {
    return NextResponse.json(
      { error: 'AI is not configured. Set MISTRAL_API_KEY env var.' },
      { status: 503 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const { leadId } = body as { leadId?: string }

  if (!leadId) {
    return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
  }

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: { reviews: { take: 5, orderBy: { capturedAt: 'desc' } } },
  })

  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  const score = await scoreLead({
    businessName: lead.businessName,
    category: lead.category,
    rating: lead.rating,
    reviewsCount: lead.reviewsCount,
    hasWebsite: !!lead.website,
    city: lead.city,
    reviews: lead.reviews.map((r) => ({
      authorName: r.authorName,
      rating: r.rating,
      text: r.text,
      relativeDate: r.relativeDate || undefined,
    })),
  })

  if (!score) {
    return NextResponse.json({ error: 'AI scoring failed. Try again later.' }, { status: 500 })
  }

  return NextResponse.json({ leadId, businessName: lead.businessName, score })
}
