# TODO.md

> Pending work + future features for the Cybershare Lead Scraper.
> Check `worklog.md` for chronological progress. Items in ✅ are done; 🚧 partial; ❌ not started.

---

## 1. Current Status (as of last update)

### ✅ Done
- **3-phase scraper** (`src/lib/scraper.ts`): collect → enrich → reviews, live DB writes
- **Dual browser contexts**: proxyContext (Phase 1 feed) + enrichContext (Phase 2/3 direct)
- **Worker pattern** (`src/worker.ts`): 5s poll, atomic claim, stale recovery (>30 min)
- **NextAuth credentials auth**: bcrypt, JWT sessions, admin-approval signup, password reset flow
- **Lead management**: filter/search/tag (single + bulk)/CSV export/pagination/expandable rows
- **Proxy CRUD + 4 input formats + rotation** (round-robin, random)
- **Lightweight TCP proxy test** (`src/lib/proxy-test.ts`): quickProxyTest + fullProxyTest (TCP + CONNECT + HTTPS exit-IP check)
- **Webshare integration**: 10 free residential proxies seeded
- **ProxyScrape fallback** (`src/lib/proxyscrape.ts`): fetch free public proxies on demand
- **Mistral AI scoring** (`src/lib/ai-analysis.ts` → `scoreLead`): 0-100 score + reason + recommendation, persisted on Lead
- **Mistral AI cold email generation** (`generateEmail`): subject + body, persisted
- **Mistral AI sentiment analysis** (`analyzeSentiment`): positive/negative themes + summary, persisted
- **Mistral AI cold call pitch** (`generateCallPitch`): 30-sec script, persisted
- **Mistral AI owner extraction** (`src/lib/ai-enrichment.ts` → `extractOwnersFromWebsite`): fetches lead website, cheerio-parses, extracts owner/manager + email + social links → LeadContact rows
- **Configurable AI prompts** (`/api/settings`): all 5 prompts editable by admin, reset to defaults, stored in `Setting` table
- **Dark/light mode** with `next-themes`
- **Dashboard** (`src/components/views/dashboard.tsx`): stats, top cities/categories, tag cloud, recent jobs
- **Production deployment**: Vercel + Railway + Neon, all green
- **Auto-commit watcher** (`scripts/auto-commit.sh`): 30s interval, timestamped messages, GitHub noreply email

### 🚧 Partial
- **Settings UI** (`src/components/views/settings-view.tsx`): team management works; AI prompt editors NOT yet wired
- **Proxy test results UI**: backend returns `{ok, exitIp, error, elapsedMs}`; frontend shows only basic ok/fail status (no latency, no exit IP)
- **Reviews UI**: reviews display in lead detail; "Rerun reviews" button NOT yet on lead detail
- **Call pitch UI**: API exists (`/api/leads/call-pitch`); button NOT yet on lead detail

### ❌ Not Started
- Website quality audit (Lighthouse-style)
- Competitor analysis
- Follow-up sequence generation
- Social media bio extraction
- Streaming AI results
- Batch AI calls (currently sequential due to Mistral 1 req/sec limit)
- Scheduled auto-scrapes
- Saved filter views
- Lead notes (free text)
- Activity log (contact attempts + outcomes)
- Screenshot capture of lead's current site
- Tech stack detection (WordPress, Wix, etc.)

---

## 2. Pending UI Work

These are **highest priority** — backend exists, UI just needs wiring.

### 2.1 Settings page — edit AI prompts
**Where:** `src/components/views/settings-view.tsx`
**Backend:** `GET /api/settings`, `PUT /api/settings`, `POST /api/settings` (reset)

**What to build:**
- For each of the 5 prompt keys (`ai_score_prompt`, `ai_email_prompt`, `ai_sentiment_prompt`, `ai_call_pitch_prompt`, `ai_owner_prompt`):
  - Show the current value in a `<Textarea>` (use `src/components/ui/textarea.tsx`)
  - Show "Last updated: {updatedAt}" if overridden
  - "Save" button → `PUT /api/settings { key, value }`
  - "Reset to default" button → `POST /api/settings { action: "reset", key }`
