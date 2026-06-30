'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Search, MapPin, Loader2, Sparkles, X } from 'lucide-react'

const PRESET_QUERIES = [
  'barber', 'barbershop', 'hair salon', 'dentist', 'dental clinic',
  'restaurant', 'food truck', 'catering', 'pizza', 'coffee shop',
  'bakery', 'mechanic', 'plumber', 'electrician', 'landscaping',
  'nail salon', 'spa', 'gym', 'auto repair', 'roofing',
]

const PRESET_LOCATIONS = [
  'Rockville MD', 'Baltimore MD', 'Bethesda MD', 'Silver Spring MD',
  'Gaithersburg MD', 'Frederick MD', 'Annapolis MD', 'Columbia MD',
  'College Park MD', 'Towson MD',
]

interface NewSearchViewProps {
  onDone: () => void
}

export function NewSearchView({ onDone }: NewSearchViewProps) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [maxResults, setMaxResults] = useState(200)
  const [useProxy, setUseProxy] = useState(false)
  const [proxyConfigId, setProxyConfigId] = useState<string>('')

  const { data: proxiesData } = useQuery({
    queryKey: ['proxies'],
    queryFn: api.listProxies,
  })

  const createMutation = useMutation({
    mutationFn: api.createJob,
    onSuccess: (data) => {
      toast.success(`Started scraping "${data.job.query}" in ${data.job.location}`)
      onDone()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim() || !location.trim()) {
      toast.error('Please enter both a keyword and a location')
      return
    }
    if (useProxy && !proxyConfigId) {
      toast.error('Select a proxy config or disable proxy')
      return
    }
    createMutation.mutate({
      query: query.trim(),
      location: location.trim(),
      maxResults,
      useProxy,
      proxyConfigId: useProxy ? proxyConfigId : undefined,
    })
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Search</h1>
        <p className="text-sm text-muted-foreground">
          Find businesses on Google Maps. Leads without a website are flagged automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" /> Search Criteria
            </CardTitle>
            <CardDescription>What kind of business are you looking for, and where?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="query">Keyword / business type</Label>
              <Input
                id="query"
                placeholder="e.g. dentist, barber, restaurant"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                required
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {PRESET_QUERIES.slice(0, 12).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuery(q)}
                    className="text-xs px-2 py-1 rounded-md border bg-background hover:bg-muted transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">
                <MapPin className="h-3.5 w-3.5 inline mr-1" /> Location
              </Label>
              <Input
                id="location"
                placeholder="e.g. Rockville MD"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {PRESET_LOCATIONS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLocation(l)}
                    className="text-xs px-2 py-1 rounded-md border bg-background hover:bg-muted transition-colors"
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max">Max results: <span className="font-semibold text-primary">{maxResults}</span></Label>
              <input
                id="max"
                type="range"
                min={20}
                max={1000}
                step={20}
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                Larger numbers take longer — roughly 3 seconds per result for deep scraping.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Proxy Settings (optional)
            </CardTitle>
            <CardDescription>
              Recommended for runs above 200 results. Configure proxies in the Proxies tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="use-proxy">Use proxy</Label>
                <p className="text-xs text-muted-foreground">Route traffic through your proxy list</p>
              </div>
              <Switch id="use-proxy" checked={useProxy} onCheckedChange={setUseProxy} />
            </div>

            {useProxy && (
              <div className="space-y-2">
                <Label>Proxy configuration</Label>
                {proxiesData?.configs.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-2">No proxy configs yet.</p>
                    <Button type="button" variant="outline" size="sm" onClick={onDone}>
                      Add one in the Proxies tab
                    </Button>
                  </div>
                ) : (
                  <Select value={proxyConfigId} onValueChange={setProxyConfigId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a proxy config" />
                    </SelectTrigger>
                    <SelectContent>
                      {proxiesData?.configs.map((c) => (
                        <SelectItem key={c.id} value={c.id} disabled={!c.enabled}>
                          <span className="flex items-center gap-2">
                            {c.name}
                            <Badge variant="outline" className="text-[10px]">
                              {c.type} · {c.proxyDescription}
                            </Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Starting...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" /> Start Scrape
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
