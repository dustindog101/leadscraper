# TODO — Future Work

## ✅ Completed (v1.0)

### Core Scraper
- [x] Google Maps scraper with Patchright (anti-detect Playwright fork)
- [x] 3-phase architecture: collect (0-30%) → enrich (30-70%) → reviews (70-100%)
- [x] Dual browser contexts: proxy (feed only) + direct (enrichment) — saves ~90% proxy bandwidth
- [x] Live lead saving (leads appear in DB immediately, not at end)
- [x] 5-10,000 results per scrape
- [x] Retry logic (3 attempts with backoff for feed loading)
- [x] Warmup navigation (google.com → maps)
- [x] Concurrency (3 leads enriched in parallel)
- [x] Place URL capture (Google Maps link for each lead)
- [x] Rating + reviews count extraction (100% capture rate)
- [x] Reviews extraction (5 per lead via RPC + DOM fallback)
- [x] 10s per-lead timeout during reviews (prevents hanging)
- [x] Stale job recovery (>30min running → reset to queued)

### Job Management
- [x] Pause / Resume / Cancel / Retry buttons
- [x] Progress bar with phase labels (Collecting / Enriching / Extracting reviews)
- [x] Auto-refresh every 3s
- [x] Leads saved immediately (partial results preserved on cancel)

### Lead Management
- [x] Filter by: website status, city, state, category, tag, text search
- [x] Bulk select + delete
- [x] Bulk tag application
- [x] CSV export (includes reviews, placeUrl, AI results)
- [x] Expandable rows with full contact details
- [x] Google Maps link (📍 pin icon) on every lead
- [x] Reviews section in lead detail (scrollable, star ratings)
- [x] Discovered time shows full datetime

### AI Features (Mistral AI, free tier)
- [x] Lead scoring (0-100, persisted to DB)
- [x] Cold outreach email generation (persisted + copied to clipboard)
- [x] Review sentiment analysis (persisted, positive/negative themes)
- [x] Call pitch script (30-second, copied to clipboard)
- [x] Owner name extraction (from website HTML + AI)
- [x] Configurable prompts (admin can edit in Settings → AI Prompts)
- [x] All AI results persist on Lead model until explicitly regenerated

### Proxy Management
- [x] Webshare proxy support (HTTP/SOCKS5, single or rotating)
- [x] ProxyScrape free proxy fetch (one-click button)
- [x] Lightweight proxy testing (TCP connect + HTTP tunnel, <1s per proxy)
- [x] Batch proxy test (tests ALL proxies, shows per-proxy results)
- [x] Keep only working proxies option
- [x] Full proxy list visible in each config (not masked)