- Use TanStack Query:
  ```typescript
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.list() })
  const save = useMutation({
    mutationFn: ({ key, value }) => api.settings.update(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })
  ```
- Show a toast on save/reset via `useToast()`
- Restrict editing to admins (backend already enforces; UI should hide for non-admins)

**Acceptance criteria:**
- [ ] All 5 prompts visible in editable textareas
- [ ] Save persists to DB and shows "Last updated" timestamp
- [ ] Reset restores default and clears the timestamp
- [ ] Non-admins see read-only view
- [ ] Changes take effect on next AI call (no app restart needed)

### 2.2 Proxy test results UI
**Where:** `src/components/views/proxies-view.tsx`
**Backend:** `fullProxyTest()` from `src/lib/proxy-test.ts` returns `{ proxy, ok, exitIp?, error?, elapsedMs }`

**What to build:**
- "Test" button per proxy → calls `/api/proxies/[id]` with `?test=true` (or new `/api/proxies/[id]/test` route)
- Show results in a table or expandable row:
  - Status: ✅ Working / ❌ Failed
  - Exit IP: `{exitIp}` (or "—" if failed)
  - Latency: `{elapsedMs}ms`
  - Error message (if failed): `{error}` — special-case "Bandwidth limit reached (402)" with a warning chip
- "Test all" button → runs `testMultipleProxies` in parallel, shows progress
- Color-code results: green (working, <2s), yellow (working, >2s), red (failed)

**Acceptance criteria:**
- [ ] "Test" button on each proxy shows results inline
- [ ] Exit IP and latency visible
- [ ] 402/407 errors shown with helpful messaging
- [ ] "Test all" button works for proxy lists (round-robin configs)

### 2.3 Rerun reviews button on lead detail
**Where:** Lead detail row in `src/components/views/leads-view.tsx`
**Backend:** `POST /api/leads/rerun-reviews` with `{ leadId }`

**What to build:**
- Add a "Rerun reviews" button (refresh icon) to the lead detail expanded row
- On click → call API → invalidate `['lead', leadId]` query
- Show toast: "Re-scraping reviews..." → "Captured N new reviews"
- Disable button while loading (use `isPending` from `useMutation`)

**Acceptance criteria:**
- [ ] Button visible only when lead has a `placeUrl`
- [ ] Loading state during scrape (~5-15s)
- [ ] Reviews list refreshes automatically after success
- [ ] Error toast on failure

### 2.4 Call pitch button on lead detail
**Where:** Lead detail row in `src/components/views/leads-view.tsx`
**Backend:** `POST /api/leads/call-pitch` with `{ leadId }` → returns `{ pitch: string }`

