/**
 * One-off script: strip trailing Chinese country names from addresses.
 * Google Maps sometimes appends "美國" (USA), "英國" (UK), etc. to addresses.
 */
import { db } from '../src/lib/db'

const CJK_SUFFIXES = ['美國', '英國', '加拿大', '澳大利亞', '日本', '韓國', '法國', '德國', '西班牙', '意大利']

async function main() {
  const leads = await db.lead.findMany({
    where: { address: { not: null } },
    select: { id: true, address: true },
  })

  let updated = 0
  for (const lead of leads) {
    if (!lead.address) continue
    let cleaned = lead.address
    for (const suffix of CJK_SUFFIXES) {
      cleaned = cleaned.replace(new RegExp(`${suffix}$`), '').trim()
    }
    // Strip any remaining CJK chars at the end
    cleaned = cleaned.replace(/[\u4e00-\u9fff]+$/, '').trim()
    // Strip leading newline (Google often has \n before address)
    cleaned = cleaned.replace(/^\n+/, '').trim()

    if (cleaned !== lead.address) {
      await db.lead.update({ where: { id: lead.id }, data: { address: cleaned } })
      updated++
    }
  }

  console.log(`Done. Cleaned ${updated} addresses.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
