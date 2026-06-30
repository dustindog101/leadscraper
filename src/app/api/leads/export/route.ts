import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import Papa from 'papaparse'

// POST /api/leads/export — export filtered leads as CSV
// Same filter params as GET /api/leads, but no pagination.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const {
    q,
    hasWebsite = 'any',
    city,
    state,
    category,
    tagId,
    jobId,
    leadIds, // optionally: explicit list of lead IDs to export
  } = body as Record<string, string | string[] | undefined>

  const where: Prisma.LeadWhereInput = {}

  if (Array.isArray(leadIds) && leadIds.length > 0) {
    where.id = { in: leadIds }
  } else {
    if (q) {
      where.OR = [
        { businessName: { contains: q } },
        { address: { contains: q } },
        { phone: { contains: q } },
        { category: { contains: q } },
      ]
    }
    if (hasWebsite === 'true') where.website = { not: null }
    if (hasWebsite === 'false') where.website = null
    if (city) where.city = city
    if (state) where.state = state
    if (category) where.category = category
    if (jobId) where.sourceJobId = jobId
    if (tagId) where.tags = { some: { tagId } }
  }

  const leads = await db.lead.findMany({
    where,
    orderBy: { discoveredAt: 'desc' },
    take: 10_000,
    include: {
      contacts: { orderBy: { confidence: 'desc' }, take: 1 },
      tags: { include: { tag: true } },
    },
  })

  const rows = leads.map((l) => {
    const contact = l.contacts[0]
    return {
      businessName: l.businessName,
      category: l.category || '',
      phone: l.phone || '',
      website: l.website || '',
      hasWebsite: l.website ? 'yes' : 'NO',
      placeUrl: l.placeUrl || '',
      address: l.address || '',
      city: l.city || '',
      state: l.state || '',
      zip: l.zip || '',
      rating: l.rating ?? '',
      reviewsCount: l.reviewsCount ?? '',
      priceLevel: l.priceLevel || '',
      businessStatus: l.businessStatus || '',
      contactName: contact?.name || '',
      contactTitle: contact?.title || '',
      contactEmail: contact?.email || '',
      contactConfidence: contact?.confidence ?? '',
      tags: l.tags.map((t) => t.tag.name).join('; '),
      lat: l.lat ?? '',
      lng: l.lng ?? '',
      discoveredAt: l.discoveredAt.toISOString(),
    }
  })

  const csv = Papa.unparse(rows)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${Date.now()}.csv"`,
    },
  })
}