**What to build:**
- Add "Generate call pitch" button (phone icon) to lead detail
- On click → call API → show pitch in a dialog (`src/components/ui/dialog.tsx`)
- Pitch text rendered in a styled card (large font, easy to read while on a call)
- "Copy to clipboard" button (use `navigator.clipboard.writeText`)
- Cache the result: if `lead.aiCallPitch` exists, show it instantly + offer "Regenerate"
- Add `aiCallPitch` + `aiCallPitchAt` fields to `Lead` in `schema.prisma` (these don't exist yet — need migration)

**Acceptance criteria:**
- [ ] Button generates pitch in ~2-3s
- [ ] Pitch displayed in a readable dialog
- [ ] Copy-to-clipboard works
- [ ] Cached result loads instantly on subsequent views
- [ ] Regenerate button forces a new Mistral call

### 2.5 Other UI polish (lower priority)
- [ ] Bulk "Generate emails" for selected leads (currently one at a time)
- [ ] Bulk "Score" for selected leads
- [ ] "AI status" badge on each lead: shows if scored/emailed/sentiment-analyzed
- [ ] Sortable columns on leads table (currently fixed order)
- [ ] Mobile-responsive dashboard (currently desktop-first)

---

## 3. Future Features

### 3.1 Website quality audit
**Goal:** For leads that HAVE a website, score the website's quality. Low-quality sites = prime upgrade targets.

**Approach:**
- Run Lighthouse (via `lighthouse` npm package) on each lead's website
- Capture: Performance, Accessibility, Best Practices, SEO scores (0-100)
- Detect: no SSL (http://), Wix/Weebly subdomain, broken links, missing meta tags
- Show scores in lead detail + filter "Low website quality" on leads view
- Optional: screenshot the homepage via Patchright

**Schema changes:**
```prisma
model WebsiteAudit {
  id           String   @id @default(cuid())
  leadId       String   @unique
  lead         Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  performance  Int?     // 0-100
  accessibility Int?
  bestPractices Int?
  seo          Int?
  hasSsl       Boolean?
  isBuilder    Boolean? // true if Wix/Weebly/Squarespace detected
  screenshotUrl String?
  auditedAt    DateTime @default(now())
}
```

**Estimated effort:** 1-2 days (Lighthouse in worker process, new API routes, UI badge)

---

### 3.2 Competitor analysis
**Goal:** For each lead, show 2-3 competitors in the same area + their website quality.

**Approach:**
- Use existing scraper to find same-category businesses in same city
- Compare: rating, review count, website presence, website quality
- Highlight opportunities: "Lead has no website, but 3 competitors do"

**Schema changes:**
```prisma
model Competitor {
  id          String  @id @default(cuid())
  leadId      String
  lead        Lead    @relation(fields: [leadId], references: [id], onDelete: Cascade)
  competitorLeadId String? // link to another Lead if scraped
  businessName String
  website     String?
  rating      Float?
  notes       String?  // "Has online booking", "Active blog", etc.

  @@index([leadId])
}
```

**Estimated effort:** 2-3 days

---

### 3.3 Follow-up sequence generation
**Goal:** Generate a 3-email follow-up sequence (initial → reminder → breakup) instead of single email.

**Approach:**
- New Mistral prompt: `ai_followup_prompt` (takes initial email + business info)
- Generate emails 2 and 3 based on email 1
- Persist all 3 in a new `EmailSequence` table or as JSON on Lead
- UI: "Generate follow-up sequence" button → shows all 3 emails in tabs

**Schema changes:**
```prisma
// Option A: JSON column on Lead
model Lead {
  // ... existing fields
  aiEmailSequence Json?     // [{ subject, body, dayOffset }, ...]
  aiEmailSequenceAt DateTime?
}

// Option B: Separate table
model EmailSequence {
  id       String @id @default(cuid())
  leadId   String
  step     Int    // 1, 2, 3
  subject  String
  body     String
  dayOffset Int   // send X days after previous
  createdAt DateTime @default(now())

  @@unique([leadId, step])
}
```

**Estimated effort:** 1 day

---

### 3.4 Social media bios extraction
**Goal:** For each lead, fetch their Facebook/Instagram bio + post frequency for outreach personalization.

**Approach:**
- Already extract social links in `ai-enrichment.ts` — extend to fetch bios
- Use Playwright (not cheerio) for Instagram/Facebook (JS-heavy)
- Store in `Lead.socialBio` JSON column
- Show in lead detail

**Estimated effort:** 1-2 days (Facebook/IG anti-scraping is tough — may need API access)

---

### 3.5 Scheduled auto-scrapes
**Goal:** Re-run a saved search weekly to find new businesses.

**Approach:**
- Add `cronSchedule` field to `SearchJob` (nullable)
- Vercel Cron job (free, daily at midnight) calls `/api/jobs/run-scheduled`
- Endpoint finds all jobs with `cronSchedule` matching today's day-of-week, creates new SearchJob instances
- UI: "Schedule weekly" toggle on New Search

**Schema changes:**
```prisma
model SearchJob {
  // ... existing fields
  isScheduled  Boolean  @default(false)
  cronSchedule String?  // "weekly-tuesday" or cron string
  lastRunAt    DateTime?
}
```

**Estimated effort:** 1 day

---

### 3.6 Saved filter views
**Goal:** Let users save common filter combinations ("No website + Baltimore + rating > 4").

**Schema:**
```prisma
model SavedFilter {
  id      String @id @default(cuid())
  userId  String
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  name    String
  filters Json   // { hasWebsite, city, category, tagId, q, ... }
  createdAt DateTime @default(now())

  @@index([userId])
}
```

**Estimated effort:** 0.5 day

---

### 3.7 Lead notes + activity log
**Goal:** Track contact attempts per lead.

**Schema:**
```prisma
model LeadNote {
  id        String @id @default(cuid())
  leadId    String
  lead      Lead   @relation(fields: [leadId], references: [id], onDelete: Cascade)
  userId    String
  user      User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      String // "note" | "call" | "email" | "meeting"
  content   String
  outcome   String? // "interested" | "not-interested" | "callback" | "no-answer"
  createdAt DateTime @default(now())

  @@index([leadId])
}
```

**Estimated effort:** 1 day

---

## 4. Performance Optimizations

### 4.1 Batch AI calls
**Current:** AI calls are sequential (Mistral 1 req/sec limit forces this)
**Problem:** Scoring 100 leads takes 100+ seconds
**Approach:**
- Use Mistral's batch API (if available on free tier)
- Or: switch to a higher-rate provider for batch jobs (OpenAI gpt-4o-mini: 500 req/min, $0.0001/lead)
- Add `MISTRAL_BATCH_SIZE` env var — if >1, use batch endpoint
- Keep Mistral for interactive single-lead calls (scoring on click)

**Estimated effort:** 0.5 day

### 4.2 Streaming AI results
**Current:** AI calls block until full response received (15s timeout)
**Problem:** User stares at spinner for 2-5s
**Approach:**
- Use Mistral's streaming endpoint (`"stream": true` in request body)
- Return SSE from API route — frontend renders text as it arrives
- Show email body appearing token-by-token (feels instant)

**Estimated effort:** 0.5 day

### 4.3 Background AI processing
**Current:** User clicks "Generate email" → waits 3s → sees result
**Problem:** Active wait feels slow
**Approach:**
- On scrape complete, automatically queue AI scoring for all leads
- Worker picks up AI jobs (new `AiJob` table or status flag on Lead)
- UI shows "AI in progress..." badge, results appear when ready
- Use a separate worker queue (or same Railway worker with priority)

**Estimated effort:** 1 day

### 4.4 DB query optimization
**Audit these endpoints:**
- `/api/leads` with complex filters — may need composite indexes
- `/api/stats` dashboard — currently 5+ queries per call; could be cached 60s
- `/api/leads/export` — streaming CSV instead of loading all into memory

### 4.5 Proxy bandwidth optimization
**Current:** Phase 1 (feed scroll) uses proxy; Phase 2/3 direct
**Could improve:**
- Detect when Webshare bandwidth is low (<100MB remaining) → auto-switch to ProxyScrape
- Cache Maps feed responses for repeated queries within 1 hour
- Skip Phase 1 if `placeId`s already in DB for this query+location combo (just re-enrich)

---

## 5. Known Bugs to Fix

### 5.1 Reviews sometimes duplicated
**Status:** 🚧 Partially fixed (dedupe by author + first 100 chars)
**Remaining:** If the same review text appears from different authors (rare but possible), we still dedupe. Should use Google's review ID instead.
**Fix:** Extract `data-review-id` attribute as the unique key.

### 5.2 `noWebsiteCount` doesn't update on re-enrichment
**Status:** 🚧 Fixed in `df4819a` (commit)
**Remaining:** Verify the fix works when a lead's website status changes (NULL → URL or vice versa) during a re-scrape. The `leadHasWebsite` Map tracks this but may have edge cases.

### 5.3 Settings UI team management: pending users don't show role badge
**Status:** ❌ Not fixed
**Where:** `src/components/views/settings-view.tsx`
**Fix:** Add a badge next to pending users ("Pending approval") with approve/reject buttons inline.

### 5.4 Phone numbers with extensions
**Status:** ❌ Not parsed
**Problem:** `tel:+12345678900;ext=123` — extension dropped during `format-phones.ts` one-off
**Fix:** Update `format-phones.ts` regex to capture and preserve extension as separate field, or in `phone` as `+1 234-567-8900 x123`.

### 5.5 Address parsing fails for non-US addresses
**Status:** ❌ US-only
**Problem:** `clean-addresses.ts` strips Chinese suffixes but doesn't parse non-US format addresses
**Fix:** Add country detection; use country-specific regex (UK postcode, Canadian postal code, etc.). Low priority — current market is US-only.

### 5.6 Webshare bandwidth exhaustion gives confusing error
**Status:** 🚧 Backend detects HTTP 402; UI doesn't surface it well
**Fix:** When `fullProxyTest` returns "Bandwidth limit reached", show a yellow banner on the Proxies view: "Webshare bandwidth exhausted — switch to ProxyScrape or upgrade" with a button to fetch free proxies.

### 5.7 Job progress can exceed 100% briefly
**Status:** ❌ Edge case
**Problem:** If Phase 3 has more leads than Phase 2 (shouldn't happen, but...), progress calculation could overshoot
**Fix:** Clamp progress to 100 in `job-runner.ts`:
```typescript
progress: Math.min(100, Math.round(70 + (30 * completed / total)))
```

### 5.8 Worker doesn't gracefully handle SIGTERM
**Status:** ❌ Not handled
**Problem:** Railway restarts send SIGTERM; worker dies mid-scrape → stale job
**Fix:** Add signal handler in `src/worker.ts`:
```typescript
let shuttingDown = false
process.on('SIGTERM', () => {
  console.log('[worker] SIGTERM received — shutting down gracefully')
  shuttingDown = true
  // Don't pick up new jobs; let current job finish (with timeout)
  setTimeout(() => process.exit(0), 60000)
})
// In pollOnce: if (shuttingDown) return false
```

### 5.9 CSV export missing some enriched fields
**Status:** ❌ Verify
**Problem:** Export CSV may not include `aiScore`, `aiEmailSubject`, etc.
**Fix:** Audit `/api/leads/export/route.ts` — add all useful fields as columns.

---

## 6. Documentation Tasks

- [ ] Add sequence diagrams for auth flow + scrape flow
- [ ] Document the `aiCallPitch` field once added (see §2.4)
- [ ] Update `README.md` screenshots after Settings UI work (§2.1)
- [ ] Add `CHANGELOG.md` (currently relying on git log + `worklog.md`)

---

## 7. Maintenance Tasks

### Weekly
- [ ] Check Railway usage: `bun run scripts/railway-usage.ts`
- [ ] Check Neon storage: <500 MB used?
- [ ] Check Webshare bandwidth: <500 MB used this month?
- [ ] Backup leads: Export CSV → store in cloud

### Monthly
- [ ] Rotate `NEXTAUTH_SECRET` (security best practice)
- [ ] Update dependencies: `bun update` → test locally → push
- [ ] Audit error logs on Vercel + Railway

### As needed
- [ ] When Webshare bandwidth exhausts: switch to ProxyScrape, or upgrade Webshare to Pro ($3.50/mo)
- [ ] When Neon hits 0.5 GB: archive old leads (export + delete), or upgrade to Launch ($19/mo)
- [ ] When Mistral free tier rate limit becomes painful: switch to OpenAI gpt-4o-mini ($0.15/M input tokens)

---

## 8. Prioritization Recommendations

If picking up this project fresh, do in this order:

1. **§2.4 Call pitch button** — quick win, completes an existing feature
2. **§2.3 Rerun reviews button** — quick win, completes an existing feature
3. **§2.1 Settings UI for AI prompts** — high value, makes prompts tunable
4. **§5.8 Worker SIGTERM handling** — prevents stuck jobs on Railway restarts
5. **§2.2 Proxy test results UI** — improves UX, helps debug Webshare issues
6. **§4.2 Streaming AI results** — perceived performance win
7. **§3.1 Website quality audit** — high-value feature, differentiates product
8. **§3.3 Follow-up sequence generation** — sales team will love this
9. **§3.5 Scheduled auto-scrapes** — reduces manual work
10. **§3.7 Lead notes + activity log** — pipeline tracking

---

## 9. Related Docs

- **ARCHITECTURE.md** — system design, data flow
- **DEVELOPMENT.md** — dev guide, testing patterns
- **CLAUDE.md** / **GLM.md** — agent handoff
- **worklog.md** — chronological work history
