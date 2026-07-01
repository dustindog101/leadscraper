# DEVELOPMENT.md

> Developer guide for the Cybershare Lead Scraper.
> For architecture, see `ARCHITECTURE.md`. For agent handoff, see `CLAUDE.md` / `GLM.md`.

---

## 1. Local Setup

### Prerequisites
- **Bun** 1.3+ (preferred) or Node.js 20+
- ~500 MB free disk for Patchright/Playwright Chromium
- A Neon Postgres database (or local Postgres if you prefer)

### One-time install

```bash
cd /home/z/my-project

# 1. Install dependencies (also runs postinstall: prisma generate + patchright install)
bun install

# 2. Verify Chromium installed (postinstall should handle it)
bunx patchright install chromium

# 3. Configure environment
#   .env already exists in the repo's working copy. Verify it has:
#     DATABASE_URL=postgresql://neondb_owner:...neon.tech/neondb?sslmode=require
#     MISTRAL_API_KEY=MISTRAL_API_KEY_HERE
#     NEXTAUTH_SECRET=...
#     NEXTAUTH_URL=http://localhost:3000
cat .env

# 4. Push Prisma schema to Neon (creates tables if missing)
bun run db:push

# 5. Start the dev server (http://localhost:3000)
bun run dev

# 6. (Optional) Start the worker in another terminal to run scrapes locally
bun run worker
```

### First admin user
- Visit `http://localhost:3000` → click **Create Account**
- The first user created becomes `admin` automatically
- Subsequent signups require admin approval (status=`pending`)

### Default login (already seeded in production)
- Email: `manny@cybershare.tech`
- Password: `PASSWORD_HERE`

---

## 2. Project Structure

```
leadscraper/
├── prisma/
│   └── schema.prisma                # Prisma schema (User, SearchJob, Lead, etc.)
├── scripts/
│   ├── auto-commit.sh               # Git watcher (commits + pushes every 30s)
│   ├── git-setup.sh                 # One-time GitHub PAT setup
│   ├── start-watcher.sh             # Background launcher for auto-commit.sh
│   ├── seed-proxies.ts              # Insert Webshare proxy config
│   ├── seed-prod.ts                 # Seed production data
│   ├── railway-status.ts            # Query Railway project status
│   ├── railway-logs.ts              # Tail Railway worker logs
│   ├── railway-redeploy.ts          # Trigger Railway redeploy
│   ├── railway-update-config.ts     # Update Railway service config
│   ├── railway-service.ts           # Railway service helper
│   ├── railway-usage.ts             # Railway usage/billing
│   ├── railway-start.sh             # Convenience launcher
│   ├── translate-categories.ts      # One-off: zh → en category cleanup
│   ├── clean-addresses.ts           # One-off: strip Chinese country suffixes
│   ├── format-phones.ts             # One-off: normalize phone format
│   ├── rename-admin.ts              # One-off: rename admin user
│   └── set-email.ts                 # One-off: set user email
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/                # NextAuth + password reset
│   │   │   ├── jobs/                # Scrape job CRUD + cancel/pause
│   │   │   ├── leads/               # Lead CRUD + AI + tag + export
│   │   │   ├── proxies/             # Proxy CRUD + test + ProxyScrape fetch
│   │   │   ├── tags/                # Tag management
│   │   │   ├── users/               # User admin (approve/reject)
│   │   │   ├── settings/            # Configurable AI prompts
│   │   │   ├── stats/               # Dashboard metrics
│   │   │   ├── seed/                # First-admin bootstrap
│   │   │   └── route.ts             # Health check
│   │   ├── layout.tsx               # NextAuth + Theme + QueryClient providers
│   │   ├── globals.css              # Tailwind + theme tokens
│   │   └── page.tsx                 # SPA entry (login or dashboard)
│   ├── components/
│   │   ├── ui/                      # shadcn/ui primitives (60+ components)
│   │   ├── views/                   # Dashboard, NewSearch, Leads, Jobs, Proxies,
│   │   │                            #   Settings, Stats, Login, ResetPassword
│   │   ├── providers.tsx            # Theme + QueryClient providers
│   │   └── theme-toggle.tsx         # Dark/light mode toggle
│   ├── hooks/
│   │   ├── use-toast.ts             # Toast notifications
│   │   └── use-mobile.ts            # Mobile breakpoint hook
│   ├── lib/
│   │   ├── scraper.ts               # 3-phase Google Maps scraper (Patchright)
│   │   ├── job-runner.ts            # Run a SearchJob end-to-end
│   │   ├── worker.ts                # Long-lived poller (Railway)
│   │   ├── ai-analysis.ts           # Mistral: scoring, email, sentiment, call pitch
│   │   ├── ai-enrichment.ts         # Mistral: owner extraction from lead websites
│   │   ├── proxy.ts                 # ProxyRotator + URL parsing
│   │   ├── proxy-test.ts            # TCP + HTTP proxy testing
│   │   ├── proxyscrape.ts           # Fetch free proxies from ProxyScrape API
│   │   ├── db.ts                    # Prisma client singleton
│   │   ├── auth.ts                  # NextAuth config
│   │   ├── api/client.ts            # Typed API client for frontend
│   │   └── utils.ts                 # cn() + misc helpers
│   ├── types/
│   │   └── next-auth.d.ts           # Augment session type with role
│   └── worker.ts                    # Worker entry point (bun run worker)
├── download/                        # Screenshots for README
├── examples/websocket/              # Optional realtime examples (not used)
├── public/                          # Static assets (logo.svg, robots.txt)
├── .env                             # Local env (NEVER commit)
├── .env.example                     # Template
├── .env.local                       # Local overrides (gitignored)
├── .gitignore
├── bun.lock                         # Bun lockfile
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json                  # shadcn/ui config (New York style)
├── next.config.ts                   # Next.js config (standalone output)
├── eslint.config.mjs
├── Caddyfile                        # Optional reverse proxy config
├── LICENSE                          # MIT
├── README.md
├── HOSTING.md
├── CLAUDE.md / GLM.md               # Agent handoff
├── ARCHITECTURE.md                  # This system's design
├── DEVELOPMENT.md                   # You are here
└── TODO.md                          # Pending work
```

