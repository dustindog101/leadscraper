# 🚀 Hosting Guide — Deploy Lead Scraper Online for Free

This guide walks you through deploying the Cybershare Lead Scraper to the internet for **$0/month** on free tiers.

> **TL;DR**: Vercel (frontend) + Neon (database) + Railway (scraper worker). All have free tiers. Total setup time: ~30 minutes.

---

## 📋 What you need before starting

- A GitHub account (you have one: `dustindog101`)
- The leadscraper repo pushed to GitHub ✅ (already done)
- Your Webshare proxy credentials (for the scraper)
- ~30 minutes

---

## 🏗 Architecture Overview

```
┌─────────────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  Vercel (Free)      │ ←→  │  Neon (Free) │ ←→  │  Railway (Free/$5)   │
│  - Next.js UI       │     │  - Postgres  │     │  - Scraper Worker    │
│  - API routes       │     │  - 0.5 GB    │     │  - Playwright        │
│  - Auth             │     │  - Free      │     │  - Proxy rotation    │
└─────────────────────┘     └──────────────┘     └──────────────────────┘
         ↑                                                  ↑
         │                                                  │
    You + team                                         Scrapes Google
    visit this URL                                     Maps from here
```

### Why 3 services?

- **Vercel** is perfect for the Next.js UI but has a **300-second function timeout** on the free tier. A scrape of 1,000+ leads takes 10+ minutes — Vercel can't run it.
- **Neon** is serverless Postgres. Free tier (0.5 GB) holds ~100,000 leads.
- **Railway** runs the scraper worker. Free trial gives $5 credit (~1 month of part-time use), then $5/month for the hobby tier. The worker only runs when you're actively scraping.

### Cost summary

