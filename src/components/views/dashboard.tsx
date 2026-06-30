'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Globe,
  LayoutDashboard,
  Search,
  Users,
  Server,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatsView } from '@/components/views/stats-view'
import { NewSearchView } from '@/components/views/new-search-view'
import { LeadsView } from '@/components/views/leads-view'
import { JobsView } from '@/components/views/jobs-view'
import { ProxiesView } from '@/components/views/proxies-view'

type View = 'stats' | 'new-search' | 'leads' | 'jobs' | 'proxies'

interface DashboardProps {
  session: {
    user: {
      id: string
      email: string
      name?: string | null
      role: string
    }
  }
}

const NAV: { id: View; label: string; icon: React.ElementType }[] = [
  { id: 'stats', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'new-search', label: 'New Search', icon: Search },
  { id: 'leads', label: 'Leads', icon: Users },
  { id: 'jobs', label: 'Jobs', icon: Server },
  { id: 'proxies', label: 'Proxies', icon: Globe },
]

export function Dashboard({ session }: DashboardProps) {
  const [view, setView] = useState<View>('stats')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const initials = (session.user.name || session.user.email)
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-3 px-4 md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
              <Globe className="h-4 w-4" />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold leading-tight">Cybershare</div>
              <div className="text-[10px] text-muted-foreground leading-tight">Lead Scraper</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-xs font-medium">{session.user.name || session.user.email}</span>
              <span className="text-[10px] text-muted-foreground capitalize">{session.user.role}</span>
            </div>
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials || 'U'}</AvatarFallback>
            </Avatar>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut({ callbackUrl: '/' })}
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex w-56 flex-col border-r bg-background p-3 gap-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                view === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
          <div className="mt-auto pt-3 border-t text-[11px] text-muted-foreground">
            <p>v0.1 · Local build</p>
            <p className="mt-0.5">cybershare.tech</p>
          </div>
        </aside>

        {/* Mobile nav drawer */}
        {mobileNavOpen && (
          <div className="md:hidden fixed inset-0 z-30 top-14 bg-background/95 backdrop-blur p-4">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setView(item.id)
                  setMobileNavOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium mb-1',
                  view === item.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 md:p-6">
          {view === 'stats' && <StatsView onNavigate={setView} />}
          {view === 'new-search' && <NewSearchView onDone={() => setView('jobs')} />}
          {view === 'leads' && <LeadsView />}
          {view === 'jobs' && <JobsView />}
          {view === 'proxies' && <ProxiesView />}
        </main>
      </div>
    </div>
  )
}