---

## 3. Common Dev Tasks

### Add a new API route

1. Create `src/app/api/<resource>/route.ts` (or `<resource>/[id]/route.ts`)
2. Always start with auth check:
   ```typescript
   import { NextResponse } from 'next/server'
   import { getServerSession } from 'next-auth'
   import { authOptions } from '@/lib/auth'
   import { db } from '@/lib/db'

   export async function GET() {
     const session = await getServerSession(authOptions)
     if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
     // ... your logic
   }
   ```
3. For admin-only: add `if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })`
4. Use `db` from `@/lib/db` (Prisma singleton)
5. Return errors as `{ error: string }` with proper status codes

### Add a new UI view

1. Create `src/components/views/<feature>-view.tsx`
2. Use shadcn/ui primitives from `@/components/ui/*`
3. Use TanStack Query for server state:
   ```typescript
   import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
   import { api } from '@/lib/api/client'

   const { data, isLoading } = useQuery({
     queryKey: ['leads'],
     queryFn: () => api.leads.list(),
   })
   ```
4. Wire it into `src/app/page.tsx` (the SPA entry — switch on view state)
5. Use the toast hook for user feedback: `const { toast } = useToast()`

### Modify the scraper

File: `src/lib/scraper.ts` (740 lines)

**Critical sections:**
- Lines 1-100: types + setup
- Phase 1 (collect): scroll loop, card extraction
- Phase 2 (enrich): place URL navigation, detail panel extraction
- Phase 3 (reviews): RPC + DOM fallback
- Dual contexts: `proxyContext` (Phase 1) + `enrichContext` (Phase 2/3)

**Gotchas:**
- Don't merge the two contexts — the proxy optimization depends on them being separate
- Always upsert via `onLead` callback (job-runner.ts) — don't write to DB directly from scraper
- Keep jitter delays (400-1200ms) — removing them triggers Google rate limits
- The `!9m1!1b1` URL fragment for reviews is critical — don't drop it

### Modify AI prompts

1. Edit defaults in `src/app/api/settings/route.ts` (`DEFAULT_PROMPTS` object)
2. Use `{placeholder}` syntax — they're substituted at call time in `ai-analysis.ts` / `ai-enrichment.ts`
3. After changing defaults, also update any saved overrides via:
   ```bash
   curl -X POST http://localhost:3000/api/settings \
     -H "Content-Type: application/json" \
     -H "Cookie: next-auth.session-token=..." \
     -d '{"action":"reset","key":"ai_score_prompt"}'
   ```

### Add a new AI feature

1. Add prompt template to `DEFAULT_PROMPTS` in `src/app/api/settings/route.ts`
2. Add the function in `src/lib/ai-analysis.ts` (or `ai-enrichment.ts` for website-based):
   ```typescript
   export async function myNewFeature(params: {...}): Promise<Result | null> {
     const promptTemplate = await getSettingValue('ai_my_feature_prompt')
     const prompt = promptTemplate
       .replace('{businessName}', params.businessName)
       // ... substitute placeholders
     const response = await callMistral(prompt, 500)
     if (!response) return null
     return JSON.parse(response)  // or plain text
   }
   ```
