# ARCHITECTURE.md

> Deep-dive system architecture for the Cybershare Lead Scraper.
> For setup/commands, see `CLAUDE.md` or `GLM.md`. For dev workflow, see `DEVELOPMENT.md`.

---

## 1. System Diagram

```
                              ┌──────────────────────────────────────────────┐
                              │           USER (browser)                     │
                              │   manny@cybershare.tech / PASSWORD_HERE        │
                              └────────────────┬─────────────────────────────┘
                                               │ HTTPS
                                               ▼
                          ┌──────────────────────────────────────────────────────┐
                          │                   VERCEL (Next.js 16)                │
                          │  ─────────────────────────────────────────────────   │
                          │   • App Router (SSR + API routes)                    │
                          │   • NextAuth v4 (Credentials, JWT sessions)          │
                          │   • TanStack Query 5 (server state cache)            │
                          │   • shadcn/ui + Tailwind CSS 4                       │
                          │   • 300s serverless function timeout (Hobby tier)    │
                          │  ─────────────────────────────────────────────────   │
                          │   API ROUTES:                                        │
                          │     /api/auth/*        /api/jobs/*                  │
                          │     /api/leads/*       /api/proxies/*               │
                          │     /api/tags          /api/users/*                 │
                          │     /api/settings      /api/stats                   │
                          │     /api/seed                                       │
                          └────────────┬───────────────────────┬────────────────┘
                                       │                       │
                                       │                       │ (worker can't run
                                       │                       │  on Vercel — 300s
                                       │                       │  cap + no Chromium)
                                       │                       │
                                       │                       ▼
                                       │       ┌─────────────────────────────────┐
                                       │       │     RAILWAY (long-lived worker) │
                                       │       │  ─────────────────────────────  │
                                       │       │   • bun run worker (Nixpacks)   │
                                       │       │   • Patchright + Chromium       │
                                       │       │   • Proxy rotation              │
                                       │       │   • Polls DB every 5s for       │
                                       │       │     queued SearchJobs           │
                                       │       │   • Stale recovery (>30min)     │
                                       │       └────────────┬────────────────────┘
                                       │                    │
                                       └─────────┬──────────┘
                                                 │
                                                 ▼
                          ┌──────────────────────────────────────────────────────┐
                          │              NEON (serverless Postgres)              │
                          │  ─────────────────────────────────────────────────   │
                          │   • 0.5 GB free tier (~100K leads)                   │
                          │   • Auto-sleeps after 5 min idle                     │
                          │   • Pooled connection via PgBouncer                  │
                          │   • Tables: User, SearchJob, Lead, LeadContact,      │
                          │     Tag, LeadTag, ProxyConfig, Review, Setting,      │
                          │     PasswordReset                                    │
                          └──────────────────────────────────────────────────────┘
                                                 │
                                                 │ (worker + vercel
                                                 │  both read/write here)
                                                 ▼
                          ┌──────────────────────────────────────────────────────┐
                          │              EXTERNAL SERVICES                       │
                          │  ─────────────────────────────────────────────────   │
                          │   • Google Maps (scraped via Patchright)             │
                          │   • Mistral AI (mistral-small-latest, 1 req/s)       │
                          │   • Webshare (10 free residential proxies)           │
                          │   • ProxyScrape (free public proxy lists)            │
                          │   • api.ipify.org (proxy exit-IP check)              │
                          └──────────────────────────────────────────────────────┘
```

---

## 2. Scraper Flow — 3 Phases

