<div align="center">

# 🌐 Cybershare Lead Scraper

**Find businesses on Google Maps that don't have a website — your next client.**

Built for [cybershare.tech](https://cybershare.tech) to find SMBs that need a website.

[![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=flat&logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)](https://playwright.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## 📸 Preview

### Dashboard — at-a-glance stats
![Dashboard](download/01-dashboard.png)

### Leads — filter by "No website" to find your hottest prospects
![Leads table](download/02-leads.png)

### Lead detail — full contact info, tags, delete
![Lead detail](download/03-lead-detail.png)

### Jobs — live progress, cancel running scrapes
![Jobs](download/04-jobs.png)

### Proxies — HTTP/SOCKS5, single or rotating list, with one-click test
![Proxies](download/05-proxies.png)

### New Search — keyword + location + presets for Maryland
![New Search](download/06-new-search.png)

---

## ✨ Features

### 🔍 Google Maps scraper
- Headless Playwright + Chromium with stealth evasions
- Auto-scrolls the results feed to hit your `maxResults` target
- Deep-scrapes each result panel for phone + website + address
- Robust DOM selectors (`role="feed"`, `data-item-id`) — not brittle XPaths
- Polite delays (400–1200ms jitter) to avoid tripping rate limits
- Captcha / "unusual traffic" detection with graceful abort

### 🚫 No-website filter — your ICP
- Every lead where Google Maps lists no website URL is flagged as a **prime prospect**
- One-click filter on the Leads table: "🚫 No website (prime)"
- Dashboard shows no-website count + website coverage %

### 📞 Full contact data
| Field | Source |
|---|---|
| Business name | Google Maps result card |
| Category | Google Maps result card |
| Phone | Detail panel (`data-item-id="phone:..."`) |
| Website | Detail panel (`data-item-id="authority"`) |
| Address | Detail panel (`data-item-id="address"`) |
| City / State / ZIP | Parsed from address |
| Rating / Reviews | Result card |
| Lat / Lng | Embedded in card HTML |
| Business status | Result card ("Open", "Closed", etc.) |

### 🌐 Proxy support (HTTP + SOCKS5)
- Single proxy or **rotating list** (round-robin or random)
- Accepts 4 input formats:
  - `http://user:pass@host:port`
  - `socks5://host:port`
  - `host:port:user:pass` (legacy gosom format)
  - `host:port` (assumes HTTP)
- **One-click test button** — opens a Playwright context through the proxy and reports exit IP + latency
- Passwords masked in UI previews

### 👥 Small team auth
- NextAuth Credentials provider (email + password)
- bcrypt password hashing
- First user created becomes admin
- Shared lead pool — all team members see all leads
- Role support (`admin` / `member`) ready for future permissions

### 🎯 Lead management
- **Filter** by: text search, website status, city, state, category, tag
- **Tag** leads individually or in bulk (e.g. "hot", "called", "sold")
- **Export** to CSV — filtered set or selected leads only
- **Pagination** — 25 per page, scales to thousands
- **Expandable rows** — full contact details without leaving the table

### 📊 Dashboard
- Total leads, no-website count, website coverage %
- Total jobs + running jobs badge
- Top cities + top categories with proportional bars
- Tag cloud with counts
- Recent jobs (last 5) with status + lead count

---

## 🛠 Tech Stack

| Layer | Tech |
|---|---|
| Framework | **Next.js 16** (App Router) + React 19 + TypeScript 5 |
| Scraping | **Playwright 1.61** (Chromium, headless) |
| Database | **Prisma 6** + SQLite (swappable to Postgres/Supabase via one line) |
| Auth | **NextAuth v4** (Credentials provider, JWT sessions) |
| UI | **shadcn/ui** (New York) + **Tailwind CSS 4** + Lucide icons |
| Server state | **TanStack Query 5** |
| CSV export | **PapaParse 5** |
| Password hashing | **bcryptjs 3** |

---

## 🚀 Quick Start (Local Dev)

### Prerequisites
- Node.js 20+ or [Bun](https://bun.sh) 1.3+
- ~500MB free disk (for Playwright Chromium)

> **Want to deploy this online?** See **[HOSTING.md](HOSTING.md)** for a step-by-step guide to deploy free on Vercel + Neon + Railway.

### Install

```bash
# 1. Clone
git clone https://github.com/dustindog101/leadscraper.git
cd leadscraper

# 2. Decrypt credentials (password is a country name — see CREDENTIALS.md for hint)
openssl enc -aes-256-cbc -d -in .credentials.enc -out .env -pass pass:<PASSWORD> -pbkdf2 -iter 10000

# 3. Install deps
bun install   # or: npm install

# 4. Install Playwright browser
bunx playwright install chromium

# 5. Set up environment
cp .env.example .env   # then edit .env to set NEXTAUTH_SECRET

# 5. Push DB schema
bun run db:push

# 6. Start dev server
bun run dev
```

Open `http://localhost:3000`. The first account you create becomes the admin.

### Add Webshare proxies (optional but recommended for scale)

1. Sign up at [webshare.io](https://www.webshare.io) — free tier gives 10 proxies + 1GB/mo
2. Copy your proxy list from the dashboard
3. In the app, go to **Proxies → Add Proxy**
4. Paste your proxies (one per line) and save
5. Click **Test** to verify they work

---

## 📁 Project Structure

```
leadscraper/
├── prisma/
│   └── schema.prisma           # User, SearchJob, Lead, LeadContact, Tag, ProxyConfig
├── scripts/
│   ├── auto-commit.sh          # Watcher: polls + commits + pushes every 30s
│   ├── git-setup.sh            # One-time GitHub setup with PAT
│   ├── translate-categories.ts # One-off: zh → en category cleanup
│   ├── clean-addresses.ts      # One-off: strip Chinese country suffixes
│   ├── format-phones.ts        # One-off: tel:+1234 → +1 234-567-8900
│   ├── rename-admin.ts         # One-off: rename admin user
│   └── seed-proxies.ts         # One-off: insert Webshare proxy config
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── jobs/           # Create, list, cancel scrape jobs
│   │   │   ├── leads/          # List, delete, tag, export CSV
│   │   │   ├── proxies/        # CRUD + test
│   │   │   ├── stats/          # Dashboard metrics
│   │   │   ├── tags/           # Tag management
│   │   │   └── seed/           # Bootstrap first admin
│   │   ├── layout.tsx          # NextAuth + Theme + QueryClient providers
│   │   └── page.tsx            # SPA entry — login or dashboard
│   ├── components/
│   │   ├── ui/                 # shadcn/ui primitives
│   │   └── views/              # Dashboard, NewSearch, Leads, Jobs, Proxies
│   └── lib/
│       ├── db.ts               # Prisma client
│       ├── auth.ts             # NextAuth config
│       ├── scraper.ts          # Google Maps Playwright scraper
│       ├── proxy.ts            # Proxy parsing + rotation
│       ├── job-runner.ts       # Long-running scrape job worker
│       └── api/client.ts       # Typed API client for frontend
├── .env.example
├── .gitignore
├── README.md                   # ← you are here
└── package.json
```

---

## 🗄 Database Schema

```
User           ─┐
                │
SearchJob ──────┤  (one user creates many jobs)
                │
ProxyConfig ────┘  (optional, used by jobs)

Lead ─────┬── LeadContact  (one-to-many: extracted owner/manager names)
          │
          └── LeadTag ←── Tag
                  │
                  └── User  (who applied the tag)
```

**Key design choices:**
- `Lead.placeId` is unique — re-scraping the same business updates instead of duplicating
- `Lead.website` is nullable — NULL = prime prospect (no website)
- `LeadContact` table is ready for Phase 3 enrichment (cheerio + LLM extraction)
- `ProxyConfig.proxies` is a newline-separated list — supports single or rotating
- All schemas use `cuid()` IDs for global uniqueness

---

## 🌍 Serverless Migration (Phase 2)

The local build runs the scraper inline in the Next.js process. To deploy to Vercel:

### The constraint
Vercel Hobby functions cap at **300s**. A 5,000-lead scrape takes ~1 hour — doesn't fit.

### The architecture

```
┌────────────────────┐       ┌─────────────┐       ┌─────────────────────┐
│ Next.js 16 UI      │ ─API→ │ Inngest     │ ─step→ │ Scraper Worker      │
│ (Vercel free)      │       │ (free 50K/mo)│       │ (Railway $5/mo)     │
│ - Dashboard        │ ←SSE─ │ - chunked   │ ←write│ - Playwright+stealth │
│ - Lead table       │       │ - retries   │       │ - Proxy rotation    │
│ - CSV export       │       │ - realtime  │       │ - Writes to PG      │
└────────────────────┘       └─────────────┘       └─────────────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │ Postgres (Neon   │
                              │  free 0.5 GB)    │
                              └──────────────────┘
```

### Migration steps
1. **DB**: change `DATABASE_URL` in `.env` to a Neon/Supabase connection string. Prisma schema needs no other changes (already compatible).
2. **Queue**: wrap `runSearchJob` in an Inngest step function. Chunk into ≤50-lead steps so each fits well under 300s and retries are granular.
3. **UI**: deploy Next.js to Vercel. The `/api/inngest` route registers the Inngest client.
4. **Worker**: deploy the same Next.js app to Railway/Render. It registers the same Inngest endpoint but actually executes the long-running scrape jobs.
5. **Real-time**: Inngest streams `step.completed` events via SSE → UI shows live progress.

**Estimated monthly cost at medium scale (~10K leads/mo): ~$8-15/mo**

---

## 🛡 Anti-bot & Proxy Strategy

### Does Google Maps block scrapers?
Google Maps uses **IP-based rate limiting** + occasional CAPTCHAs — not Cloudflare-style JS challenges. At medium scale (thousands of leads per run), a single residential proxy is sufficient.

### Recommended proxy providers

| Provider | Price | Free tier | Notes |
|---|---|---|---|
| **Webshare** | $3.50/GB residential | **10 proxies + 1 GB/mo free** | Best free tier — used in this repo |
| **Evomi** | $0.49/GB | None | Cheapest residential, Swiss-based |
| Bright Data | $5.88-$8.40/GB PAYG | $5 trial credit | Industry standard, overkill here |
| NodeMaven | ~$2/GB promo | Free trial | Often used in tutorials |

### Cost estimate
Google Maps results are ~1-2 KB each. At ~5,000 listings/GB, scraping 5,000 leads = ~1 GB = **$0.49 with Evomi or $3.50 with Webshare**. Plan for <$5/proxy cost per scraping run.

### Stealth techniques used
- Realistic User-Agent (Chrome on macOS)
- Viewport 1440×900
- Locale `en-US`, timezone `America/New_York`
- Geolocation set to Maryland (matches target market)
- `Accept-Language: en-US,en;q=0.9` header
- `goog-lr=lang_en` cookie (forces English Google results)
- `navigator.webdriver` hidden
- `navigator.plugins` and `navigator.languages` spoofed
- Random delays between scrolls and clicks (400–1200ms jitter)

---

## ⚠️ Risks & Legal

### Google Maps ToS
Google's Terms of Service §3.3 technically forbid scraping. US courts (hiQ v. LinkedIn, 2022) have upheld scraping publicly available data as legal under the CFAA, but Google can still suspend accounts or IP-block. **Practical risk for a small agency scraping for B2B outreach is low but non-zero.**

**Mitigations:**
- Don't authenticate with a real Google account while scraping
- Use proxies for any run >200 results
- Don't republish the raw scraped data publicly
- Rate-limit (the scraper does this by default)

### Google Maps DOM changes
Google updates the Maps UI frequently — selectors break. This scraper uses robust `role="feed"` and `data-item-id` selectors instead of XPaths, which are more stable. Subscribe to issues on [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) as an early-warning system.

### "No website" ≠ "no online presence"
A business may have no website URL on Google Maps but still have a Facebook page, Instagram, or Yelp listing. Your "no-website" filter will catch these (good — they're sales targets) but will also miss businesses whose Google Maps listing just hasn't been updated.

---

## 🔄 Auto-commit to GitHub (optional)

This repo includes a watcher script that auto-commits and pushes every 30 seconds:

```bash
# 1. Get a GitHub Personal Access Token (scope: repo)
#    https://github.com/settings/tokens/new

# 2. One-time setup (configures remote with embedded token, force-pushes)
GITHUB_TOKEN=ghp_xxxxxxxx ./scripts/git-setup.sh

# 3. Start the watcher (runs forever in background)
nohup ./scripts/auto-commit.sh > /tmp/auto-commit.log 2>&1 &

# 4. Tail logs to verify
tail -f /tmp/auto-commit.log
```

**Custom interval:**
```bash
WATCH_INTERVAL=10 nohup ./scripts/auto-commit.sh > /tmp/auto-commit.log 2>&1 &
```

**Stop the watcher:**
```bash
pkill -f auto-commit.sh
```

---

## 🗺 Roadmap

### ✅ Phase 1 — Local MVP (current)
- [x] Next.js 16 + Prisma + SQLite
- [x] Google Maps scraper (Playwright)
- [x] Proxy rotation (HTTP/SOCKS5)
- [x] Lead management UI (filters, tags, CSV export)
- [x] NextAuth small-team auth
- [x] Webshare proxy integration

### 🚧 Phase 2 — Serverless migration
- [ ] Swap SQLite → Neon Postgres
- [ ] Wrap scraper in Inngest step function
- [ ] Deploy Next.js to Vercel + worker to Railway
- [ ] Real-time SSE progress updates
- [ ] Scheduled refreshes (Vercel Cron)

### 🔮 Phase 3 — Owner name extraction
- [ ] Fetch each lead's website homepage + /about + /contact
- [ ] Parse meta tags + JSON-LD with cheerio
- [ ] LLM extraction pass (gpt-4o-mini, ~$0.0001/lead)
- [ ] Confidence score + verified flag
- [ ] Expected hit rate: 25-40% of leads with a website

### 🔮 Phase 4 — Lead management polish
- [ ] Lead notes (free text per lead)
- [ ] Activity log (who contacted, when, outcome)
- [ ] Saved filter views
- [ ] Bulk delete

### 🔮 Phase 5 — Advanced
- [ ] Lighthouse audit for "poor website" detection (broken links, no SSL, Wix subdomain)
- [ ] Screenshot capture of lead's current site
- [ ] Tech stack detection (WordPress, Wix, custom)
- [ ] Scheduled auto-scrapes (weekly refresh of a saved search)

---

## 📜 License

MIT — see [LICENSE](LICENSE) file.

---

## 🙏 Acknowledgments

This project stands on the shoulders of giants. The scraper architecture was informed by:

- **[gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper)** — Go-based scraper, 4.5K stars. Used as data-model spec.
- **[asiifdev/business-leads-ai-automation](https://github.com/asiifdev/business-leads-ai-automation)** (Prospex) — Next.js 16 + NestJS + Prisma + Playwright. Closest match to this stack.
- **[omkarcloud/google-maps-scraper](https://github.com/omkarcloud/google-maps-scraper)** — Python/Botasaurus. Used for field documentation.
- **[prantikmedhi/b2b-leads-ai](https://github.com/prantikmedhi/b2b-leads-ai)** — Tiny Next.js app with the exact "no-website filter" logic.

---

<div align="center">

**Built with ❤️ for [cybershare.tech](https://cybershare.tech)**

</div>
