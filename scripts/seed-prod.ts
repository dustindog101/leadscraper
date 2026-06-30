/**
 * Seed the production Neon database with:
 *   1. The admin user (Manny)
 *   2. Webshare proxy config (if proxies file exists)
 *
 * Usage:
 *   bun run scripts/seed-prod.ts
 *
 * Reads proxy list from scripts/.proxies.local.txt (gitignored).
 */
import { db } from '../src/lib/db'
import bcrypt from 'bcryptjs'
import { readFileSync, existsSync } from 'fs'

async function main() {
  console.log('=== Seeding production database ===\n')

  // 1. Create admin user (Manny) if not exists
  const adminEmail = process.env.ADMIN_EMAIL || 'manny@cybershare.tech'
  const adminPassword = process.env.ADMIN_PASSWORD || 'password123'

  const existing = await db.user.findUnique({ where: { email: adminEmail } })
  if (existing) {
    console.log(`✓ Admin user already exists: ${adminEmail}`)
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 10)
    const user = await db.user.create({
      data: {
        email: adminEmail,
        name: 'Manny',
        passwordHash,
        role: 'admin',
      },
      select: { id: true, email: true, name: true, role: true },
    })
    console.log(`✓ Created admin user: ${user.email} (${user.name}, ${user.role})`)
  }

  // 2. Add Webshare proxies if file exists
  const proxiesFile = `${__dirname}/.proxies.local.txt`
  if (existsSync(proxiesFile)) {
    const proxies = readFileSync(proxiesFile, 'utf-8').trim()
    if (proxies) {
      const existingConfig = await db.proxyConfig.findFirst({ where: { name: 'Webshare Residential' } })
      if (existingConfig) {
        console.log('✓ Webshare proxy config already exists')
      } else {
        const config = await db.proxyConfig.create({
          data: {
            name: 'Webshare Residential',
            type: 'http',
            proxies,
            rotateMode: 'round-robin',
            enabled: true,
          },
        })
        const count = proxies.split(/\r?\n/).filter(Boolean).length
        console.log(`✓ Created Webshare proxy config: ${count} proxies (round-robin)`)
      }
    }
  } else {
    console.log('⚠ No proxies file found at scripts/.proxies.local.txt — skipping proxy seed')
  }

  console.log('\n=== Done ===')
  console.log(`Login at: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}`)
  console.log(`Email: ${adminEmail}`)
  console.log(`Password: ${adminPassword}`)
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
