/**
 * Long-running scraper worker — polls the database for queued SearchJobs
 * and runs them. Designed to run on Railway/Render/Fly (NOT Vercel —
 * Vercel functions time out at 300s and can't run Playwright).
 *
 * Usage:
 *   bun run worker              # foreground
 *   bun run worker > worker.log 2>&1 &  # background
 *
 * Required env vars:
 *   DATABASE_URL    - Neon/Postgres connection string
 *
 * The worker polls every 5 seconds. When it finds a job with status
 * "queued", it picks it up, marks it "running", calls runSearchJob,
 * and the job-runner does the rest (writing leads to DB, updating progress).
 *
 * Multiple workers can run in parallel against the same DB — they'll
 * each pick up different jobs (the job-runner uses an atomic update
 * to claim a job). For now this is a single-worker setup.
 */

import { db } from './lib/db'
import { runSearchJob } from './lib/job-runner'

const POLL_INTERVAL_MS = 5000

async function pollOnce(): Promise<boolean> {
  try {
    // Atomically claim a queued job by updating it to "running"
    // (only if it's still "queued" — avoids races with other workers)
    const queuedJob = await db.searchJob.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
    })

    if (!queuedJob) return false

    // Try to atomically claim it (set to running only if still queued)
    const claimed = await db.searchJob.updateMany({
      where: { id: queuedJob.id, status: 'queued' },
      data: { status: 'running', startedAt: new Date() },
    })

    if (claimed.count === 0) {
      // Another worker beat us to it — skip
      return true
    }

    console.log(
      `[worker] picked up job ${queuedJob.id} — ` +
      `"${queuedJob.query}" in "${queuedJob.location}" (max ${queuedJob.maxResults})`
    )

    // Run the job in the background — don't block the poll loop
    runSearchJob(queuedJob.id).catch((e) => {
      console.error(`[worker] job ${queuedJob.id} failed:`, e)
    })

    return true
  } catch (e) {
    console.error('[worker] poll error:', e)
    return false
  }
}

async function main() {
  console.log('[worker] started — polling for queued jobs every 5s')
  console.log(`[worker] database: ${process.env.DATABASE_URL ? 'connected' : 'MISSING DATABASE_URL'}`)

  // Test DB connection on startup
  try {
    await db.$queryRaw`SELECT 1`
    console.log('[worker] DB connection OK')
  } catch (e) {
    console.error('[worker] DB connection failed:', e)
    process.exit(1)
  }

  while (true) {
    const hadJob = await pollOnce()
    if (!hadJob) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
    // If we had a job, loop immediately to check for more
  }
}

main().catch((e) => {
  console.error('[worker] fatal:', e)
  process.exit(1)
})
