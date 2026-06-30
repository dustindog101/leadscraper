/**
 * Search job runner.
 *
 * Long-running async function that:
 *  1. Marks the SearchJob as "running"
 *  2. Loads the proxy config (if any)
 *  3. Calls the Google Maps scraper
 *  4. Writes leads to the DB (deduplicating by placeId)
 *  5. Updates the job's progress + final status
 *
 * Designed to run in a Next.js API route on a local laptop (Phase 1).
 * For Vercel deployment, this same function should be wrapped in an Inngest
 * step function and run on a separate Railway/Render worker (Phase 2).
 */

import { db } from './db'
import { ProxyRotator, type RotateMode } from './proxy'
import { scrapeGoogleMaps } from './scraper'

export async function runSearchJob(jobId: string): Promise<void> {
  console.log(`[scraper] starting job ${jobId}`)
  const job = await db.searchJob.findUnique({
    where: { id: jobId },
    include: { proxyConfig: true },
  })
  if (!job) {
    console.error(`[scraper] job ${jobId} not found`)
    return
  }

  await db.searchJob.update({
    where: { id: jobId },
    data: { status: 'running', startedAt: new Date(), progress: 0 },
  })

  let proxyRotator: ProxyRotator | undefined
  if (job.useProxy && job.proxyConfig && job.proxyConfig.enabled) {
    proxyRotator = new ProxyRotator(
      job.proxyConfig.proxies,
      job.proxyConfig.rotateMode as RotateMode
    )
    console.log(`[scraper] using proxy config "${job.proxyConfig.name}" (${proxyRotator.count} proxies)`)
  }

  // Polling-based cancel check
  let cancelled = false
  const cancelPoll = setInterval(async () => {
    const fresh = await db.searchJob.findUnique({ where: { id: jobId }, select: { status: true } })
    if (fresh?.status === 'cancelled') {
      cancelled = true
      clearInterval(cancelPoll)
    }
  }, 3000)

  try {
    const result = await scrapeGoogleMaps({
      query: job.query,
      location: job.location,
      maxResults: job.maxResults,
      proxyRotator,
      deepScrape: true,
      headless: true,
      shouldCancel: () => cancelled,
      onProgress: async (count, total) => {
        const pct = Math.min(99, Math.round((count / Math.max(total, 1)) * 100))
        await db.searchJob
          .update({
            where: { id: jobId },
            data: { progress: pct, leadsFound: count },
          })
          .catch(() => {})
      },
    })

    clearInterval(cancelPoll)

    if (result.error && result.leads.length === 0) {
      await db.searchJob.update({
        where: { id: jobId },
        data: {
          status: result.blocked ? 'failed' : 'failed',
          errorMsg: result.error,
          progress: 100,
          finishedAt: new Date(),
        },
      })
      console.error(`[scraper] job ${jobId} failed: ${result.error}`)
      return
    }

    // Persist leads (upsert by placeId)
    let noWebsiteCount = 0
    let persisted = 0
    for (const lead of result.leads) {
      try {
        const data = {
          placeId: lead.placeId,
          businessName: lead.businessName,
          address: lead.address ?? null,
          city: lead.city ?? null,
          state: lead.state ?? null,
          zip: lead.zip ?? null,
          country: lead.country ?? null,
          phone: lead.phone ?? null,
          website: lead.website ?? null,
          category: lead.category ?? null,
          rating: lead.rating ?? null,
          reviewsCount: lead.reviewsCount ?? null,
          priceLevel: lead.priceLevel ?? null,
          lat: lead.lat ?? null,
          lng: lead.lng ?? null,
          businessStatus: lead.businessStatus ?? null,
          sourceJobId: jobId,
        }
        await db.lead.upsert({
          where: { placeId: lead.placeId },
          create: data,
          update: {
            // Update fields that may be enriched in subsequent runs
            phone: data.phone ?? undefined,
            website: data.website ?? undefined,
            address: data.address ?? undefined,
            city: data.city ?? undefined,
            state: data.state ?? undefined,
            category: data.category ?? undefined,
            rating: data.rating ?? undefined,
            reviewsCount: data.reviewsCount ?? undefined,
            sourceJobId: jobId,
            updatedAt: new Date(),
          },
        })
        persisted++
        if (!lead.website) noWebsiteCount++
      } catch (e) {
        // skip individual write errors (likely unique constraint race)
      }
    }

    await db.searchJob.update({
      where: { id: jobId },
      data: {
        status: cancelled ? 'cancelled' : 'done',
        progress: 100,
        leadsFound: persisted,
        noWebsiteCount,
        errorMsg: result.error,
        finishedAt: new Date(),
      },
    })

    console.log(
      `[scraper] job ${jobId} done — ${persisted} leads (${noWebsiteCount} without website)`
    )
  } catch (e) {
    clearInterval(cancelPoll)
    const msg = e instanceof Error ? e.message : String(e)
    await db.searchJob.update({
      where: { id: jobId },
      data: { status: 'failed', errorMsg: msg, progress: 100, finishedAt: new Date() },
    })
    console.error(`[scraper] job ${jobId} threw:`, msg)
  }
}
