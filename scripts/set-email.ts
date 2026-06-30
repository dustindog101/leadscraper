/**
 * Temporarily change the user's email to a generic one for screenshots.
 * Usage:
 *   bun run scripts/set-email.ts manny@example.com     # set
 *   bun run scripts/set-email.ts --restore             # restore to manny@cybershare.tech
 */
import { db } from '../src/lib/db'

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.log('Usage: bun run scripts/set-email.ts <email>')
    console.log('       bun run scripts/set-email.ts --restore')
    process.exit(1)
  }

  const target = arg === '--restore' ? 'manny@cybershare.tech' : arg
  const users = await db.user.findMany()
  if (users.length === 0) {
    console.log('No users found.')
    return
  }

  // Update all users to the target email (assumes single-user setup)
  for (const u of users) {
    if (u.email === target) continue
    // Prisma can't update the unique email to one that already exists — delete the existing one first if any
    const existing = await db.user.findUnique({ where: { email: target } })
    if (existing && existing.id !== u.id) {
      await db.user.delete({ where: { id: existing.id } })
    }
    await db.user.update({ where: { id: u.id }, data: { email: target } })
    console.log(`Updated user ${u.id}: ${u.email} → ${target}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
