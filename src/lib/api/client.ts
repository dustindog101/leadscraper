/** Small typed fetch helpers for the API routes. */

export interface Job {
  id: string
  query: string
  location: string
  maxResults: number
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
  leadsFound: number
  noWebsiteCount: number
  errorMsg?: string | null
  useProxy: boolean
  proxyConfigId?: string | null
  proxyConfig?: { id: string; name: string } | null
  startedAt?: string | null
  finishedAt?: string | null
  createdAt: string
  updatedAt: string
  user?: { id: string; name: string | null; email: string }
}

export interface Lead {
  id: string
  placeId: string
  businessName: string
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  phone?: string | null
  website?: string | null
  category?: string | null
  rating?: number | null
  reviewsCount?: number | null
  priceLevel?: string | null
  lat?: number | null
  lng?: number | null
  businessStatus?: string | null
  sourceJobId?: string | null
  discoveredAt: string
  updatedAt: string
  contacts?: LeadContact[]
  tags?: { tag: Tag }[]
}

export interface LeadContact {
  id: string
  name: string
  title?: string | null
  email?: string | null
  confidence: number
  source: string
  verified: boolean
}

export interface Tag {
  id: string
  name: string
  color?: string | null
}

export interface ProxyConfig {
  id: string
  name: string
  type: 'http' | 'socks5' | 'socks4'
  proxies: string
  rotateMode: 'round-robin' | 'random'
  enabled: boolean
  createdAt: string
  proxyCount?: number
  proxyDescription?: string
  proxiesPreview?: string[]
}

export interface User {
  id: string
  email: string
  name?: string | null
  role: string
  status: string
  createdAt: string
}

export interface Stats {
  totalLeads: number
  noWebsiteLeads: number
  websiteCoverage: number
  totalJobs: number
  runningJobs: number
  recentJobs: Job[]
  topCities: { city: string; _count: number }[]
  topCategories: { category: string; _count: number }[]
  tags: { id: string; name: string; color?: string | null; count: number }[]
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

export const api = {
  // Jobs
  createJob: (data: {
    query: string
    location: string
    maxResults: number
    useProxy?: boolean
    proxyConfigId?: string
  }) => fetchJson<{ job: Job }>('/api/jobs', { method: 'POST', body: JSON.stringify(data) }),

  listJobs: (limit = 20) =>
    fetchJson<{ jobs: Job[] }>(`/api/jobs?limit=${limit}`),

  getJob: (id: string) => fetchJson<{ job: Job }>(`/api/jobs/${id}`),

  cancelJob: (id: string) =>
    fetchJson<{ job: Job }>(`/api/jobs/${id}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'cancel' }),
    }),

  // Leads
  listLeads: (params: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') sp.set(k, String(v))
    })
    return fetchJson<{
      leads: Lead[]
      total: number
      noWebsiteTotal: number
      offset: number
      limit: number
      filters: {
        cities: string[]
        states: string[]
        categories: string[]
        tags: Tag[]
      }
    }>(`/api/leads?${sp.toString()}`)
  },

  exportLeads: (data: Record<string, unknown>) =>
    fetch('/api/leads/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(async (r) => ({
      blob: await r.blob(),
      filename:
        r.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ||
        `leads-${Date.now()}.csv`,
    })),

  deleteLead: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/leads/${id}`, { method: 'DELETE' }),

  tagLead: (leadId: string, tagName: string, action: 'add' | 'remove') =>
    fetchJson<{ ok: boolean }>(`/api/leads/tag`, {
      method: 'POST',
      body: JSON.stringify({ leadId, tagName, action }),
    }),

  // Proxies
  listProxies: () => fetchJson<{ configs: ProxyConfig[] }>('/api/proxies'),

  createProxy: (data: {
    name: string
    type: 'http' | 'socks5' | 'socks4'
    proxies: string
    rotateMode?: 'round-robin' | 'random'
    enabled?: boolean
  }) => fetchJson<{ config: ProxyConfig }>('/api/proxies', { method: 'POST', body: JSON.stringify(data) }),

  deleteProxy: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/proxies/${id}`, { method: 'DELETE' }),

  toggleProxy: (id: string, enabled: boolean) =>
    fetchJson<{ config: ProxyConfig }>(`/api/proxies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  testProxy: (proxies: string) =>
    fetchJson<{ ok: boolean; exitIp?: string; elapsedMs?: number; error?: string }>(
      '/api/proxies/test',
      { method: 'POST', body: JSON.stringify({ proxies }) }
    ),

  // Stats
  getStats: () => fetchJson<Stats>('/api/stats'),

  // Tags
  deleteTag: (id: string) => fetchJson<{ ok: boolean }>(`/api/tags?id=${id}`, { method: 'DELETE' }),

  // Auth / password management
  changePassword: (currentPassword: string, newPassword: string) =>
    fetchJson<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  requestReset: (email: string) =>
    fetchJson<{ ok: boolean; resetUrl?: string; message?: string }>('/api/auth/request-reset', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, newPassword: string) =>
    fetchJson<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  // User management (admin)
  listUsers: () => fetchJson<{ users: User[] }>('/api/users'),

  updateUser: (id: string, data: { role?: string; name?: string; password?: string }) =>
    fetchJson<{ user: User }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteUser: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),
}