File: `src/lib/scraper.ts` (orchestrator) + `src/lib/job-runner.ts` (DB integration)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SearchJob (status=queued)                            │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       │ Worker picks up job
                                       │ (atomic claim via updateMany)
                                       ▼
                ┌──────────────────────────────────────────────────────────┐
                │  runSearchJob(jobId) — src/lib/job-runner.ts             │
                │  • Set status=running, startedAt=now                     │
                │  • Load ProxyConfig if job.useProxy=true                 │
                │  • Build ProxyRotator (round-robin or random)            │
                │  • Wire onLead callback (upserts to DB live)             │
                └────────────────────────┬─────────────────────────────────┘
                                         │
                                         ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  PHASE 1 — COLLECT  (progress 0% → 30%)                                 │
   │  ───────────────────────────────────────                                │
   │  Browser context: proxyContext (uses selected proxy)                    │
   │  URL: https://www.google.com/maps/search/{query}+in+{location}         │
   │                                                                         │
   │  Loop:                                                                  │
   │    1. Scroll feed by viewport height                                    │
   │    2. Wait 400-1200ms (jitter)                                          │
   │    3. Extract cards via role="feed" + data-item-id selectors            │
   │    4. For each NEW card:                                                │
   │       - Parse placeId, businessName, rating, reviewsCount,             │
   │         category, lat/lng, businessStatus                               │
   │       - Build placeUrl (https://www.google.com/maps/place/?q=...        │
   │         + !8m2!3m{lat}!4m{lng} + !16s{placeId})                         │
   │       - Call onLead() → upsert Lead row IMMEDIATELY                     │
   │    5. Stop when cards.length >= maxResults OR feed exhausted            │
   │                                                                         │
   │  After Phase 1: close proxyContext (saves proxy bandwidth)              │
   └─────────────────────────────────────┬───────────────────────────────────┘
                                         │
                                         ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  PHASE 2 — ENRICH  (progress 30% → 70%)                                 │
   │  ───────────────────────────────────────                                │
   │  Browser context: enrichContext (DIRECT, no proxy)                      │
   │  Concurrency: 3 tabs in parallel                                        │
   │                                                                         │
   │  For each lead (batch of 3):                                            │
   │    1. Open placeUrl in new tab                                          │
   │    2. Wait for detail panel (role="region", data-item-id="phone:...")   │
   │    3. Extract:                                                          │
   │       - phone (data-item-id^=phone:)                                    │
   │       - website (data-item-id=authority → href)                         │
   │       - address (data-item-id=address → button aria-label)              │
   │    4. Parse city/state/zip from address (US format regex)               │
   │    5. Call onLead() again → upsert with enriched fields                 │
   │    6. Close tab                                                         │
   │    7. Update progress = 30 + (40 * completedCount / totalLeads)         │
   │                                                                         │
   │  Why direct (no proxy)? Individual Maps place pages don't rate-limit    │
   │  like the feed does. Direct is faster + saves Webshare bandwidth.       │
   └─────────────────────────────────────┬───────────────────────────────────┘
                                         │
                                         ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  PHASE 3 — REVIEWS  (progress 70% → 100%)   [optional, default on]     │
   │  ───────────────────────────────────────                                │
   │  Browser context: enrichContext (DIRECT, reuse)                         │
   │  Concurrency: 3 tabs                                                    │
   │                                                                         │
   │  For each lead:                                                         │
   │    1. Open placeUrl + "!9m1!1b1" fragment (reviews sort)                │
   │    2. Try RPC endpoint first (faster, returns JSON)                     │
   │       - POST to /_/LocalReviewsdata... with batch request               │
   │    3. Fallback: parse DOM (div[data-review-id])                         │
   │    4. Dedupe by authorName + first 100 chars of text                    │
   │    5. Take first 5 reviews                                              │
   │    6. Save to Review table (cascade delete with Lead)                  │
   │    7. Update progress = 70 + (30 * completed / total)                   │
   │                                                                         │
   │  Non-blocking: if job cancelled mid-Phase-3, all leads still have core  │
   │  data. Reviews just stop being captured.                                │
   └─────────────────────────────────────┬───────────────────────────────────┘
                                         │
                                         ▼
                ┌──────────────────────────────────────────────────────────┐
                │  Finalize:                                               │
                │  • status = "done"                                       │
                │  • progress = 100                                        │
                │  • leadsFound = count of unique placeIds                 │
                │  • noWebsiteCount = count where website IS NULL          │
                │  • finishedAt = now                                      │
                │  • Close all browser contexts                            │
                └──────────────────────────────────────────────────────────┘
