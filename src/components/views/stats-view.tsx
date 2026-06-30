'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Users, Globe, Search, Server, TrendingUp, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface StatsViewProps {
  onNavigate: (view: 'stats' | 'new-search' | 'leads' | 'jobs' | 'proxies') => void
}

export function StatsView({ onNavigate }: StatsViewProps) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 5000,
  })

  if (isLoading || !stats) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="h-16 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Find businesses without a website — your hottest prospects.
          </p>
        </div>
        <Button onClick={() => onNavigate('new-search')} className="gap-2">
          <Search className="h-4 w-4" /> New Search
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Leads</p>
                <p className="text-3xl font-semibold mt-1">{stats.totalLeads.toLocaleString()}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">No Website</p>
                <p className="text-3xl font-semibold mt-1 text-amber-600">
                  {stats.noWebsiteLeads.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">prime prospects</p>
              </div>
              <AlertCircle className="h-8 w-8 text-amber-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Website Coverage</p>
                <p className="text-3xl font-semibold mt-1">{stats.websiteCoverage}%</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  of all scraped leads
                </p>
              </div>
              <Globe className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Scrape Jobs</p>
                <p className="text-3xl font-semibold mt-1">{stats.totalJobs.toLocaleString()}</p>
                {stats.runningJobs > 0 && (
                  <Badge variant="default" className="mt-1 animate-pulse">
                    {stats.runningJobs} running
                  </Badge>
                )}
              </div>
              <Server className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent jobs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Scrape Jobs</CardTitle>
            <CardDescription>Latest activity in your workspace</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => onNavigate('jobs')}>
            View All
          </Button>
        </CardHeader>
        <CardContent>
          {stats.recentJobs.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No jobs yet. Click <strong>New Search</strong> to find your first leads.
            </div>
          ) : (
            <div className="space-y-3">
              {stats.recentJobs.map((job) => (
                <div key={job.id} className="flex items-center gap-4 py-2 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">
                        {job.query} · {job.location}
                      </span>
                      <StatusBadge status={job.status} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {job.user?.name || job.user?.email} ·{' '}
                      {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-medium">{job.leadsFound} leads</div>
                    {job.noWebsiteCount > 0 && (
                      <div className="text-xs text-amber-600">{job.noWebsiteCount} no website</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top cities + categories */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Cities</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topCities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data yet</p>
            ) : (
              <div className="space-y-2">
                {stats.topCities.map((c) => {
                  const max = stats.topCities[0]?._count || 1
                  return (
                    <div key={c.city} className="flex items-center gap-3 text-sm">
                      <div className="w-24 truncate">{c.city}</div>
                      <div className="flex-1">
                        <Progress value={(c._count / max) * 100} className="h-2" />
                      </div>
                      <div className="w-10 text-right text-muted-foreground">{c._count}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Categories</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data yet</p>
            ) : (
              <div className="space-y-2">
                {stats.topCategories.map((c) => {
                  const max = stats.topCategories[0]?._count || 1
                  return (
                    <div key={c.category} className="flex items-center gap-3 text-sm">
                      <div className="w-32 truncate">{c.category}</div>
                      <div className="flex-1">
                        <Progress value={(c._count / max) * 100} className="h-2" />
                      </div>
                      <div className="w-10 text-right text-muted-foreground">{c._count}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {stats.tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tags</CardTitle>
            <CardDescription>How your leads are organized</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.tags.map((t) => (
                <Badge key={t.id} variant="secondary" className="gap-1">
                  {t.name} <span className="text-xs text-muted-foreground">{t.count}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    queued: { variant: 'outline', label: 'Queued' },
    running: { variant: 'default', label: 'Running' },
    done: { variant: 'secondary', label: 'Done' },
    failed: { variant: 'destructive', label: 'Failed' },
    cancelled: { variant: 'outline', label: 'Cancelled' },
  }
  const { variant, label } = map[status] || { variant: 'outline' as const, label: status }
  return <Badge variant={variant}>{label}</Badge>
}
