import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

// GET /api/leads — list leads with filters
// Query params:
//   - q           : full-text search on business name / address / phone
//   - hasWebsite  : "true" | "false" | "any"
//   - city        : exact match
//   - state       : exact match
//   - category    : exact match
//   - tagId       : filter by tag
//   - jobId       : filter by source job
//   - limit       : default 50, max 500
//   - offset      : default 0
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const sp = url.searchParams

  const q = sp.get('q')?.trim()
  const hasWebsite = sp.get('hasWebsite') || 'any'
  const city = sp.get('city')
  const state = sp.get('state')
  const category = sp.get('category')
  const tagId = sp.get('tagId')
  const jobId = sp.get('jobId')
  const limit = Math.min(500, Number(sp.get('limit')) || 50)
  const offset = Number(sp.get('offset')) || 0

  const where: Prisma.LeadWhereInput = {}

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

  const [leads, total] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { discoveredAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        contacts: { orderBy: { confidence: 'desc' }, take: 1 },
        tags: { include: { tag: true } },
      },
    }),
    db.lead.count({ where }),
  ])

  // Distinct values for filter dropdowns
  const [cities, states, categories, tags] = await Promise.all([
    db.lead.findMany({
      where: { city: { not: null } },
      select: { city: true },
      distinct: ['city'],
    }),
    db.lead.findMany({
      where: { state: { not: null } },
      select: { state: true },
      distinct: ['state'],
    }),
    db.lead.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    }),
    db.tag.findMany({ orderBy: { name: 'asc' } }),
  ])

  return NextResponse.json({
    leads,
    total,
    offset,
    limit,
    filters: {
      cities: cities.map((c) => c.city).filter(Boolean).sort() as string[],
      states: states.map((s) => s.state).filter(Boolean).sort() as string[],
      categories: categories.map((c) => c.category).filter(Boolean).sort() as string[],
      tags,
    },
  })
}