| Service | Free tier | When you'd outgrow |
|---|---|---|
| **Vercel** Hobby | $0 forever | High traffic only (>100K views/mo) |
| **Neon** Free | 0.5 GB storage, 100 compute hours/mo | ~100K leads in DB |
| **Railway** Hobby | $5/mo (after free trial) | Always-on worker (you don't need this) |
| **Webshare** Free | 10 proxies + 1 GB/mo | >5,000 leads/month |
| **GitHub** Free | Unlimited public repos | Never |

**Monthly cost: $0 (light use) to $5/month (regular scraping)**

---

## Step 1: Set up Neon Postgres (5 minutes)

Neon is a serverless Postgres that's perfect for Next.js. The free tier is generous.

### 1.1 Sign up
1. Go to **https://neon.tech**
2. Click **Sign Up** → choose **Continue with GitHub** (uses your existing account)
3. Authorize Neon to access your GitHub

### 1.2 Create a project
1. Click **New Project**
2. Name: `leadscraper`
3. Region: `US East (Ohio)` — closest to Vercel's default region
4. Postgres version: latest (default)
5. Click **Create Project**

### 1.3 Get your connection string
After creating the project, Neon shows you a connection string that looks like:
```
postgresql://leadscraper_owner:nKxS9hM2pQ4rR7vX3jF6wY8bZ1aD5eG8@ep-fragrant-rain-123456.us-east-2.aws.neon.tech/leadscraper?sslmode=require
```

**Copy this string** — you'll need it for Vercel and Railway.

### 1.4 Initialize the database schema
The easiest way: run the schema push from your local machine, pointing at the Neon DB:

```bash
# In your local leadscraper folder:
# Temporarily point at Neon (don't commit this change!)
DATABASE_URL="postgresql://leadscraper_owner:nKxS9hM2pQ4rR7vX3jF6wY8bZ1aD5eG8@ep-fragrant-rain-123456.us-east-2.aws.neon.tech/leadscraper?sslmode=require" bun run db:push
```

You should see "🚀 Your database is now in sync with your Prisma schema". The Neon database now has all your tables.

---

## Step 2: Deploy to Vercel (10 minutes)

### 2.1 Sign up
1. Go to **https://vercel.com**
2. Click **Sign Up** → choose **Continue with GitHub**
3. Authorize Vercel to access your GitHub

### 2.2 Import the repo
1. Click **Add New...** → **Project**
2. Find `dustindog101/leadscraper` in the repo list → click **Import**
3. Framework Preset: **Next.js** (auto-detected)
4. Build Command: `bun run build` (or leave default)
5. Install Command: `bun install` (or leave default)

### 2.3 Set environment variables
Scroll down to **Environment Variables** and add:

| Name | Value | Where to get it |
|---|---|---|
| `DATABASE_URL` | `postgresql://leadscraper_owner:...` | From Neon (step 1.3) |
| `NEXTAUTH_SECRET` | (random 32-char string) | Run `openssl rand -base64 32` in your terminal |
| `NEXTAUTH_URL` | `https://leadscraper.vercel.app` | Replace with your Vercel URL (will be shown after deploy) |

**Tip for `NEXTAUTH_URL`**: Use a placeholder like `https://example.com` for the first deploy, then update it after Vercel shows you the real URL.

### 2.4 Deploy
Click **Deploy**. Wait ~2 minutes. Vercel will:
- Install dependencies
- Build the Next.js app
- Deploy to a global CDN
- Give you a URL like `https://leadscraper.vercel.app`

### 2.5 Fix `NEXTAUTH_URL`
After deploy:
1. Go to your Vercel project → **Settings** → **Environment Variables**
2. Edit `NEXTAUTH_URL` → set it to your real URL (e.g. `https://leadscraper.vercel.app`)
3. Go to **Deployments** → click the **⋯** on the latest → **Redeploy**

### 2.6 Test it
Visit your Vercel URL. You should see the login screen. Create the first admin account (you). The dashboard should work — but **scrape jobs will fail** because Vercel can't run Playwright. That's what Railway is for (Step 3).

---

## Step 3: Deploy the Scraper Worker to Railway (10 minutes)

Railway runs the heavy Playwright scraper in a long-lived process. The Next.js API on Vercel will send scrape jobs to this worker via an HTTP call.

### 3.1 Sign up
1. Go to **https://railway.app**
2. Click **Login** → choose **Login with GitHub**
3. Authorize Railway

### 3.2 Create a project
1. Click **New Project** → **Deploy from GitHub repo**
2. Select `dustindog101/leadscraper`
3. Railway creates a new service from your repo

### 3.3 Configure the worker
We need to tell Railway to:
- Run the worker process (not the Next.js dev server)
- Install Playwright's Chromium browser
- Connect to your Neon database

Click your service → **Settings**:

| Setting | Value |
|---|---|
| **Build Command** | `bun install && bunx playwright install --with-deps chromium` |
| **Start Command** | `bun run worker` (we'll create this script below) |

Wait — we need to add a worker entry point to your repo first. Let me explain:

### 3.4 Add a worker script to your repo

Create `src/worker.ts` in your repo:

```typescript
// src/worker.ts — Long-running scraper worker
// Polls the database for queued SearchJobs and runs them.
import { db } from './lib/db'
import { runSearchJob } from './lib/job-runner'

const POLL_INTERVAL_MS = 5000

async function main() {
  console.log('[worker] started — polling for queued jobs every 5s')
  while (true) {
    try {
      const queuedJob = await db.searchJob.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
      })
      if (queuedJob) {
        console.log(`[worker] picked up job ${queuedJob.id} — ${queuedJob.query} in ${queuedJob.location}`)
        await runSearchJob(queuedJob.id)
      }
    } catch (e) {
      console.error('[worker] error:', e)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

main().catch((e) => {
  console.error('[worker] fatal:', e)
  process.exit(1)
})
```

Add to `package.json`:
```json
{
  "scripts": {
    "worker": "bun run src/worker.ts"
  }
}
```

Commit and push to GitHub. Railway will auto-redeploy.

### 3.5 Set Railway environment variables

In Railway → your service → **Variables** tab, add:

| Name | Value |
|---|---|
| `DATABASE_URL` | (same Neon connection string as Vercel) |
| `NODE_ENV` | `production` |

### 3.6 Deploy and verify
Railway auto-deploys when you push to GitHub. Watch the **Deployments** tab. When it's live, click the URL Railway gives you (it'll 404 — that's fine, the worker doesn't serve HTTP). Check the **Logs** tab — you should see:
```
[worker] started — polling for queued jobs every 5s
```

### 3.7 Test the full flow
1. Visit your Vercel URL
2. Sign in → New Search → "barber" in "Baltimore MD", 50 results
3. Click **Start Scrape**
4. Switch to the **Jobs** tab — you should see the job go from `queued` → `running` → `done`
5. Switch to **Leads** tab — your leads should appear

🎉 **You're live!**

---

## Step 4: Add Webshare Proxies (optional but recommended)

For runs >200 results, you need proxies to avoid Google rate-limiting.

### 4.1 Sign up
1. Go to **https://www.webshare.io**
2. Sign up (free — no credit card needed)
3. Confirm your email

### 4.2 Get your proxies
1. Dashboard → **Proxy** → **List**
2. You'll see 10 free residential proxies with format:
   - **Proxy Address**: `31.59.20.176`
   - **Port**: `6754`
   - **Username**: `zbmaeavo` (your account username)
   - **Password**: `wzd3slu8ahvs` (your account password)

### 4.3 Add to the app
1. Visit your Vercel URL → **Proxies** tab → **Add Proxy**
2. Name: `Webshare Residential`
3. Type: `HTTP / HTTPS`
4. Proxy list (one per line):
   ```
   http://YOUR_USERNAME:YOUR_PASSWORD@31.59.20.176:6754
   http://YOUR_USERNAME:YOUR_PASSWORD@31.56.127.193:7684
   ... (all 10)
   ```
5. Click **Test First Proxy** — should show exit IP + latency
6. Save

Now when you start a scrape, toggle **Use proxy** → select **Webshare Residential**.

---

## Step 5: Custom Domain (optional, makes you look pro)

A custom domain like `scraper.cybershare.tech` looks more professional than `leadscraper.vercel.app`.

### 5.1 Add domain in Vercel
1. Vercel project → **Settings** → **Domains**
2. Enter `scraper.cybershare.tech` → click **Add**
3. Vercel shows you DNS records to add

### 5.2 Add DNS records at your registrar
Wherever you bought `cybershare.tech` (Namecheap, GoDaddy, Cloudflare, etc.), add:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `scraper` | `cname.vercel-dns.com` |

Wait 5-30 minutes for DNS to propagate. Vercel will auto-detect and issue an SSL certificate.

### 5.3 Update NEXTAUTH_URL
Vercel → Settings → Environment Variables → update `NEXTAUTH_URL` to `https://scraper.cybershare.tech` → Redeploy.

---

## Step 6: Add Team Members

### 6.1 They sign up
Tell your teammate to visit your Vercel URL → **Create Account** tab → enter their email + password. They'll be created as `member` role (you're `admin`).