### Auth & Team
- [x] NextAuth credentials (email + password)
- [x] Admin-approval signup (new users need admin approval)
- [x] Specific login errors ("No account found" vs "Incorrect password")
- [x] Change password (Settings)
- [x] Forgot password (reset link generated)
- [x] Team management (approve/reject, role changes, reset passwords, delete)
- [x] User-scoped tags (each user's tags don't clutter others')

### Infrastructure
- [x] Vercel deployment (Next.js UI + API)
- [x] Railway worker (Patchright + Chromium with system deps)
- [x] Neon Postgres database
- [x] GitHub auto-commit watcher
- [x] Dark mode (toggle in header, light mode default)
- [x] Encrypted credentials (.credentials.enc with AES-256-CBC)
- [x] Comprehensive documentation (CLAUDE.md, GLM.md, ARCHITECTURE.md, DEVELOPMENT.md)

---

## 🔮 Future Features

### Phase 2: AI Enhancements
- [ ] **Website quality audit** — AI checks if their site is mobile-friendly, fast, modern (Lighthouse-style)
- [ ] **Competitor analysis** — find similar businesses nearby + compare ratings/reviews
- [ ] **Follow-up email sequence** — generate 3-email follow-up sequence (initial, reminder, break-up)
- [ ] **Social media bio generator** — generate Instagram/Facebook bio from reviews
- [ ] **Google Gemini integration** — add as alternative to Mistral (15 req/min vs 1 req/sec, better quality)
- [ ] **Batch AI enrichment** — score/email all leads at once (with rate limiting)
- [ ] **AI-powered lead prioritization** — auto-sort leads by score in the table

### Phase 3: Scraper Improvements
- [ ] **Scheduled scrapes** — cron jobs that re-scrape saved searches weekly
- [ ] **Multi-location search** — search "dentist" in multiple cities at once
- [ ] **Keyword presets** — save common search queries for reuse
- [ ] **Email finding** — scan website for mailto: links + contact forms
- [ ] **Social media extraction** — Facebook, Instagram, LinkedIn URLs from website
- [ ] **Website tech stack detection** — WordPress, Wix, Shopify, custom (helps pitch)
- [ ] **Screenshot capture** — grab a screenshot of their current website for the pitch
- [ ] **Broken link checker** — detect if their website is down/broken (opportunity)

### Phase 4: CRM Features
- [ ] **Lead notes** — free text notes per lead
- [ ] **Activity log** — track who contacted, when, outcome
- [ ] **Saved filter views** — save common filter combinations
- [ ] **Lead pipeline stages** — New → Contacted → Qualified → Won/Lost
- [ ] **Email tracking** — log sent emails per lead
- [ ] **Call logging** — track call outcomes
- [ ] **Reminder system** — "follow up with this lead in 3 days"
- [ ] **Lead assignment** — assign leads to specific team members

### Phase 5: Integrations
- [ ] **SendGrid/Resend integration** — send AI-generated emails directly from the app
- [ ] **Twilio integration** — make calls / send SMS from the app
- [ ] **Google Sheets export** — sync leads to a Google Sheet
- [ ] **Webhook notifications** — notify Slack/Discord when new leads are found
- [ ] **Zapier/Make.com webhook** — trigger automations when leads are scraped
- [ ] **Calendly embed** — include scheduling link in outreach emails

### Phase 6: Performance & Scale
- [ ] **Streaming AI results** — show AI generation progress in real-time
- [ ] **Background AI processing** — queue AI tasks via Inngest/Trigger.dev
- [ ] **Lead deduplication** — detect same business across different searches
- [ ] **Incremental scraping** — only scrape new leads since last run
- [ ] **Redis caching** — cache Google Maps responses to reduce scraping
- [ ] **Multi-worker scaling** — run multiple Railway workers for faster scraping

---

## 🐛 Known Issues

1. **Neon DB sleeps after 5 min inactivity** — first request after sleep takes ~1s extra. Not a bug, just free-tier behavior.
2. **Webshare bandwidth limit** — free tier is 1GB/month. When exhausted, proxies return HTTP 402. Upgrade or use ProxyScrape.
3. **Google Maps DOM changes** — selectors may break when Google updates their UI. Use `[data-item-id]` attributes (most stable).
4. **Reviews sometimes fail** — the RPC endpoint can hang. 10s timeout prevents blocking but some leads get 0 reviews. Use "Rerun Reviews" button.
5. **Railway worker may crash on restart** — jobs stuck in "running" are auto-recovered after 30 minutes.
6. **`.env` resets to SQLite in sandbox** — always check `cat .env | grep DATABASE_URL` before DB commands.
7. **Vercel function timeout** — 300s on free tier. Scraper runs on Railway worker, not Vercel.
8. **Mistral rate limit** — 1 req/sec on free tier. AI enrichment of many leads takes time.

---

## 📋 Maintenance Tasks

- [ ] Rotate Webshare proxy credentials quarterly
- [ ] Rotate GitHub/Vercel/Railway tokens annually
- [ ] Monitor Neon DB storage (0.5GB free tier)
- [ ] Monitor Railway usage ($5/mo hobby tier)
- [ ] Update Patchright/Playwright when new versions released
- [ ] Check Google Maps selectors after major Google UI updates
- [ ] Backup leads database weekly (CSV export or Neon branch)