3. Add API route `src/app/api/leads/my-feature/route.ts`
4. Add UI button on lead detail that calls the API and persists the result
5. Add columns to `Lead` model in `prisma/schema.prisma` + run `bun run db:push`

---

## 4. Testing Patterns

This project has **no automated test suite** (small team, fast iteration). Testing is manual via curl + Agent Browser.

### API testing with curl

```bash
# 1. Get a session cookie (login)
curl -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/callback/credentials \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=manny@cybershare.tech&password=PASSWORD_HERE&csrfToken=$(curl -s http://localhost:3000/api/auth/csrf -c /tmp/cookies.txt | jq -r .csrfToken)&callbackUrl=http://localhost:3000"

# 2. List leads (using the session cookie)
curl -b /tmp/cookies.txt http://localhost:3000/api/leads?page=1 | jq .

# 3. Filter leads with no website
curl -b /tmp/cookies.txt "http://localhost:3000/api/leads?hasWebsite=false&page=1" | jq .

# 4. Run AI scoring on a lead
curl -b /tmp/cookies.txt -X POST http://localhost:3000/api/leads/score \
  -H "Content-Type: application/json" \
  -d '{"leadId":"<lead-id>"}' | jq .

# 5. Get settings (AI prompts)
curl -b /tmp/cookies.txt http://localhost:3000/api/settings | jq .

# 6. Test a proxy
curl -b /tmp/cookies.txt -X POST http://localhost:3000/api/proxies \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","type":"http","proxies":"http://WEBSHARE_USER:WEBSHARE_PASS@31.59.20.176:6754","rotateMode":"round-robin","enabled":true}'

# 7. Health check
curl http://localhost:3000/api
```

### UI testing with Agent Browser

The **`agent-browser` skill** can navigate, click, type, and snapshot pages. Use it to:

```bash
# Login flow
agent-browser navigate http://localhost:3000
agent-browser snapshot
agent-browser type "input[type=email]" manny@cybershare.tech
agent-browser type "input[type=password]" PASSWORD_HERE
agent-browser click "button[type=submit]"
agent-browser snapshot   # → verify dashboard loaded

# Create a scrape job
agent-browser click "text=New Search"
agent-browser type "[placeholder*=keyword]" barbers
agent-browser type "[placeholder*=location]" "Baltimore MD"
agent-browser click "text=Start Scrape"
agent-browser snapshot   # → verify job appears in Jobs view

# Verify leads appear
agent-browser click "text=Leads"
agent-browser snapshot
```

### Manual scrape test (smallest viable)

1. Start dev server: `bun run dev`
2. Start worker: `bun run worker` (separate terminal)
3. Login → New Search → "cafes" in "Rockville MD", max 10 results
4. Watch worker logs — should see `[worker] picked up job ...`
5. Watch Jobs view — progress should advance 0% → 30% (collect) → 70% (enrich) → 100% (reviews)
6. Switch to Leads view — should see ~10 leads with phone/website/address populated

---

## 5. Debugging Tips

### Vercel logs
```bash
# Via Vercel CLI (if installed)
vercel logs https://leadscraper.vercel.app

# Or use the dashboard:
# https://vercel.com/dustindog101/leadscraper/_logs
```

### Railway worker logs
```bash
# Via the Railway API helper script
bun run scripts/railway-logs.ts

# Or check status first
bun run scripts/railway-status.ts

# Or via dashboard:
# https://railway.app/project/aca1fd3c-842d-4a81-a657-bc87ef0fb690
```

### Local worker logs
```bash
# Foreground worker — logs to stdout
bun run worker

# Background — write to file
bun run worker > worker.log 2>&1 &
tail -f worker.log
```

### Dev server logs
```bash
# bun run dev tees to both stdout and dev.log
tail -f dev.log
```

### Prisma query logging (local)
Edit `src/lib/db.ts` temporarily:
```typescript
export const db = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
})
```
(Don't commit this — it's noisy in prod.)

### Neon SQL Editor
- Go to https://neon.tech → your project → SQL Editor
- Run queries directly: `SELECT * FROM "Lead" WHERE "website" IS NULL LIMIT 10;`
- Useful for inspecting data without writing a script

### Mistral API debugging
- Check if Mistral is reachable:
  ```bash
  curl https://api.mistral.ai/v1/chat/completions \
    -H "Authorization: Bearer MISTRAL_API_KEY_HERE" \
    -H "Content-Type: application/json" \
    -d '{"model":"mistral-small-latest","messages":[{"role":"user","content":"hi"}]}'
  ```