### 6.2 Shared lead pool
All users see all leads. Tags are user-specific (each user's tags don't clutter other users' views).

---

## 🔧 Maintenance

### Updating the app
Push to GitHub. Vercel + Railway auto-redeploy from `main`. Done.

### Viewing logs
- **Vercel**: Project → **Logs** tab
- **Railway**: Service → **Logs** tab
- **Neon**: Project → **SQL Editor** to query your DB directly

### Backing up leads
The easiest way: **Leads** tab → **Export filtered** → CSV. Do this weekly if you can't afford to lose the data.

For DB-level backups: Neon → Project → **Branches** → create a branch (it's a copy of your data).

### Resetting the database
If you want a fresh start:
```bash
# Local terminal, with DATABASE_URL pointing at Neon
DATABASE_URL="postgresql://..." bun run db:push --force-reset
```
⚠️ **This deletes all leads, jobs, users, and proxies.** Irreversible.

---

## ⚠️ Known limitations of free tiers

| Service | Limitation | Workaround |
|---|---|---|
| **Vercel** | 300s function timeout | Worker pattern (we use it) |
| **Vercel** | 100GB bandwidth/mo | Upgrade to Pro ($20/mo) if needed |
| **Neon** | DB sleeps after 5 min inactivity | First request after sleep takes ~1s extra |
| **Neon** | 0.5 GB storage | ~100K leads. Upgrade to Launch ($19/mo) for 10GB |
| **Railway** | Free trial = $5 credit (~500 hours) | After that, $5/mo hobby tier |
| **Webshare** | 1 GB proxy traffic/mo | ~5,000 leads/mo. Upgrade to Pro for more |

---

## 🆘 Troubleshooting

### "Cannot reach database" on Vercel
- Verify `DATABASE_URL` is set in Vercel env vars
- Verify it includes `?sslmode=require` at the end
- Redeploy after adding env vars

### Scrape jobs stuck on "queued"
- Worker isn't running. Check Railway logs.
- Verify `DATABASE_URL` in Railway matches Neon
- Verify the worker started: logs should show `[worker] started`

### Scrape jobs failing with "unusual traffic"
- Google is rate-limiting your worker's IP
- Add proxies (Step 4)
- Reduce `maxResults` per run

### Login not working in production
- Verify `NEXTAUTH_URL` matches your actual Vercel URL (including `https://`)
- Verify `NEXTAUTH_SECRET` is set (32+ chars, random)

### Playwright not installing on Railway
- Make sure Build Command includes `bunx playwright install --with-deps chromium`
- Railway needs `--with-deps` to install system libraries Chromium needs

### Builds failing on Vercel
- Check the build log for the error
- Common: missing env var. All 3 (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`) are required.

---

## 📊 Monthly cost at different scales

| Usage | Cost |
|---|---|
| **Light** (you only, <500 leads/mo) | $0 |
| **Regular** (team of 3, ~5K leads/mo) | $5/mo (Railway) |
| **Heavy** (team of 5, ~20K leads/mo) | $25/mo (Railway + Neon Launch + Webshare Pro) |
| **Agency** (multiple teams, ~50K leads/mo) | $50-100/mo |

---

## ✅ Final checklist

After completing this guide, you should have:

- [ ] Neon Postgres database created and schema pushed
- [ ] Vercel deployment live at `https://leadscraper.vercel.app` (or custom domain)
- [ ] Railway worker running (logs show `[worker] started`)
- [ ] All 3 env vars set on both Vercel and Railway
- [ ] Webshare proxies added in the app's Proxies tab
- [ ] Test scrape completed end-to-end (New Search → Jobs → Leads)
- [ ] Admin account created (you)
- [ ] Optional: custom domain configured
- [ ] Optional: team members invited

**You're done.** Go find those businesses with no websites and sell them one. 🚀
