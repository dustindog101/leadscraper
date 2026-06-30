# Cybershare Lead Scraper

Find businesses on Google Maps that don't have a website — perfect prospects for [cybershare.tech](https://cybershare.tech) to sell websites to.

## What it does

- 🔍 **Scrape Google Maps** by keyword + location (e.g. "barber" in "Baltimore MD")
- 🚫 **Flag businesses with no website** — your hottest sales leads
- 📞 **Capture business name, phone, address, category, rating, reviews**
- 🌐 **Proxy support** — HTTP, SOCKS5, single or rotating list (round-robin or random)
- 👥 **Small team auth** — email/password login, shared lead pool
- 🎯 **Filter, tag, and export** leads to CSV
- 📊 **Dashboard** with stats: total leads, no-website count, top cities/categories

## Tech stack

- **Next.js 16** + React 19 + TypeScript
- **Playwright** for headless browser scraping
- **Prisma** + SQLite (swappable to Postgres/Supabase via one line)
- **NextAuth** credentials provider
- **shadcn/ui** + Tailwind CSS 4
- **TanStack Query** for server state

## Quick start (local dev)

```bash
# 1. Install deps
bun install

# 2. Install Playwright browser
bunx playwright install chromium

# 3. Push DB schema
bun run db:push

# 4. Start dev server
bun run dev
```

Open `http://localhost:3000`. The first account you create becomes the admin.

## Auto-commit to GitHub (optional)

This repo includes a watcher script that auto-commits and pushes every 30 seconds:

```bash
# 1. Get a GitHub Personal Access Token (scope: repo)
#    https://github.com/settings/tokens/new

# 2. One-time setup
GITHUB_TOKEN=ghp_xxxxxxxx ./scripts/git-setup.sh

# 3. Start the watcher (runs forever)
nohup ./scripts/auto-commit.sh > /tmp/auto-commit.log 2>&1 &
```

## Architecture

```
src/
├── app/                    # Next.js routes
│   ├── api/                # API routes (jobs, leads, proxies, stats, auth)
│   ├── layout.tsx          # Root layout with NextAuth + Theme + QueryClient providers
│   └── page.tsx            # Main SPA entry (login or dashboard)
├── components/
│   ├── ui/                 # shadcn/ui primitives
│   └── views/              # Dashboard, NewSearch, Leads, Jobs, Proxies views
├── lib/
│   ├── db.ts               # Prisma client
│   ├── auth.ts             # NextAuth config
│   ├── scraper.ts          # Google Maps Playwright scraper
│   ├── proxy.ts            # Proxy rotation (HTTP/SOCKS5, round-robin/random)
│   ├── job-runner.ts       # Long-running scrape job worker
│   └── api/client.ts       # Typed API client for the frontend
└── prisma/
    └── schema.prisma       # User, SearchJob, Lead, LeadContact, Tag, ProxyConfig
```

## Serverless migration (Phase 2)

The local build runs the scraper inline in the Next.js process. To deploy to Vercel:

1. Swap SQLite → Neon Postgres (change `DATABASE_URL`)
2. Wrap `runSearchJob` in an Inngest step function (chunk into ≤50-lead steps)
3. Deploy Next.js to Vercel (Hobby tier is fine)
4. Run the scraper worker on Railway/Render ($5/mo) — Vercel functions time out at 300s

## Roadmap

- **Phase 3 — Owner name extraction**: cheerio + gpt-4o-mini to scrape About/Contact pages
- **Phase 4 — Lead notes & activity log**
- **Phase 5 — Scheduled refreshes**

## License

MIT