- 429 = rate limited (shouldn't happen — our 1100ms gap prevents it)
- 401 = bad API key

### Scraper debugging
Set `headless: false` in `scrapeGoogleMaps` call (in `job-runner.ts`):
```typescript
const result = await scrapeGoogleMaps({
  // ... existing opts
  headless: false,  // ← show the browser
})
```
You'll see Chromium open and scroll. Useful for diagnosing selector breakage.

---

## 6. Known Gotchas

### `.env` gets reset to SQLite by the sandbox
- **Symptom:** Prisma errors like `PrismaClientInitializationError: Database connection error`
- **Cause:** Sandbox sometimes overwrites `.env` with `.env.example` content (SQLite)
- **Fix:** Restore `.env` from the known-good values (see `CLAUDE.md` §2 or `GLM.md` §2)
- **Prevention:** Always `cat .env | grep DATABASE_URL` before running DB commands

### Neon DB sleeps after 5 min idle
- **Symptom:** First request after a pause takes ~1s extra
- **Cause:** Neon autosuspends compute to save free-tier quota
- **Fix:** None needed — it auto-wakes. For always-on, upgrade to Launch tier ($19/mo)

### Dev server may die in sandbox
- **Symptom:** `bun run dev` hangs or crashes silently
- **Cause:** Sandbox environment quirks with long-running processes
- **Fix:** `unset DATABASE_URL` then re-export inline:
  ```bash
  unset DATABASE_URL
  DATABASE_URL="postgresql://neondb_owner:NEON_PASSWORD_HERE@ep-round-frost-ad1cks0l.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require" bun run dev
  ```
- Alternative: `bun --bun run dev` (forces Bun runtime, sometimes more stable)

### Git filter-repo history
- **What happened:** Secrets were committed early in the project; `git filter-repo` scrubbed them
- **Symptom:** `git push --force` was needed once; existing clones may have stale refs
- **Fix:** If your local git state is weird, do a fresh clone:
  ```bash
  git clone https://github.com/dustindog101/leadscraper.git fresh-clone
  ```

### Prisma binary targets
- `schema.prisma` has `binaryTargets = ["native", "rhel-openssl-3.0.x"]`
- `native` = local dev + Vercel
- `rhel-openssl-3.0.x` = Railway (Nixpacks uses RHEL-based image)
- If you see `PrismaClientInitializationError: Query engine library does not exist`, run `bun run db:generate`

### Patchright vs Playwright
- This project uses **Patchright** (a Playwright fork with stealth patches)
- Import from `'patchright'`, not `'playwright'`
- `bunx patchright install chromium` (not `playwright install`)
- The two are API-compatible — existing Playwright knowledge transfers

### Webshare bandwidth limit
- Free tier = 1 GB/mo total across all 10 proxies
- A 5000-lead scrape uses ~500 MB-1 GB of proxy bandwidth
- When exhausted, `proxy-test.ts` detects HTTP 402 and shows "Bandwidth limit reached"
- **Workaround:** Switch to ProxyScrape (free, unlimited) via the Proxies UI → "Fetch free proxies"

### Job stuck on "running"
- **Cause:** Worker crashed mid-scrape
- **Fix:** Wait 30 min for stale recovery, OR manually reset:
  ```sql
  UPDATE "SearchJob" SET status='queued', "startedAt"=NULL WHERE id='<job-id>';
  ```

### `prisma db push` vs `prisma migrate`
- This project uses **`db push`** exclusively (no migration history)
- Why: Solo project, fast iteration, schema changes are non-destructive
- If you need a real migration: `bun run db:migrate` (creates migration files)
- Don't mix the two — pick one and stick with it

### Cuid vs UUID
- All IDs are `cuid()` (Prisma default), not UUIDs
- Why: Globally unique, sortable, URL-safe
- Don't change to `uuid()` — would break existing data

---

## 7. Code Style

### Framework patterns

**App Router (Next.js 16)**
- All routes in `src/app/` (not `pages/`)
- Server components by default; `"use client"` directive at top for client components
- API routes use `NextResponse.json()` for responses

**shadcn/ui (New York variant)**
- Components live in `src/components/ui/` (not `node_modules`)
- Configured via `components.json`
- Add new components: `bunx shadcn@latest add <component-name>`
- Style: New York (heavier shadows, smaller padding than Default)

**TanStack Query 5**
- QueryClient in `src/components/providers.tsx`
- Query keys: array format `['leads', { page, hasWebsite, ... }]`
- Invalidations: `queryClient.invalidateQueries({ queryKey: ['leads'] })`
- Mutations use `onSuccess` to invalidate the relevant queries

**Server Actions** — not currently used (this project uses API routes for everything)
- If you add server actions, place them in `src/app/<route>/actions.ts`
- They're a Next.js 16 feature — keep API routes for backward compat unless migrating

### TypeScript
- Strict mode enabled (`tsconfig.json`)
- Use `type` imports for types: `import { type Review } from './scraper'`
- Prisma types come from `@prisma/client` — don't redeclare
- Avoid `any` — use `unknown` + narrowing if needed

### Naming
- Files: `kebab-case.ts` (e.g. `ai-analysis.ts`, `proxy-test.ts`)
- Components: `PascalCase.tsx` (e.g. `LeadsView`, `ThemeToggle`)
- DB columns: `camelCase` (Prisma default)
- DB tables: `PascalCase` (Prisma default — Neon is case-sensitive, quoted)

### State management
- **Server state:** TanStack Query (everything from the API)
- **Local UI state:** React `useState` (small, ephemeral)
- **Global state:** None (no Redux/Zustand needed at this scale)
- **Theme:** `next-themes` (in `src/components/providers.tsx`)

### Styling
- **Tailwind CSS 4** (no `tailwind.config.js` needed for v4 — uses `@theme` in CSS)
- CSS variables for theme tokens (see `src/app/globals.css`)
- `cn()` utility (clsx + tailwind-merge) for conditional classes
- Dark mode via `class` strategy (`.dark` on `<html>`)

### Commits
- Auto-commit watcher uses format: `auto: YYYY-MM-DD HH:MM:SS UTC (N file(s))`
- Manual commits: use conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- All commits go to `main` — no feature branches (small team)

---

## 8. Useful Scripts

```bash
# Database
bun run db:push                # Push schema → Neon
bun run db:generate            # Regenerate Prisma client
bun run db:migrate             # Create migration (not used)
bun run db:reset               # Reset DB (destructive!)

# Dev
bun run dev                    # Next.js dev server on :3000
bun run worker                 # Scraper worker (foreground)
bun run lint                   # ESLint
bun run build                  # Production build (Vercel uses this)

# Railway
bun run scripts/railway-status.ts        # Check deployments
bun run scripts/railway-logs.ts          # Tail worker logs
bun run scripts/railway-redeploy.ts      # Trigger redeploy
bun run scripts/railway-update-config.ts # Update service config
bun run scripts/railway-service.ts       # Service helper
bun run scripts/railway-usage.ts         # Usage/billing

# Git
./scripts/auto-commit.sh                 # Start watcher (30s)
WATCH_INTERVAL=10 ./scripts/auto-commit.sh  # Custom interval
pkill -f auto-commit.sh                  # Stop watcher

# Seed / one-offs
bun run scripts/seed-proxies.ts          # Insert Webshare config
bun run scripts/seed-prod.ts             # Seed prod data
bun run scripts/translate-categories.ts  # zh → en categories
bun run scripts/clean-addresses.ts       # Strip country suffixes
bun run scripts/format-phones.ts         # Normalize phone format
bun run scripts/rename-admin.ts          # Rename admin user
bun run scripts/set-email.ts             # Set user email
```

---

## 9. Adding Dependencies

```bash
# Add a runtime dep
bun add <package>

# Add a dev dep
bun add -d <package>

# Remove
bun remove <package>

# Update all
bun update
```

**Before adding a dep, consider:**
- Can it be done with what's already installed? (Recharts, cheerio, papaparse cover most needs)
- Is it maintained? (Check npm)
- Is the bundle size worth it? (Vercel has a 250MB function size cap)

---

## 10. Performance Considerations

- **Avoid N+1 queries** — Prisma's `include` is your friend
- **Use indexes** — `schema.prisma` has `@@index` on `Lead.city`, `Lead.state`, `Lead.category`, `Lead.website`, `Lead.discoveredAt`
- **Limit result sets** — `/api/leads` paginates 25/page; don't fetch all leads at once
- **Cache AI results** — Don't call Mistral on every page load; persist to Lead row
- **Stream scraper progress** — `onLead` callback writes to DB live, UI polls every 2s for new leads

---

## 11. Related Docs

- **ARCHITECTURE.md** — system diagram, scraper phases, worker pattern, data model
- **CLAUDE.md** / **GLM.md** — agent handoff (quickstart, env vars, deployment)
- **TODO.md** — pending work + future features
- **README.md** — user-facing overview
- **HOSTING.md** — step-by-step deploy guide
- **worklog.md** — chronological work history
