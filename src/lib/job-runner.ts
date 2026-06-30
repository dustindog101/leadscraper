/**
 * Search job runner.
 *
 * Long-running async function that:
 *  1. Marks the SearchJob as "running"
 *  2. Loads the proxy config (if any)
 *  3. Calls the Google Maps scraper
 *  4. Writes leads to the DB IMMEDIATELY as they're scraped (via onLead callback)
 *  5. Updates the job's progress + final status
 *
 * Supports pause/cancel via DB polling:
 *  - status = "cancelled" → stop scraping, keep partial leads
 *  - status = "paused" → wait until resumed, then continue
 *
 * Designed to run on the Railway worker (or locally).
 */

import { db } from './db'
import { ProxyRotator, type RotateMode } from './proxy'
import { scrapeGoogleMaps, type ScrapedLead } from './scraper'

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
    data: { status: 'running', startedAt: new Date(), progress: 0, errorMsg: null },
  })

  let proxyRotator: ProxyRotator | undefined
  if (job.useProxy && job.proxyConfig && job.proxyConfig.enabled) {
    proxyRotator = new ProxyRotator(
      job.proxyConfig.proxies,
      job.proxyConfig.rotateMode as RotateMode
    )
    console.log(`[scraper] using proxy config "${job.proxyConfig.name}" (${proxyRotator.count} proxies)`)
  }

  // Track which leads we've already saved (to avoid duplicate writes on re-save)
  const savedLeadIds = new Set<string>()
  const leadHasWebsite = new Map<string, boolean>() // placeId → has website
  let totalSaved = 0

  // Calculate no-website count from the tracked leads
  function getNoWebsiteCount(): number {
    let count = 0
    for (const hasWebsite of leadHasWebsite.values()) {
      if (!hasWebsite) count++
    }
    return count
  }

  // Save a lead to the DB immediately (upsert by placeId)
  async function saveLead(lead: ScrapedLead) {
    if (savedLeadIds.has(lead.placeId)) {
      // Update existing lead with enriched data
      try {
        await db.lead.update({
          where: { placeId: lead.placeId },
          data: {
            phone: lead.phone ?? undefined,
            website: lead.website ?? undefined,
            placeUrl: lead.placeUrl ?? undefined,
            address: lead.address ?? undefined,
            city: lead.city ?? undefined,
            state: lead.state ?? undefined,
            zip: lead.zip ?? undefined,
            category: lead.category ?? undefined,
            rating: lead.rating ?? undefined,
            reviewsCount: lead.reviewsCount ?? undefined,
            priceLevel: lead.priceLevel ?? undefined,
            lat: lead.lat ?? undefined,
            lng: lead.lng ?? undefined,
            businessStatus: lead.businessStatus ?? undefined,
            updatedAt: new Date(),
            // Only update reviews if we got new ones (don't overwrite with empty)
            ...(lead.reviews && lead.reviews.length > 0
              ? {
                  reviews: {
                    deleteMany: {},
                    create: lead.reviews.map((r) => ({
                      authorName: r.authorName,
                      rating: r.rating,
                      text: r.text,
                      relativeDate: r.relativeDate || null,
                    })),
                  },
                }
              : {}),
          },
        })
        leadHasWebsite.set(lead.placeId, !!lead.website)
      } catch {
        // ignore individual update errors
      }
      return
    }

    savedLeadIds.add(lead.placeId)
    leadHasWebsite.set(lead.placeId, !!lead.website)

    try {
      await db.lead.upsert({
        where: { placeId: lead.placeId },
        create: {
          placeId: lead.placeId,
          businessName: lead.businessName,
          address: lead.address ?? null,
          city: lead.city ?? null,
          state: lead.state ?? null,
          zip: lead.zip ?? null,
          country: lead.country ?? null,
          phone: lead.phone ?? null,
          website: lead.website ?? null,
          placeUrl: lead.placeUrl ?? null,
          category: lead.category ?? null,
          rating: lead.rating ?? null,
          reviewsCount: lead.reviewsCount ?? null,
          priceLevel: lead.priceLevel ?? null,
          lat: lead.lat ?? null,
          lng: lead.lng ?? null,
          businessStatus: lead.businessStatus ?? null,
          sourceJobId: jobId,
          // Create reviews if we have them
          ...(lead.reviews && lead.reviews.length > 0
            ? {
                reviews: {
                  create: lead.reviews.map((r) => ({
                    authorName: r.authorName,
                    rating: r.rating,
                    text: r.text,
                    relativeDate: r.relativeDate || null,
                  })),
                },
              }
            : {}),
        },
        update: {},
      })
      totalSaved++
    } catch (e) {
      // skip individual write errors
    }
  }

  // Check cancel/pause status every 3 seconds
  let cancelled = false
  let paused = false
  const statusPoll = setInterval(async () => {
    const fresh = await db.searchJob.findUnique({ where: { id: jobId }, select: { status: true } })
    if (fresh?.status === 'cancelled') {
      cancelled = true
    } else if (fresh?.status === 'paused') {
      paused = true
    } else if (fresh?.status === 'running') {
      paused = false
    }
  }, 3000)

  try {
    const result = await scrapeGoogleMaps({
      query: job.query,
      location: job.location,
      maxResults: job.maxResults,
      proxyRotator,
      headless: true,
      concurrency: 3,
      shouldCancel: () => cancelled,
      shouldPause: () => paused,
      onLead: async (lead) => {
        await saveLead(lead)
        // Update job leadsFound count (noWebsiteCount is now calculated dynamically)
        await db.searchJob.update({
          where: { id: jobId },
          data: { leadsFound: totalSaved, noWebsiteCount: getNoWebsiteCount() },
        }).catch(() => {})
      },
      onProgress: async (phase, count, total) => {
        // Calculate overall progress:
        // - collect phase: 0-50% (collecting leads from feed)
        // - enrich phase: 50-100% (enriching each lead with phone/website)
        let pct = 0
        if (phase === 'collect') {
          pct = Math.min(50, Math.round((count / Math.max(total, 1)) * 50))
        } else {
          pct = 50 + Math.min(50, Math.round((count / Math.max(total, 1)) * 50))
        }
        await db.searchJob.update({
          where: { id: jobId },
          data: { progress: pct, leadsFound: totalSaved, noWebsiteCount: getNoWebsiteCount() },
        }).catch(() => {})
      },
    })

    clearInterval(statusPoll)

    if (result.error && totalSaved === 0) {
      await db.searchJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorMsg: result.error,
          progress: 100,
          finishedAt: new Date(),
        },
      })
      console.error(`[scraper] job ${jobId} failed: ${result.error}`)
      return
    }

    await db.searchJob.update({
      where: { id: jobId },
      data: {
        status: cancelled ? 'cancelled' : 'done',
        progress: 100,
        leadsFound: totalSaved,
        noWebsiteCount: getNoWebsiteCount(),
        errorMsg: result.error,
        finishedAt: new Date(),
      },
    })

    console.log(
      `[scraper] job ${jobId} ${cancelled ? 'cancelled' : 'done'} — ${totalSaved} leads (${getNoWebsiteCount()} without website)`
    )
  } catch (e) {
    clearInterval(statusPoll)
    const msg = e instanceof Error ? e.message : String(e)
    await db.searchJob.update({
      where: { id: jobId },
      data: { status: 'failed', errorMsg: msg, progress: 100, finishedAt: new Date() },
    })
    console.error(`[scraper] job ${jobId} threw:`, msg)
  }
}
