'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Globe, Plus, Trash2, Play, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react'

export function ProxiesView() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<'http' | 'socks5' | 'socks4'>('http')
  const [proxies, setProxies] = useState('')
  const [rotateMode, setRotateMode] = useState<'round-robin' | 'random'>('round-robin')

  const { data, isLoading } = useQuery({
    queryKey: ['proxies'],
    queryFn: api.listProxies,
  })

  const createMutation = useMutation({
    mutationFn: api.createProxy,
    onSuccess: () => {
      toast.success('Proxy config saved')
      setName('')
      setProxies('')
      setShowForm(false)
      queryClient.invalidateQueries({ queryKey: ['proxies'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteProxy,
    onSuccess: () => {
      toast.success('Proxy config deleted')
      queryClient.invalidateQueries({ queryKey: ['proxies'] })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.toggleProxy(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proxies'] }),
  })

  const testMutation = useMutation({
    mutationFn: api.testProxy,
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(`Proxy works! Exit IP: ${data.exitIp} (${data.elapsedMs}ms)`)
      } else {
        toast.error(`Proxy test failed: ${data.error}`)
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({ name, type, proxies, rotateMode })
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proxy Configurations</h1>
          <p className="text-sm text-muted-foreground">
            Route scraper traffic through HTTP or SOCKS5 proxies. Single or rotating list.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} className="gap-2">
          <Plus className="h-4 w-4" /> {showForm ? 'Cancel' : 'Add Proxy'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Proxy Configuration</CardTitle>
            <CardDescription>
              Enter one proxy per line. Multiple proxies will be rotated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="Webshare residential"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="type">Protocol</Label>
                  <Select value={type} onValueChange={(v) => setType(v as 'http' | 'socks5' | 'socks4')}>
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP / HTTPS</SelectItem>
                      <SelectItem value="socks5">SOCKS5</SelectItem>
                      <SelectItem value="socks4">SOCKS4</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="proxies">Proxy list</Label>
                <Textarea
                  id="proxies"
                  rows={6}
                  placeholder={`http://user:pass@1.2.3.4:8080
socks5://user:pass@5.6.7.8:1080
host:port:user:pass
host:port`}
                  value={proxies}
                  onChange={(e) => setProxies(e.target.value)}
                  className="font-mono text-xs"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Accepted formats: <code>protocol://user:pass@host:port</code>, <code>host:port</code>,{' '}
                  <code>host:port:user:pass</code>. One per line.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Rotation mode</Label>
                <Select value={rotateMode} onValueChange={(v) => setRotateMode(v as 'round-robin' | 'random')}>
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="round-robin">Round-robin (sequential)</SelectItem>
                    <SelectItem value="random">Random</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...</>
                  ) : (
                    'Save Proxy Config'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => testMutation.mutate(proxies)}
                  disabled={!proxies.trim() || testMutation.isPending}
                >
                  {testMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Testing...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" /> Test First Proxy</>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : !data || data.configs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Globe className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No proxy configs yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              For small runs (under 200 results) you don&apos;t need a proxy.{' '}
              <button onClick={() => setShowForm(true)} className="text-primary underline">
                Add one
              </button>{' '}
              for larger runs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.configs.map((cfg) => (
            <Card key={cfg.id} className={cfg.enabled ? '' : 'opacity-60'}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{cfg.name}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{cfg.type}</Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {cfg.proxyDescription}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {cfg.rotateMode}
                      </Badge>
                    </div>
                    {cfg.proxiesPreview && cfg.proxiesPreview.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {cfg.proxiesPreview.map((p, i) => (
                          <div key={i} className="text-xs font-mono text-muted-foreground truncate">
                            {p}
                          </div>
                        ))}
                        {cfg.proxyCount && cfg.proxyCount > 3 && (
                          <div className="text-xs text-muted-foreground">
                            ... and {cfg.proxyCount - 3} more
                          </div>
                        )}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-2">
                      Created {new Date(cfg.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {cfg.enabled ? (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <ShieldCheck className="h-3 w-3" /> Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <ShieldAlert className="h-3 w-3" /> Disabled
                          </span>
                        )}
                      </span>
                      <Switch
                        checked={cfg.enabled}
                        onCheckedChange={(v) => toggleMutation.mutate({ id: cfg.id, enabled: v })}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => testMutation.mutate(cfg.proxies)}
                        disabled={testMutation.isPending}
                      >
                        <Play className="h-3.5 w-3.5" /> Test
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete proxy config "${cfg.name}"?`)) {
                            deleteMutation.mutate(cfg.id)
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="bg-muted/40 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">💡 Proxy tips</p>
          <p>• At &lt;200 results per run, you usually don&apos;t need a proxy.</p>
          <p>• For thousands of results, use a residential proxy (Webshare, Evomi, Bright Data).</p>
          <p>• Free option: <a href="https://www.webshare.io" target="_blank" rel="noopener noreferrer" className="text-primary underline">Webshare</a> gives 10 proxies + 1GB/mo free.</p>
          <p>• Cheapest paid: <a href="https://evomi.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">Evomi</a> at $0.49/GB.</p>
        </CardContent>
      </Card>
    </div>
  )
}
