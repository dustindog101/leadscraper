/**
 * Rename the existing admin user to "Manny".
 */
import { db } from '../src/lib/db'

async function main() {
  const users = await db.user.findMany()
  console.log(`Found ${users.length} user(s):`)
  users.forEach((u) => console.log(`  - ${u.email} (${u.name}) [${u.role}]`))

  if (users.length === 0) {
    console.log('No users found.')
    return
  }

  // Update the first admin user to be "Manny"
  const admin = users.find((u) => u.role === 'admin') || users[0]
  const updated = await db.user.update({
    where: { id: admin.id },
    data: { name: 'Manny' },
    select: { id: true, email: true, name: true, role: true },
  })

  console.log(`\nUpdated user:`)
  console.log(`  ${updated.email} → name="${updated.name}" role=${updated.role}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
