# CLAUDE.md — Agent Handoff Guide

> **Audience:** Claude (Sonnet/Opus/Haiku) AI agents picking up work on the Cybershare Lead Scraper codebase.
> **Last updated:** 2025-07

---

## 1. Project Overview

**Cybershare Lead Scraper** is a B2B lead-gen tool for [cybershare.tech](https://cybershare.tech). It scrapes Google Maps for businesses (optionally filtered to "no website"), enriches each lead with phone/website/address/reviews, then uses **Mistral AI** to score leads, write cold outreach emails, summarize review sentiment, generate cold-call scripts, and extract owner names from lead websites.

### Tech Stack

| Layer | Tech |
|---|---|
| Framework | **Next.js 16** (App Router) + React 19 + TypeScript 5 |
| Runtime | **Bun** 1.3+ (also works on Node 20+) |
| Scraping | **Patchright 1.61** (Playwright stealth fork) + Chromium |
| Database | **Prisma 6** + **Neon Postgres** (serverless, free 0.5 GB) |
| Auth | **NextAuth v4** (Credentials provider, JWT sessions, bcrypt) |
| AI | **Mistral AI** (`mistral-small-latest`, free tier, 1 req/sec) |
| UI | **shadcn/ui** (New York) + **Tailwind CSS 4** + Lucide + Recharts |
| Server state | **TanStack Query 5** |
| Deploy | **Vercel** (UI + API) + **Railway** (long-running worker) |

### Repository

- GitHub: [`dustindog101/leadscraper`](https://github.com/dustindog101/leadscraper) (private)
- Local path: `/home/z/my-project/`
- Default branch: `main`
- Auto-commit watcher: `scripts/auto-commit.sh` (polls every 30s, commits with timestamped message, pushes)

---

## 2. Quickstart — Run Locally

```bash
# 1. Install deps
cd /home/z/my-project
bun install

# 2. Install Patchright Chromium (postinstall hook usually does this)
bunx patchright install chromium

# 3. Verify .env (sandbox resets it to SQLite sometimes — see Gotchas)
cat .env   # should contain DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require

# 4. Push schema to Neon
bun run db:push

# 5. Start dev server (logs to dev.log + stdout)
bun run dev
# → http://localhost:3000
```

### Worker (optional — only needed to run scrapes locally)

```bash
bun run worker        # foreground
# or
bun run worker > worker.log 2>&1 &
```

The worker polls the DB every 5s for `queued` SearchJobs and runs them.

---

## 3. Deployment

### Vercel (UI + API)
- Token: `VERCEL_TOKEN_HERE`
- Repo auto-imports from `dustindog101/leadscraper` → `main`
- Build: `bun run build` (calls `prisma generate` first)
- Env vars: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `MISTRAL_API_KEY`

### Railway (scraper worker)
- API token: `RAILWAY_TOKEN_HERE`
- Project ID: `aca1fd3c-842d-4a81-a657-bc87ef0fb690`
- **No Dockerfile** — uses Nixpacks auto-detection
- Start command: `bun run worker`
- Build: `bun install && bunx patchright install --with-deps chromium` (postinstall hook handles Chromium)
- Env vars: `DATABASE_URL`, `MISTRAL_API_KEY`, `NODE_ENV=production`
- Useful scripts: `scripts/railway-status.ts`, `scripts/railway-logs.ts`, `scripts/railway-redeploy.ts`, `scripts/railway-update-config.ts`

### Neon (Postgres)
- Connection string: `postgresql://neondb_owner:NEON_PASSWORD_HERE@ep-round-frost-ad1cks0l.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require`
- Pooled connection (for serverless): append `-pooler` before the host and `&pgbouncer=true`
- DB sleeps after 5 min idle — first request takes ~1s extra to wake

---

## 4. Environment Variables

### `.env` (local dev — kept out of git)
```bash
NEXTAUTH_SECRET=cybershare-lead-scraper-dev-secret-change-this-in-production-9f3k2l
NEXTAUTH_URL=http://localhost:3000

DATABASE_URL=postgresql://neondb_owner:NEON_PASSWORD_HERE@ep-round-frost-ad1cks0l.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
DATABASE_URL_POOLED=postgresql://neondb_owner:NEON_PASSWORD_HERE@ep-round-frost-ad1cks0l-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true

MISTRAL_API_KEY=MISTRAL_API_KEY_HERE
```

### Production env vars (Vercel + Railway)
| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon connection string with `?sslmode=require` |
| `NEXTAUTH_SECRET` | ✅ | 32+ random chars — `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ (Vercel) | Full app URL, e.g. `https://leadscraper.vercel.app` |
| `MISTRAL_API_KEY` | ✅ | For AI features |
| `NODE_ENV` | ✅ (Railway) | `production` |

---

## 5. Architecture (read this before touching the scraper)

### Three-service topology
```
┌─────────────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  Vercel (Next.js)   │ ←→  │  Neon        │ ←→  │  Railway Worker      │
│  - UI + API routes  │     │  Postgres    │     │  - bun run worker    │
│  - NextAuth         │     │  (shared)    │     │  - Patchright        │
│  - 300s fn timeout  │     │  - 0.5 GB    │     │  - Proxy rotation    │
└─────────────────────┘     └──────────────┘     └──────────────────────┘
```

**Why split?** Vercel's 300s function timeout can't fit a 5,000-lead scrape (~1hr). The worker is a long-lived process that polls the shared DB.

### Scraper — 3 phases (`src/lib/scraper.ts`)
```
Phase 1 (collect)  0-30%   → Scroll feed, extract cards, save leads IMMEDIATELY
                              with basic data (name, rating, placeUrl).
Phase 2 (enrich)   30-70%  → Open each placeUrl for phone/website/address.
                              Upser lead with enriched data. Concurrency=3.
Phase 3 (reviews)  70-100% → Open placeUrl with `!9m1!1b1` fragment for reviews.
                              Capture up to 5 per lead. Non-blocking — if
                              cancelled, leads still have core data.
```

### Dual browser contexts (proxy optimization)
- **`proxyContext`** — used ONLY for loading the Maps feed (Phase 1 scroll). Routes through the selected proxy.
- **`enrichContext`** — direct connection, no proxy. Used for Phase 2 + 3 (enrichment + reviews). Direct is faster and saves proxy bandwidth.
- This split exists because Maps blocks IP-rate-limiting on the feed, but individual place pages don't.

### Worker pattern (`src/worker.ts` + `src/lib/job-runner.ts`)
```
loop forever:
  every 5s:
    1. recoverStaleJobs() — jobs running >30min reset to "queued"
    2. findFirst(status=queued, orderBy createdAt asc)
    3. atomic claim: updateMany(where id=X AND status=queued, set status=running)
       — if claim.count==0, another worker beat us; skip
    4. runSearchJob(id) in background (non-blocking)
```

`runSearchJob` writes leads to DB **as they're scraped** (via `onLead` callback) — the UI shows leads appearing live, even mid-scrape.

### AI architecture (`src/lib/ai-analysis.ts`, `src/lib/ai-enrichment.ts`)
- **Provider:** Mistral AI (`mistral-small-latest`) — free tier, 1 req/sec
- **Rate limit:** enforced in-process via `RATE_LIMIT_MS = 1100` (safety margin over 1000ms)
- **Timeout:** 15s per request, 8s for website fetches
- **Prompts:** configurable via `Setting` table (`/api/settings`) — see "Configurable Prompts" below
- **Features:**
  - `scoreLead` → 0-100 score + reason + recommendation
  - `generateEmail` → subject + body for cold outreach
  - `analyzeSentiment` → positive/negative themes + summary
  - `generateCallPitch` → 30-sec cold call script
  - `extractOwnersFromWebsite` (in `ai-enrichment.ts`) → fetches lead's website, cheerio-parses, extracts owner/manager names + emails + social links
- AI results are **persisted** on the Lead row (`aiScore`, `aiEmailSubject`, `aiSentimentSummary`, etc.) so they don't re-run on every view.

### Configurable prompts (`/api/settings`)
All 5 AI prompts live in `src/app/api/settings/route.ts` as `DEFAULT_PROMPTS`:
- `ai_score_prompt`
- `ai_email_prompt`
- `ai_sentiment_prompt`
- `ai_call_pitch_prompt`
- `ai_owner_prompt`

Admins can `PUT /api/settings { key, value }` to override (stored in `Setting` table), or `POST /api/settings { action: 'reset', key }` to restore defaults. Prompts support `{businessName}`, `{category}`, `{rating}`, `{reviewsCount}`, `{hasWebsite}`, `{reviews}`, `{websiteText}` placeholders.

### Proxy architecture
- **Webshare** (paid, residential) — 10 free proxies, 1 GB/mo bandwidth
  - Credentials: `WEBSHARE_USER:WEBSHARE_PASS`
  - Format: `http://WEBSHARE_USER:WEBSHARE_PASS@<host>:<port>`
  - May hit 1 GB bandwidth limit — `proxy-test.ts` detects HTTP 402 ("Bandwidth limit reached")
- **ProxyScrape** (free, public) — `src/lib/proxyscrape.ts` fetches lists from `api.proxyscrape.com/v2/`, no auth, lower quality but unlimited. Used as fallback.
- **Lightweight testing** — `src/lib/proxy-test.ts`:
  - `quickProxyTest` — TCP connect only, <1s, used for fast filtering
  - `fullProxyTest` — TCP + CONNECT tunnel + HTTPS request to `api.ipify.org` → returns exit IP + latency. Detects 402/407 errors.
  - `testMultipleProxies` — parallel batches of 5

---

## 6. Key Files Reference

| Path | Purpose |
|---|---|
| `src/lib/scraper.ts` | 3-phase Google Maps scraper (Patchright + Chromium) |
| `src/lib/job-runner.ts` | Runs a SearchJob end-to-end: marks running → scrapes → saves leads live → updates progress |
| `src/worker.ts` | Long-lived process that polls DB for queued jobs (Railway deployment) |
| `src/lib/ai-analysis.ts` | Mistral AI: scoring, email, sentiment, call pitch |
| `src/lib/ai-enrichment.ts` | Mistral AI owner/manager extraction from lead websites (cheerio) |
| `src/lib/proxy.ts` | `ProxyRotator` class — parses 4 input formats, round-robin/random |
| `src/lib/proxy-test.ts` | TCP + HTTP/HTTPS proxy testing |
| `src/lib/proxyscrape.ts` | Fetches free public proxy lists from ProxyScrape API |
| `src/lib/db.ts` | Prisma client singleton |
| `src/lib/auth.ts` | NextAuth config (Credentials provider, bcrypt, JWT) |
| `src/lib/api/client.ts` | Typed API client for frontend (TanStack Query) |
| `src/app/api/settings/route.ts` | GET/PUT/POST configurable AI prompts (admin-only mutations) |
| `prisma/schema.prisma` | DB schema — User, SearchJob, Lead, LeadContact, Tag, LeadTag, ProxyConfig, Review, Setting, PasswordReset |
| `scripts/auto-commit.sh` | Git watcher — commits + pushes every 30s |
| `scripts/railway-*.ts` | Railway API helpers (status, logs, redeploy, config, service, usage) |

---

## 7. Database Schema Overview

```prisma
User           ─┐
                ├── SearchJob ──── ProxyConfig (optional, used by job)
                │       │
                │       └── Lead ──┬── LeadContact (owner/manager names, AI-extracted)
                │                  │
                │                  ├── Review (Google Maps reviews, ≤5/lead)
                │                  │
                │                  └── LeadTag ←── Tag, User (user-scoped tags)
                │
                └── PasswordReset

Setting         ─── (key/value pairs for configurable AI prompts)
```

**Key design choices:**
- `Lead.placeId` unique — re-scraping same business **upserts** instead of duplicating
- `Lead.website` nullable — NULL = prime prospect (no website)
- `Lead.aiScore*`, `aiEmail*`, `aiSentiment*` fields — AI results persisted, regenerated on demand
- All IDs are `cuid()` for global uniqueness
- Binary targets: `["native", "rhel-openssl-3.0.x"]` — needed for both local + Railway

---

## 8. API Routes

```
/auth/[...nextauth]      NextAuth (sign in, sign out, session)
/auth/check-credentials  POST — validate email/password before signup
/auth/request-reset      POST — send reset email
/auth/reset-password     POST — set new password with token
/auth/change-password    POST — change while logged in

/jobs              GET list / POST create
/jobs/[id]         GET / DELETE / PATCH (cancel/pause/resume)

/leads             GET (filter/paginate) / DELETE (bulk)
/leads/[id]        GET / DELETE
/leads/score       POST — run AI scoring (single or batch)
/leads/email       POST — generate AI cold email
/leads/sentiment   POST — analyze review sentiment
/leads/call-pitch  POST — generate cold call script
/leads/enrich      POST — AI owner extraction from lead website
/leads/rerun-reviews POST — re-scrape reviews for a lead
/leads/export      GET — CSV export (filtered or selected)
/leads/tag         POST — bulk tag leads

/proxies           GET / POST
/proxies/[id]      GET / PATCH / DELETE
/proxies/proxyscrape POST — fetch free proxies from ProxyScrape API

/tags              GET / POST
/users             GET (admin) / POST (admin: approve/reject)
/users/[id]        PATCH (admin)
/settings          GET / PUT (admin) / POST (admin: reset prompt)
/stats             GET — dashboard metrics
/seed              POST — bootstrap first admin (one-time)
```

---

## 9. Current State

### ✅ Working
- 3-phase scraper (collect → enrich → reviews) with live DB writes
- Dual browser contexts (proxy for feed, direct for enrich)
- Stale job recovery (30min threshold)
- NextAuth credentials + admin-approval signup + password reset flow
- Lead management: filter/search/tag/bulk-tag/CSV export/pagination
- Proxy CRUD + 4 input formats + rotation + lightweight TCP test
- Webshare integration + ProxyScrape fallback
- Mistral AI: scoring, email, sentiment, call pitch, owner extraction
- AI prompts configurable via `/api/settings` (admin)
- AI results persisted on Lead rows
- Dark/light mode toggle
- Deployed: Vercel (UI) + Railway (worker) + Neon (DB) — all green

### 🚧 Partial / In Progress
- Settings UI (`src/components/views/settings-view.tsx`) — exists but doesn't yet expose all AI prompt editors; team management is wired
- Proxy test results UI — backend returns `{ok, exitIp, error, elapsedMs}`, frontend shows only basic status
- `rerun-reviews` API exists; UI button not yet on lead detail
- `call-pitch` API exists; UI button not yet on lead detail

### ❌ Known Issues
- Sandbox occasionally resets `.env` to SQLite — **always check `.env` before DB commands**
- Webshare free-tier bandwidth (1 GB/mo) exhausts quickly with large runs
- Neon sleeps after 5 min idle — first request after sleep has ~1s cold start
- git history was rewritten with `git filter-repo` to scrub secrets — `git push --force` was used

---

## 10. Git Workflow

- **Auto-commit watcher** (`scripts/auto-commit.sh`) — polls every 30s, stages all, commits with timestamped message, pushes to `main`. Configure with `GITHUB_TOKEN` env var.
- **Git identity:** `dustindog101` / `56493866+dustindog101@users.noreply.github.com` (GitHub noreply)
- **To start watcher:**
  ```bash
  GITHUB_TOKEN=ghp_xxx nohup ./scripts/auto-commit.sh > /tmp/auto-commit.log 2>&1 &
  ```
- **To stop:** `pkill -f auto-commit.sh`
- **Custom interval:** `WATCH_INTERVAL=10 ./scripts/auto-commit.sh`
- All commits go directly to `main` — no PRs (small team, solo project)

---

## 11. Claude-Specific Notes

- This is a TypeScript/Next.js 16 codebase — Claude handles these well natively.
- Use the **`fullstack-dev` skill** (if available) for new UI views or API routes — it scaffolds Next.js 16 + shadcn/ui patterns correctly.
- When editing Prisma schema: after edits, run `bun run db:push` (not `migrate`) — this project uses `db push` for fast iteration on Neon.
- When editing `src/lib/scraper.ts`: be careful with the dual-context logic. The proxy context is closed after Phase 1; the enrich context is created lazily. Don't merge them.
- When editing `src/lib/ai-analysis.ts`: prompts are NOT hardcoded here for the user-facing strings — they're in `src/app/api/settings/route.ts` (`DEFAULT_PROMPTS`). The lib reads from DB via `getSettingValue()` (check the import path).
- After schema changes, regenerate Prisma client: `bun run db:generate` (or `bun install` triggers `postinstall`).
- The dev server writes to `dev.log` via `tee` — pipe output is also live on stdout.

---

## 12. Useful Commands Cheat Sheet

```bash
# Dev
bun run dev                              # Next.js dev server on :3000
bun run worker                           # Background scraper worker
bun run lint                             # ESLint
bun run db:push                          # Push schema to Neon
bun run db:generate                      # Regenerate Prisma client

# Railway
bun run scripts/railway-status.ts        # Check deployments + service status
bun run scripts/railway-logs.ts          # Tail worker logs
bun run scripts/railway-redeploy.ts      # Trigger redeploy
bun run scripts/railway-update-config.ts # Update service config via API

# Git
./scripts/auto-commit.sh                 # Start watcher
pkill -f auto-commit.sh                  # Stop watcher

# Proxy / AI
bun run scripts/seed-proxies.ts          # Insert Webshare proxy config
bun run scripts/seed-prod.ts             # Seed production data
bun run scripts/translate-categories.ts  # One-off: zh → en
bun run scripts/clean-addresses.ts       # One-off: strip country suffixes
bun run scripts/format-phones.ts         # One-off: normalize phone format
```

---

## 13. Default Login

- URL (prod): `https://leadscraper.vercel.app` (or custom domain)
- Email: `manny@cybershare.tech`
- Password: `PASSWORD_HERE`
- Role: `admin`

First user created becomes admin; subsequent signups require admin approval.

---

## 14. Where to Look Next

- **`TODO.md`** — pending UI work + future features
- **`ARCHITECTURE.md`** — deep-dive system diagram + data flow
- **`DEVELOPMENT.md`** — dev guide, testing patterns, gotchas
- **`GLM.md`** — same project but with GLM 5.2-specific sandbox notes
- **`worklog.md`** — chronological history of agent work sessions
