'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, type Lead } from '@/lib/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Search, Download, ExternalLink, Phone, MapPin, Globe, AlertCircle,
  ChevronLeft, ChevronRight, Tag as TagIcon, X, Star, Filter,
} from 'lucide-react'
import { toast } from 'sonner'

const PAGE_SIZE = 25

export function LeadsView() {
  const [q, setQ] = useState('')
  const [hasWebsite, setHasWebsite] = useState<'any' | 'true' | 'false'>('any')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [category, setCategory] = useState('')
  const [tagId, setTagId] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['leads', { q, hasWebsite, city, state, category, tagId, page }],
    queryFn: () =>
      api.listLeads({
        q,
        hasWebsite,
        city,
        state,
        category,
        tagId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  })

  const tagMutation = useMutation({
    mutationFn: ({ leadId, tagName, action }: { leadId: string; tagName: string; action: 'add' | 'remove' }) =>
      api.tagLead(leadId, tagName, action),
    onSuccess: () => {
      // refetch
      window.dispatchEvent(new CustomEvent('refetch-leads'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteLead,
    onSuccess: () => {
      toast.success('Lead deleted')
      window.dispatchEvent(new CustomEvent('refetch-leads'))
    },
  })

  const exportMutation = useMutation({
    mutationFn: async (opts: { selectedOnly?: boolean }) => {
      const filters = opts.selectedOnly
        ? { leadIds: Array.from(selected) }
        : { q, hasWebsite, city, state, category, tagId }
      const { blob, filename } = await api.exportLeads(filters)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    },
    onSuccess: () => toast.success('CSV exported'),
  })

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (!data) return
    if (selected.size === data.leads.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(data.leads.map((l) => l.id)))
    }
  }

  function applyTag() {
    if (!tagInput.trim()) return
    const tagName = tagInput.trim()
    const targets = selected.size > 0 ? Array.from(selected) : expanded ? [expanded] : []
    if (targets.length === 0) {
      toast.error('Select leads first or expand a row')
      return
    }
    Promise.all(targets.map((id) => api.tagLead(id, tagName, 'add')))
      .then(() => {
        toast.success(`Tagged ${targets.length} lead${targets.length > 1 ? 's' : ''} as "${tagName}"`)
        setTagInput('')
        window.dispatchEvent(new CustomEvent('refetch-leads'))
      })
      .catch((e) => toast.error(e.message))
  }

  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} total · {data ? (total - (data.total - data.leads.filter((l) => !l.website).length) > 0 ? '' : '') : ''}
            {data && data.leads.filter((l) => !l.website).length > 0 && (
              <span className="text-amber-600 font-medium ml-1">
                · {data.leads.filter((l) => !l.website).length} of {data.leads.length} shown have no website
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportMutation.mutate({ selectedOnly: selected.size > 0 })}
            disabled={exportMutation.isPending}
          >
            <Download className="h-4 w-4 mr-2" />
            {selected.size > 0 ? `Export ${selected.size} selected` : 'Export filtered'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-col md:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search business name, address, phone..."
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(0)
                }}
                className="pl-8"
              />
            </div>
            <Select
              value={hasWebsite}
              onValueChange={(v) => {
                setHasWebsite(v as 'any' | 'true' | 'false')
                setPage(0)
              }}
            >
              <SelectTrigger className="w-full md:w-44">
                <SelectValue placeholder="Website status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any website status</SelectItem>
                <SelectItem value="false">🚫 No website (prime)</SelectItem>
                <SelectItem value="true">Has website</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Select
              value={city || 'all'}
              onValueChange={(v) => {
                setCity(v === 'all' ? '' : v)
                setPage(0)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All cities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities</SelectItem>
                {data?.filters.cities.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={state || 'all'}
              onValueChange={(v) => {
                setState(v === 'all' ? '' : v)
                setPage(0)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {data?.filters.states.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={category || 'all'}
              onValueChange={(v) => {
                setCategory(v === 'all' ? '' : v)
                setPage(0)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {data?.filters.categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={tagId || 'all'}
              onValueChange={(v) => {
                setTagId(v === 'all' ? '' : v)
                setPage(0)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Any tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any tag</SelectItem>
                {data?.filters.tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Active filters + bulk tag */}
          {(city || state || category || tagId || hasWebsite !== 'any') && (
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Filter className="h-3 w-3" /> Filters:
              </span>
              {hasWebsite !== 'any' && (
                <Badge variant="secondary" className="gap-1">
                  {hasWebsite === 'false' ? 'No website' : 'Has website'}
                  <button onClick={() => setHasWebsite('any')}><X className="h-3 w-3" /></button>
                </Badge>
              )}
              {city && (
                <Badge variant="secondary" className="gap-1">
                  {city}
                  <button onClick={() => setCity('')}><X className="h-3 w-3" /></button>
                </Badge>
              )}
              {state && (
                <Badge variant="secondary" className="gap-1">
                  {state}
                  <button onClick={() => setState('')}><X className="h-3 w-3" /></button>
                </Badge>
              )}
              {category && (
                <Badge variant="secondary" className="gap-1">
                  {category}
                  <button onClick={() => setCategory('')}><X className="h-3 w-3" /></button>
                </Badge>
              )}
              {tagId && (
                <Badge variant="secondary" className="gap-1">
                  {data?.filters.tags.find((t) => t.id === tagId)?.name}
                  <button onClick={() => setTagId('')}><X className="h-3 w-3" /></button>
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk tag bar */}
      {(selected.size > 0 || expanded) && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3 flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">
              {selected.size > 0 ? `${selected.size} selected` : 'Single lead'}
            </span>
            <Input
              placeholder="Tag name (e.g. hot, called, sold)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              className="flex-1 min-w-40 h-8 max-w-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyTag()
              }}
            />
            <Button size="sm" variant="outline" onClick={applyTag}>
              <TagIcon className="h-3.5 w-3.5 mr-1" /> Apply Tag
            </Button>
            {selected.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Leads table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !data || data.leads.length === 0 ? (
            <div className="text-center py-16 px-4">
              <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">No leads found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Run a new search, or adjust your filters.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <Checkbox
                        checked={selected.size === data.leads.length && data.leads.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                    <th className="text-left px-3 py-2.5 font-medium">Business</th>
                    <th className="text-left px-3 py-2.5 font-medium hidden md:table-cell">Contact</th>
                    <th className="text-left px-3 py-2.5 font-medium hidden lg:table-cell">Location</th>
                    <th className="text-left px-3 py-2.5 font-medium hidden lg:table-cell">Rating</th>
                    <th className="text-left px-3 py-2.5 font-medium">Website</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {data.leads.map((lead) => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      checked={selected.has(lead.id)}
                      onToggle={() => toggleSelect(lead.id)}
                      expanded={expanded === lead.id}
                      onExpand={() => setExpanded(expanded === lead.id ? null : lead.id)}
                      onTag={(name, action) =>
                        tagMutation.mutate({ leadId: lead.id, tagName: name, action })
                      }
                      onDelete={() => deleteMutation.mutate(lead.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages} · {total.toLocaleString()} leads
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || isFetching}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || isFetching}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function LeadRow({
  lead,
  checked,
  onToggle,
  expanded,
  onExpand,
  onTag,
  onDelete,
}: {
  lead: Lead
  checked: boolean
  onToggle: () => void
  expanded: boolean
  onExpand: () => void
  onTag: (name: string, action: 'add' | 'remove') => void
  onDelete: () => void
}) {
  const hasNoWebsite = !lead.website
  const contact = lead.contacts?.[0]

  return (
    <>
      <tr
        className={`border-b last:border-0 hover:bg-muted/40 cursor-pointer ${checked ? 'bg-primary/5' : ''}`}
        onClick={onExpand}
      >
        <td className="px-3 py-2.5" onClick={(e) => { e.stopPropagation(); onToggle() }}>
          <Checkbox checked={checked} onCheckedChange={onToggle} />
        </td>
        <td className="px-3 py-2.5">
          <div className="font-medium">{lead.businessName}</div>
          {lead.category && (
            <div className="text-xs text-muted-foreground">{lead.category}</div>
          )}
          {lead.tags && lead.tags.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {lead.tags.map((t) => (
                <Badge key={t.tag.id} variant="outline" className="text-[10px] py-0 px-1.5">
                  {t.tag.name}
                </Badge>
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 hidden md:table-cell">
          {lead.phone ? (
            <div className="flex items-center gap-1.5 text-xs">
              <Phone className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono">{lead.phone}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
          {contact && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {contact.name}
              {contact.title ? ` · ${contact.title}` : ''}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 hidden lg:table-cell text-xs">
          {lead.city ? (
            <div className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-muted-foreground" />
              <span>{lead.city}{lead.state ? `, ${lead.state}` : ''}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5 hidden lg:table-cell">
          {lead.rating ? (
            <div className="flex items-center gap-1 text-xs">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              <span className="font-medium">{lead.rating.toFixed(1)}</span>
              <span className="text-muted-foreground">({lead.reviewsCount ?? 0})</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {hasNoWebsite ? (
            <Badge variant="default" className="bg-amber-500 hover:bg-amber-600 text-white gap-1">
              <AlertCircle className="h-3 w-3" /> No website
            </Badge>
          ) : (
            <a
              href={lead.website!.startsWith('http') ? lead.website! : `https://${lead.website}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Globe className="h-3 w-3" /> Visit
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </td>
        <td className="px-2 text-muted-foreground">
          <button
            onClick={(e) => { e.stopPropagation(); onExpand() }}
            className="p-1 hover:bg-muted rounded"
            aria-label="Expand"
          >
            {expanded ? <ChevronRight className="h-3 w-3 rotate-90" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-muted/20 border-b last:border-0">
          <td colSpan={7} className="px-6 py-4">
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-muted-foreground">Address</div>
                  <div>{lead.address || '—'}</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">City</div>
                    <div>{lead.city || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">State</div>
                    <div>{lead.state || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">ZIP</div>
                    <div>{lead.zip || '—'}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Phone</div>
                    <div className="font-mono">{lead.phone || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Website</div>
                    <div className="truncate">
                      {lead.website ? (
                        <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {lead.website}
                        </a>
                      ) : (
                        <span className="text-amber-600 font-medium">None — sales target</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Category</div>
                    <div>{lead.category || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Price</div>
                    <div>{lead.priceLevel || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Status</div>
                    <div>{lead.businessStatus || '—'}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Contact (extracted)</div>
                  {contact ? (
                    <div className="rounded-md border p-2 bg-background">
                      <div className="font-medium">{contact.name}</div>
                      {contact.title && <div className="text-xs text-muted-foreground">{contact.title}</div>}
                      {contact.email && <div className="text-xs">{contact.email}</div>}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        via {contact.source} · {Math.round(contact.confidence * 100)}% confidence
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No contact extracted. Enable enrichment in a future run.
                    </p>
                  )}
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {lead.tags?.map((t) => (
                      <Badge key={t.tag.id} variant="secondary" className="gap-1">
                        {t.tag.name}
                        <button onClick={() => onTag(t.tag.name, 'remove')}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    {lead.tags?.length === 0 && (
                      <span className="text-xs text-muted-foreground">No tags yet</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (confirm(`Delete "${lead.businessName}"?`)) onDelete()
                    }}
                  >
                    Delete
                  </Button>
                  <div className="text-[10px] text-muted-foreground self-end">
                    Discovered {new Date(lead.discoveredAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
