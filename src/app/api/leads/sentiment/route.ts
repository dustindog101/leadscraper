import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { analyzeReviewSentiment } from '@/lib/ai-analysis'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.MISTRAL_API_KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const { leadId } = body as { leadId?: string }
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  const sentiment = await analyzeReviewSentiment(leadId)
  if (!sentiment) return NextResponse.json({ error: 'No reviews or AI failed' }, { status: 500 })
  return NextResponse.json({ leadId, sentiment })
}