```

### Cancel / Pause behavior
The `shouldCancel()` and `shouldPause()` callbacks poll the DB on each iteration:
- `status=cancelled` → stop loop, save what we have, mark job done with `errorMsg="Cancelled by user"`
- `status=paused` → wait in a tight loop (1s sleep) until status changes back to `running` or to `cancelled`

---

## 3. Dual Browser Contexts — Proxy Optimization

```
┌─────────────────────────────────────────────────────────────────┐
│  scrapeGoogleMaps()                                             │
│                                                                 │
│  ┌─────────────────────────────────────┐                       │
│  │  proxyContext                       │  ◄── created once     │
│  │  • Browser: shared                  │      with proxy       │
│  │  • Proxy: ProxyRotator.next()       │      URL              │
│  │  • Steal: Patchright stealth        │                       │
│  │  • Used: Phase 1 only (feed scroll) │                       │
│  └────────────────┬────────────────────┘                       │
│                   │                                             │
│                   │ (after feed exhausted)                      │
│                   ▼                                             │
│            CLOSE proxyContext  ← saves bandwidth                │
│                   │                                             │
│                   ▼                                             │
│  ┌─────────────────────────────────────┐                       │
│  │  enrichContext                      │  ◄── created once     │
│  │  • Browser: shared                  │      with NO proxy    │
│  │  • Proxy: NONE                      │      (direct)         │
│  │  • Steal: Patchright stealth        │                       │
│  │  • Used: Phase 2 + Phase 3          │                       │
│  └─────────────────────────────────────┘                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Rationale:**
- Google Maps rate-limits by IP on the **results feed** (Phase 1) → must use proxy
- Individual **place pages** (Phase 2/3) are not rate-limited → direct is faster
- Webshare free tier = 1 GB/mo → conserving proxy bandwidth is critical
- Maps place pages are ~5-15 KB each; the feed scroll is the bulk of bandwidth

---

## 4. Worker Pattern

File: `src/worker.ts`

```
┌────────────────────────────────────────────────────────────────────┐
│  main()                                                            │
│  ───────                                                           │
│  1. Log: "[worker] started — polling every 5s"                     │
│  2. Test DB connection (SELECT 1) — exit(1) if fail                │
│  3. recoverStaleJobs() on startup                                  │
│  4. Loop:                                                          │
│       while true:                                                  │
│         hadJob = pollOnce()                                        │
│         if !hadJob: sleep(5000ms)                                  │
│         else: loop immediately (check for more)                    │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  pollOnce()                                                        │
│  ──────────                                                        │
│  1. recoverStaleJobs() — every cycle (cheap query)                 │
│     WHERE status="running" AND startedAt < now()-30min             │
│     UPDATE → status="queued", startedAt=NULL                       │
│     (recovers from worker crash)                                   │
│                                                                    │
│  2. findFirst(where status="queued", orderBy createdAt ASC)        │
│     → returns oldest queued job                                    │
│                                                                    │
│  3. Atomic claim:                                                  │
│       updateMany(                                                  │
│         where: { id: job.id, status: "queued" },  ← guard          │
│         data: { status: "running", startedAt: now() }              │
│       )                                                            │
│     • If claimed.count == 0: another worker beat us → skip         │
│     • If claimed.count == 1: we own it                             │
│                                                                    │
│  4. runSearchJob(job.id) — FIRE AND FORGET (non-blocking)          │
│     • Catches errors, marks job as "failed"                        │
│     • Does NOT block the poll loop — next poll starts immediately  │
└────────────────────────────────────────────────────────────────────┘
```

### Why atomic claim matters
Multiple workers can run in parallel against the same DB. The `updateMany` with a `status="queued"` guard ensures exactly one worker picks up each job — no double-execution.

### Stale job recovery
If a worker crashes mid-scrape, the job stays `status="running"` forever. The recovery loop resets any job running >30min back to `queued` so another worker can pick it up. The 30-min threshold is well above the longest expected scrape (~10 min for 1000 leads).

---

