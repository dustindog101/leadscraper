import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { enrichLeadWithOwner } from '@/lib/ai-enrichment'

// POST /api/leads/enrich — AI enrich a lead (or batch of leads) with owner names
// Body: { leadId?: string, limit?: number }
// If leadId is provided, enrich that single lead.
// If limit is provided, enrich up to N leads that don't have contacts yet.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.MISTRAL_API_KEY) {
    return NextResponse.json(
      { error: 'AI enrichment is not configured. Set MISTRAL_API_KEY env var.' },
      { status: 503 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const { leadId, limit = 1 } = body as { leadId?: string; limit?: number }

  // If single lead
  if (leadId) {
    const lead = await db.lead.findUnique({ where: { id: leadId } })
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    if (!lead.website) {
      return NextResponse.json({ error: 'Lead has no website to enrich from' }, { status: 400 })
    }

    const contacts = await enrichLeadWithOwner(lead.website)
    const saved = []
    for (const c of contacts) {
      const contact = await db.leadContact.create({
        data: {
          leadId: lead.id,
          name: c.name,
          title: c.title || null,
          email: c.email || null,
          confidence: c.confidence,
          source: c.source,
        },
      })
      saved.push(contact)
    }

    return NextResponse.json({
      leadId: lead.id,
      businessName: lead.businessName,
      contacts: saved,
      count: saved.length,
    })
  }

  // Batch mode: find leads with websites but no contacts, enrich up to `limit`
  const leadsToEnrich = await db.lead.findMany({
    where: {
      website: { not: null },
      contacts: { none: {} },
    },
    take: Math.min(limit, 50),  // Cap at 50 per request
    select: { id: true, businessName: true, website: true },
  })

  const results = []
  let enriched = 0
  let failed = 0

  for (const lead of leadsToEnrich) {
    try {
      const contacts = await enrichLeadWithOwner(lead.website!)
      for (const c of contacts) {
        await db.leadContact.create({
          data: {
            leadId: lead.id,
            name: c.name,
            title: c.title || null,
            email: c.email || null,
            confidence: c.confidence,
            source: c.source,
          },
        })
      }
      results.push({ leadId: lead.id, businessName: lead.businessName, count: contacts.length })
      if (contacts.length > 0) enriched++
      else failed++
    } catch (e) {
      failed++
      results.push({
        leadId: lead.id,
        businessName: lead.businessName,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return NextResponse.json({
    total: leadsToEnrich.length,
    enriched,
    failed,
    results,
  })
}
