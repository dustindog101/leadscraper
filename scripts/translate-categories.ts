/**
 * One-off script: clean up Chinese category names already in the DB.
 * Run with: bun run /home/z/my-project/scripts/translate-categories.ts
 */
import { db } from '../src/lib/db'

// Common Google Maps category translations (zh → en)
const ZH_TO_EN: Record<string, string> = {
  '牙醫': 'Dentist',
  '牙科診所': 'Dental clinic',
  '美容牙醫': 'Cosmetic dentist',
  '牙科醫生': 'Dentist',
  '口腔科': 'Dentist',
  '矯正牙醫': 'Orthodontist',
  '兒童牙醫': 'Pediatric dentist',
  '理髮店': 'Barber shop',
  '理髮師': 'Barber',
  '髮型設計師': 'Hair stylist',
  '美髮沙龍': 'Hair salon',
  '美甲沙龍': 'Nail salon',
  '美容院': 'Beauty salon',
  '餐廳': 'Restaurant',
  '中餐館': 'Chinese restaurant',
  '日餐館': 'Japanese restaurant',
  '咖啡店': 'Coffee shop',
  '咖啡館': 'Cafe',
  '麵包店': 'Bakery',
  '披薩店': 'Pizza restaurant',
  '快餐店': 'Fast food restaurant',
  '酒吧': 'Bar',
  '汽車維修店': 'Auto repair shop',
  '汽車修理廠': 'Mechanic',
  '水電工': 'Plumber',
  '電工': 'Electrician',
  '園林綠化': 'Landscaping',
  '健身房': 'Gym',
  '水療中心': 'Spa',
  '屋頂承包商': 'Roofing contractor',
  '餐飲服務': 'Catering',
}

async function main() {
  console.log('Fetching leads with non-ASCII categories...')
  const leads = await db.lead.findMany({
    where: {
      category: { not: null },
    },
    select: { id: true, category: true },
  })

  let updated = 0
  for (const lead of leads) {
    if (!lead.category) continue
    // Check if category contains CJK characters
    if (!/[\u4e00-\u9fff]/.test(lead.category)) continue

    const translated = ZH_TO_EN[lead.category] || null
    if (translated) {
      await db.lead.update({ where: { id: lead.id }, data: { category: translated } })
      console.log(`  ${lead.category} → ${translated}`)
      updated++
    } else {
      // Unknown Chinese category — null it out so user can re-scrape
      console.log(`  ${lead.category} → (unknown, set to null)`)
      await db.lead.update({ where: { id: lead.id }, data: { category: null } })
      updated++
    }
  }

  console.log(`\nDone. Updated ${updated} leads.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
