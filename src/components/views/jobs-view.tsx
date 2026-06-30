'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Server, RefreshCw, XCircle, AlertCircle, CheckCircle2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

export function JobsView() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(50),
    refetchInterval: 3000,
  })

  const cancelMutation = useMutation({
    mutationFn: api.cancelJob,
    onSuccess: () => {
      toast.success('Job cancelled')
      refetch()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scrape Jobs</h1>
          <p className="text-sm text-muted-foreground">
            All scraping runs in your workspace. Auto-refreshes every 3s.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !data || data.jobs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Server className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No jobs yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Head to the New Search tab to kick off your first scrape.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.jobs.map((job) => (
            <Card key={job.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {job.query} <span className="text-muted-foreground">in</span> {job.location}
                      </span>
                      <StatusBadge status={job.status} />
                      {job.useProxy && (
                        <Badge variant="outline" className="text-[10px]">proxy</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Started by {job.user?.name || job.user?.email}{' '}
                      {job.startedAt ? `· ${formatDistanceToNow(new Date(job.startedAt), { addSuffix: true })}` : `· queued ${formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}`}
                    </div>

                    {job.errorMsg && (
                      <div className="text-xs text-destructive mt-2 bg-destructive/5 border border-destructive/20 rounded p-2">
                        {job.errorMsg}
                      </div>
                    )}

                    {job.status === 'running' && (
                      <div className="mt-3 space-y-1">
                        <Progress value={job.progress} className="h-1.5" />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{job.progress}% · {job.leadsFound} leads so far</span>
                          <span>max {job.maxResults}</span>
                        </div>
                      </div>
                    )}

                    {(job.status === 'done' || job.status === 'cancelled') && (
                      <div className="text-xs mt-2 flex gap-4">
                        <span><strong>{job.leadsFound}</strong> leads</span>
                        {job.noWebsiteCount > 0 && (
                          <span className="text-amber-600">
                            <strong>{job.noWebsiteCount}</strong> without website
                          </span>
                        )}
                        {job.finishedAt && (
                          <span className="text-muted-foreground">
                            finished {formatDistanceToNow(new Date(job.finishedAt), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {(job.status === 'running' || job.status === 'queued') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancelMutation.mutate(job.id)}
                      disabled={cancelMutation.isPending}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; icon?: React.ElementType }> = {
    queued: { variant: 'outline', label: 'Queued' },
    running: { variant: 'default', label: 'Running' },
    done: { variant: 'secondary', label: 'Done', icon: CheckCircle2 },
    failed: { variant: 'destructive', label: 'Failed', icon: AlertCircle },
    cancelled: { variant: 'outline', label: 'Cancelled' },
  }
  const { variant, label, icon: Icon } = map[status] || { variant: 'outline' as const, label: status }
  return (
    <Badge variant={variant} className="gap-1">
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {label}
    </Badge>
  )
}
