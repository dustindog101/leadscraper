import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/stats — dashboard stats
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [
    totalLeads,
    noWebsiteLeads,
    totalJobs,
    runningJobs,
    recentJobs,
    topCities,
    topCategories,
    tagCounts,
  ] = await Promise.all([
    db.lead.count(),
    db.lead.count({ where: { website: null } }),
    db.searchJob.count(),
    db.searchJob.count({ where: { status: 'running' } }),
    db.searchJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { user: { select: { name: true, email: true } } },
    }),
    db.lead.groupBy({
      by: ['city'],
      where: { city: { not: null } },
      _count: true,
      orderBy: { _count: { city: 'desc' } },
      take: 8,
    }),
    db.lead.groupBy({
      by: ['category'],
      where: { category: { not: null } },
      _count: true,
      orderBy: { _count: { category: 'desc' } },
      take: 8,
    }),
    db.tag.findMany({
      include: { _count: { select: { leads: true } } },
      orderBy: { name: 'asc' },
    }),
  ])

  return NextResponse.json({
    totalLeads,
    noWebsiteLeads,
    websiteCoverage: totalLeads === 0 ? 0 : Math.round(((totalLeads - noWebsiteLeads) / totalLeads) * 100),
    totalJobs,
    runningJobs,
    recentJobs,
    topCities: topCities.filter((c) => c.city),
    topCategories: topCategories.filter((c) => c.category),
    tags: tagCounts.map((t) => ({ id: t.id, name: t.name, color: t.color, count: t._count.leads })),
  })
}
