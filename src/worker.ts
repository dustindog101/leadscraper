/**
 * Long-running scraper worker — polls the database for queued SearchJobs
 * and runs them. Designed to run on Railway/Render/Fly (NOT Vercel —
 * Vercel functions time out at 300s and can't run Patchright/Playwright).
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
 * The worker also recovers stale "running" jobs — if a job has been
 * running for more than 30 minutes (e.g. the worker crashed), it resets
 * the job back to "queued" so another worker can pick it up.
 *
 * Multiple workers can run in parallel against the same DB — they'll
 * each pick up different jobs (atomic claim via updateMany).
 */

import { db } from './lib/db'
import { runSearchJob } from './lib/job-runner'

const POLL_INTERVAL_MS = 5000
const STALE_JOB_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

async function recoverStaleJobs(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - STALE_JOB_THRESHOLD_MS)
    const result = await db.searchJob.updateMany({
      where: {
        status: 'running',
        startedAt: { lt: cutoff },
      },
      data: {
        status: 'queued',
        startedAt: null,
        errorMsg: 'Recovered from stale running state (worker may have crashed)',
      },
    })
    if (result.count > 0) {
      console.log(`[worker] recovered ${result.count} stale job(s)`)
    }
    return result.count
  } catch (e) {
    console.error('[worker] stale recovery error:', e)
    return 0
  }
}

async function pollOnce(): Promise<boolean> {
  try {
    // Recover stale jobs every poll cycle (cheap query)
    await recoverStaleJobs()

    // Find the oldest queued job (paused jobs stay paused — user resumes manually)
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

    // Run the job in the background — don't block the poll loop.
    // runSearchJob will handle errors and update the job status.
    runSearchJob(queuedJob.id).catch((e) => {
      console.error(`[worker] job ${queuedJob.id} failed:`, e)
      // Mark the job as failed so it doesn't stay "running" forever
      db.searchJob
        .update({
          where: { id: queuedJob.id },
          data: {
            status: 'failed',
            errorMsg: `Worker error: ${e instanceof Error ? e.message : String(e)}`,
            finishedAt: new Date(),
          },
        })
        .catch(() => {})
    })

    return true
  } catch (e) {
    console.error('[worker] poll error:', e)
    return false
  }
}

async function main() {
  console.log('[worker] started — polling for queued jobs every 5s')
  console.log(`[worker] database: ${process.env.DATABASE_URL ? 'configured' : 'MISSING DATABASE_URL'}`)
  console.log(`[worker] stale job threshold: ${STALE_JOB_THRESHOLD_MS / 60000} minutes`)

  // Test DB connection on startup
  try {
    await db.$queryRaw`SELECT 1`
    console.log('[worker] DB connection OK')
  } catch (e) {
    console.error('[worker] DB connection failed:', e)
    process.exit(1)
  }

  // Recover any stale jobs from a previous worker crash on startup
  await recoverStaleJobs()

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