## 5. AI Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  MISTRAL AI (api.mistral.ai)                                            │
│  ───────────────────────────────                                        │
│  • Model: mistral-small-latest                                          │
│  • Free tier: 1 req/sec (we enforce 1100ms safety margin)              │
│  • Endpoint: POST /v1/chat/completions                                  │
│  • Timeout: 15s per request                                             │
│  • Temperature: 0.3 (deterministic-ish)                                 │
│                                                                         │
│  Rate limiter (in-process):                                             │
│    lastRequestTime = 0                                                  │
│    rateLimit():                                                         │
│      elapsed = Date.now() - lastRequestTime                             │
│      if elapsed < 1100ms: sleep(1100 - elapsed)                         │
│      lastRequestTime = Date.now()                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │
       ┌──────────────────────────┴───────────────────────────┐
       │                                                      │
       ▼                                                      ▼
┌──────────────────────────────┐         ┌─────────────────────────────────────┐
│  src/lib/ai-analysis.ts      │         │  src/lib/ai-enrichment.ts           │
│  ──────────────────────      │         │  ──────────────────────             │
│  • scoreLead()               │         │  • extractOwnersFromWebsite()       │
│  • generateEmail()           │         │    1. fetch lead.website (8s t/o)   │
│  • analyzeSentiment()        │         │    2. cheerio.parse(html)           │
│  • generateCallPitch()       │         │    3. Strip scripts/styles          │
│                              │         │    4. Extract visible text          │
│  All read from Setting table │         │    5. Send text to Mistral with     │
│  for prompt templates:       │         │       ai_owner_prompt               │
│    ai_score_prompt           │         │    6. Parse JSON response           │
│    ai_email_prompt           │         │    7. Save LeadContact rows         │
│    ai_sentiment_prompt       │         │       (source="llm", confidence)    │
│    ai_call_pitch_prompt      │         │                                     │
│                              │         │  Also extracts: emails[],           │
│  Results PERSISTED on Lead:  │         │    socialLinks (FB/IG/LinkedIn/X)   │
│    aiScore, aiScoreReason,   │         │    description (meta description)   │
│    aiScoreRec, aiScoreAt     │         │                                     │
│    aiEmailSubject, aiEmailBody │        │  Cheerio used (not full browser)    │
│    aiSentimentSummary, etc.  │         │  because it's 10x faster and the    │
│                              │         │  sites don't need JS rendering.     │
└──────────────────────────────┘         └─────────────────────────────────────┘
```

### Configurable Prompts (DB-backed)

```
┌─────────────────────────────────────────────────────────────┐
│  Setting table                                              │
│  ──────────────                                             │
│  key             │ value                          │ category │
│  ────────────────┼────────────────────────────────┼───────── │
│  ai_score_prompt | "You are a B2B sales..."       │ ai       │
│  ai_email_prompt | "Write a cold outreach..."     │ ai       │
│  ai_sentiment_.. | "Analyze these reviews..."     │ ai       │
│  ai_call_pitch.. | "Write a 30-second cold..."    │ ai       │
│  ai_owner_prompt | "Extract owner/manager..."     │ ai       │
│  ────────────────┴────────────────────────────────┴───────── │
│                                                             │
│  Defaults: src/app/api/settings/route.ts → DEFAULT_PROMPTS  │
│  Override: PUT /api/settings { key, value }  (admin only)   │
│  Reset:   POST /api/settings { action:"reset", key }        │
│                                                             │
│  Placeholders substituted at call time:                     │
│    {businessName}  {category}  {rating}  {reviewsCount}     │
│    {hasWebsite}    {reviews}    {websiteText}                │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Data Model

```prisma
User                    ─── NextAuth user, role=admin|member, status=active|pending|rejected
  │                       (first user auto-becomes admin)
  │
  ├── PasswordReset      ─── token-based password reset (15-min expiry)
  │
  ├── SearchJob          ─── scrape job (query, location, maxResults, status, progress)
  │     │                  (status: queued|running|paused|done|failed|cancelled)
  │     │
  │     ├── ProxyConfig  ─── optional proxy used by this job
  │     │
  │     └── Lead         ─── one per business found
  │           │            (placeId unique → upserts on re-scrape)
  │           │            (website nullable → NULL = prime prospect)
  │           │
  │           ├── LeadContact  ─── owner/manager names (AI-extracted)
  │           │                   source: website-meta|website-about|llm|manual
  │           │                   confidence: 0-1
  │           │
  │           ├── Review        ─── Google Maps reviews (≤5 per lead)
  │           │
  │           └── LeadTag       ─── (leadId, tagId, userId) composite PK
  │                   ↑           (tags are user-scoped — each user's
  │                   │            tags don't clutter others' views)
  │                   │
  │                 Tag         ─── global tag definitions (name, color)
  │
  └── (LeadTag.userId backref)

Setting                 ─── key/value for configurable AI prompts (no relations)
```

