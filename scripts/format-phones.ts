/**
 * One-off script: normalize phone numbers from "tel:+13012319100" → "+1 301-231-9100".
 */
import { db } from '../src/lib/db'

function formatPhone(raw: string): string {
  const digits = raw.replace(/^tel:/, '').replace(/[^\d+]/g, '')
  const usMatch = digits.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/)
  if (usMatch) return `+1 ${usMatch[1]}-${usMatch[2]}-${usMatch[3]}`
  return digits
}

async function main() {
  const leads = await db.lead.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
  })

  let updated = 0
  for (const lead of leads) {
    if (!lead.phone) continue
    if (!lead.phone.startsWith('tel:')) continue
    const formatted = formatPhone(lead.phone)
    if (formatted !== lead.phone) {
      await db.lead.update({ where: { id: lead.id }, data: { phone: formatted } })
      updated++
    }
  }

  console.log(`Done. Formatted ${updated} phone numbers.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