### Key fields on Lead (AI-persisted results)
```prisma
aiScore         Int?        // 0-100
aiScoreReason   String?     // one-sentence reason
aiScoreRec      String?     // one-sentence recommendation
aiScoreAt       DateTime?   // when last scored

aiEmailSubject  String?     // generated email subject line
aiEmailBody     String?     // generated email body
aiEmailAt       DateTime?

aiSentimentSummary  String?     // 2-3 sentence summary
aiSentimentPositive String?     // comma-separated positive themes
aiSentimentNegative String?     // comma-separated negative themes
aiSentimentAt       DateTime?
```

These persist until explicitly regenerated. The UI shows cached results instantly and only calls the API on user action.

---

## 7. API Routes Overview

```
Auth                Jobs                Leads                  Proxies
─────────           ─────              ──────                 ───────
POST /auth/signin   GET  /jobs         GET    /leads          GET  /proxies
POST /auth/signup   POST /jobs         DELETE /leads (bulk)   POST /proxies
POST /auth/check-   GET  /jobs/[id]    GET    /leads/[id]     GET  /proxies/[id]
     credentials    DEL  /jobs/[id]    DELETE /leads/[id]     PATCH /proxies/[id]
POST /auth/request- PATCH /jobs/[id]   POST   /leads/score    DEL  /proxies/[id]
     reset                              POST   /leads/email    POST /proxies/
POST /auth/reset-                      POST   /leads/              proxyscrape
     password                          POST   /leads/
POST /auth/change-                          sentiment           Tags
     password                          POST   /leads/         ─────
                                          call-pitch        GET  /tags
                                          rerun-reviews     POST /tags
                                          tag
                                          enrich            Users
                                          export            ─────
                                                            GET  /users (admin)
Settings                                     Stats           POST /users (admin:
─────────                                   ──────                  approve/reject)
GET  /settings                              GET /stats       PATCH /users/[id]
PUT  /settings (admin)
POST /settings                              Seed             Misc
     (reset prompt)                         ──────           ──────
                                            POST /seed       GET  / (health)
```

### Conventions
- All routes use NextAuth `getServerSession` for auth — no anonymous access except `/api/seed` (one-time bootstrap) and `/api/auth/*`
- Admin-only routes check `session.user.role === "admin"` and return 403 otherwise
- Errors return `{ error: string }` with appropriate HTTP status
- List endpoints support query params for filtering/pagination (e.g. `?page=1&q=...&hasWebsite=false`)

---

## 8. Security Model

### Authentication
- **NextAuth v4** with Credentials provider (email + password)
- Passwords hashed with **bcryptjs** (10 rounds)
- JWT sessions (no DB session storage — keeps Neon connections minimal)
- `NEXTAUTH_SECRET` required — 32+ random chars
- Session cookie: `next-auth.session-token` (httpOnly, secure in prod)

### Authorization
- **Roles:** `admin` (full access) and `member` (default)
- **First user auto-becomes admin** — bootstrap via `/api/seed` or first signup
- **Admin-approval signup:** new users created with `status="pending"` — admin must approve via `/api/users` POST before they can log in
- Admin-only endpoints: `/api/settings` (PUT/POST), `/api/users` (POST/PATCH)

### User-scoped tags
- Tags are global definitions (anyone can see them)
- **LeadTag has a 3-part composite key:** `(leadId, tagId, userId)`
- When user A tags a lead "hot", user B doesn't see that tag applied
- This prevents one user's pipeline state from cluttering another's

### Lead pool
- All users see all leads (shared pool — team is small)
- No row-level security on Lead

### Secrets in env vars (never committed)
- `DATABASE_URL` (Neon connection string)
- `NEXTAUTH_SECRET`
- `MISTRAL_API_KEY`
- Tokens for Railway/Vercel API live in shell env, not the repo

### Password reset flow
1. `POST /api/auth/request-reset { email }` → generate token, store in `PasswordReset` (15-min expiry)
2. Email link: `/reset-password?token=...`
3. `POST /api/auth/reset-password { token, newPassword }` → verify token, update passwordHash, mark `usedAt`
4. Tokens are single-use (checked via `usedAt IS NULL`)

---

## 9. Proxy Architecture — Detailed

```
                        ┌─────────────────────────────┐
                        │  ProxyConfig table          │
                        │  ───────────────────        │
                        │  name, type, proxies        │
                        │  (newline-separated list)   │
                        │  rotateMode: round-robin|   │
                        │              random         │
                        │  enabled: boolean           │
                        └──────────┬──────────────────┘
                                   │
                                   ▼
                        ┌─────────────────────────────┐
                        │  ProxyRotator class         │
                        │  (src/lib/proxy.ts)         │
                        │  ──────────────────────     │
                        │  Parses 4 input formats:    │
                        │   1. http://u:p@h:port      │
                        │   2. socks5://h:port        │
                        │   3. h:port:u:p (legacy)    │
                        │   4. h:port (assume http)   │
                        │                             │
                        │  .next() → returns next URL │
                        │  (round-robin index OR      │
                        │   random pick)              │
                        └──────────┬──────────────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                │                  │                  │
                ▼                  ▼                  ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │  Webshare (paid) │  │  ProxyScrape     │  │  Manual / custom │
   │  ──────────────  │  │  ──────────────  │  │  ──────────────  │
   │  10 residential  │  │  Free, public    │  │  Any user-added  │
   │  Auth required   │  │  No auth         │  │  proxy URL       │
   │  1 GB/mo limit   │  │  Lower quality   │  │                  │
   │                  │  │  Unlimited qty   │  │                  │
   │  Detected via    │  │  Fetched on-     │  │                  │
   │  HTTP 402 in     │  │  demand from     │  │                  │
   │  proxy-test.ts   │  │  proxyscrape.com │  │                  │
   └──────────────────┘  └──────────────────┘  └──────────────────┘

                        ┌─────────────────────────────┐
                        │  Proxy Testing               │
                        │  (src/lib/proxy-test.ts)     │
                        │  ──────────────────────      │
                        │  quickProxyTest(url):        │
                        │    TCP connect only          │
                        │    <1 second                 │
                        │    Used for fast filtering   │
                        │                              │
                        │  fullProxyTest(url):         │
                        │    1. quickProxyTest         │
                        │    2. HTTP CONNECT tunnel    │
                        │       to api.ipify.org:443   │
                        │    3. HTTPS GET /?format=json│
                        │    Returns: {ok, exitIp,     │
                        │              error, elapsedMs}│
                        │    Detects: 402 bandwidth,   │
                        │              407 auth failed │
                        │                              │
                        │  testMultipleProxies(urls):  │
                        │    Parallel batches of 5     │
                        │    Returns: {working, failed}│
                        └─────────────────────────────┘
```

---

## 10. Deployment Topology — Detailed

### Vercel
- **Framework preset:** Next.js (auto-detected)
- **Build command:** `bun run build`
  - Runs `prisma generate` → `next build` → copies standalone output
- **Install command:** `bun install` (auto-detects bun.lock)
- **Output:** `.next/standalone/` (Next.js 16 standalone mode)
- **Function timeout:** 300s (Hobby tier cap)
- **Regions:** Default (iad1 — US East), matches Neon region for low latency
- **Auto-deploy:** On push to `main`

### Railway (worker)
- **Buildpack:** Nixpacks (auto-detects Bun from `bun.lock`)
- **No Dockerfile** — kept simple, nixpacks handles Playwright deps via `bunx patchright install --with-deps chromium` in `postinstall`
- **Start command:** `bun run worker`
- **Restart policy:** Always (Railway auto-restarts on crash)
- **Health check:** None (worker doesn't serve HTTP — Railway marks it "running" once `bun run worker` starts)
- **Resources:** 512MB RAM, 1 vCPU (hobby tier) — sufficient for 3 concurrent enrich tabs
- **Auto-deploy:** On push to `main`
- **API access:** Token `RAILWAY_TOKEN_HERE`, project `aca1fd3c-842d-4a81-a657-bc87ef0fb690`
  - Scripts in `scripts/railway-*.ts` use GraphQL API to query status, fetch logs, trigger redeploy, update config

### Neon
- **Region:** US East (matches Vercel)
- **Postgres version:** Latest (16+)
- **Compute:** Free tier — 0.25 AU, autosuspends after 5 min idle
- **Storage:** 0.5 GB (≈100K leads)
- **Connection modes:**
  - Direct (`DATABASE_URL`): for worker (long-lived connection)
  - Pooled (`DATABASE_URL_POOLED`): for serverless functions (PgBouncer, transaction mode)
- **Binary targets in schema.prisma:** `["native", "rhel-openssl-3.0.x"]` — `native` for local + Vercel, `rhel-openssl-3.0.x` for Railway's Nixpacks image

---

## 11. Caching & Persistence Strategy

| Data | TTL | Where | Notes |
|---|---|---|---|
| AI scoring | Until regenerated | `Lead.aiScore*` columns | Re-run via `/api/leads/score` POST |
| AI email | Until regenerated | `Lead.aiEmail*` columns | Re-run via `/api/leads/email` POST |
| AI sentiment | Until regenerated | `Lead.aiSentiment*` columns | Re-run via `/api/leads/sentiment` POST |
| Reviews | Until re-scraped | `Review` table | Re-run via `/api/leads/rerun-reviews` POST |
| Lead data | Forever | `Lead` table | Upsert by `placeId` — re-scrape updates |
| Job state | Forever | `SearchJob` table | Audit trail of all scrapes |
| Sessions | 30 days (NextAuth default) | JWT cookie | Stateless, no DB lookup per request |
| Prompts | Until edited | `Setting` table | Falls back to `DEFAULT_PROMPTS` |

---

## 12. Failure Modes & Recovery

| Failure | Detection | Recovery |
|---|---|---|
| Worker crash mid-scrape | `SearchJob.status="running"` for >30 min | `recoverStaleJobs()` resets to `queued` |
| Vercel function timeout | Job created but worker not running | Job stays `queued` until worker picks up |
| Neon DB sleep | First request after idle takes ~1s | Automatic wake on connection |
| Google Maps block | Scraper detects "unusual traffic" | Returns `blocked=true`, job marked `failed` with error |
| Webshare bandwidth exhausted | `fullProxyTest` gets HTTP 402 | UI shows "Bandwidth limit reached"; user switches to ProxyScrape |
| Mistral API rate limit | `429 Too Many Requests` response | `rateLimit()` ensures 1.1s gap; on 429, retry once after 5s |
| Mistral API timeout | `AbortController` after 15s | Returns `null` — UI shows "AI unavailable" |
| Patchright/Chromium missing | Worker fails to launch browser | Crash → Railway restarts → `postinstall` re-runs `patchright install` |

---

## 13. Performance Characteristics

- **Scraper throughput:** ~1000 leads / 10 min (depends on Maps response time + concurrency)
- **AI per-lead latency:** ~2s (scoring + email), ~3s (sentiment with 5 reviews), ~5s (owner extraction with website fetch)
- **AI batch throughput:** 1 lead/sec (Mistral free-tier rate limit)
- **DB writes:** Live upserts during scrape — UI sees leads appear within seconds
- **Worker poll:** 5s interval — job pickup latency ≤5s
- **Stale recovery:** 30-min threshold — crashed jobs retry within 30 min
- **Neon cold start:** ~1s on first request after idle

---

## 14. Related Files

- **README.md** — user-facing overview, screenshots, setup
- **HOSTING.md** — step-by-step deployment guide
- **CLAUDE.md** / **GLM.md** — agent handoff docs (this file's siblings)
- **DEVELOPMENT.md** — dev workflow, testing patterns, gotchas
- **TODO.md** — pending work + future features
- **worklog.md** — chronological work history
