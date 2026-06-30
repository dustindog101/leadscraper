/**
 * Seed proxy configurations into the database.
 *
 * Usage:
 *   # From a file (one proxy URL per line):
 *   bun run scripts/seed-proxies.ts proxies.txt "My Proxy Config"
 *
 *   # From an env var (newline-separated):
 *   PROXY_LIST="http://user:pass@1.2.3.4:8080
 *   socks5://5.6.7.8:1080" bun run scripts/seed-proxies.ts
 *
 *   # From stdin:
 *   cat proxies.txt | bun run scripts/seed-proxies.ts
 *
 *   # Interactive paste:
 *   bun run scripts/seed-proxies.ts
 *   # (then paste proxies, press Ctrl+D)
 *
 * This script NEVER hardcodes credentials. Bring your own proxies.
 */
import { db } from '../src/lib/db'
import { readFileSync } from 'fs'

async function main() {
  const args = process.argv.slice(2)
  let proxies = ''
  let name = 'Default Proxy Config'

  // Arg 1: optional filename OR proxy list
  // Arg 2: optional name
  if (args.length >= 2) {
    name = args[1]
  }

  if (args.length >= 1 && args[0] !== '-') {
    // Try reading as a file first
    try {
      proxies = readFileSync(args[0], 'utf-8')
      if (args.length < 2) {
        // Derive name from filename
        name = args[0].replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
        name = name.charAt(0).toUpperCase() + name.slice(1)
      }
    } catch {
      // Treat as inline proxy list
      proxies = args[0]
    }
  } else if (process.env.PROXY_LIST) {
    proxies = process.env.PROXY_LIST
  } else {
    // Read from stdin
    console.log('Paste proxy URLs (one per line), then press Ctrl+D:')
    proxies = readFileSync('/dev/stdin', 'utf-8')
  }

  proxies = proxies.trim()
  if (!proxies) {
    console.error('No proxies provided.')
    console.error('')
    console.error('Usage:')
    console.error('  bun run scripts/seed-proxies.ts <file> [name]')
    console.error('  PROXY_LIST="..." bun run scripts/seed-proxies.ts')
    console.error('  cat proxies.txt | bun run scripts/seed-proxies.ts')
    process.exit(1)
  }

  const lineCount = proxies.split(/\r?\n/).filter(Boolean).length

  // Check if a config with this name already exists
  const existing = await db.proxyConfig.findFirst({ where: { name } })

  if (existing) {
    const updated = await db.proxyConfig.update({
      where: { id: existing.id },
      data: { proxies, enabled: true },
    })
    console.log(`Updated existing config "${updated.name}" with ${lineCount} proxy(ies).`)
    return
  }

  // Detect type from first proxy line
  const firstLine = proxies.split(/\r?\n/)[0]
  const type = firstLine.startsWith('socks5') ? 'socks5' :
               firstLine.startsWith('socks4') ? 'socks4' : 'http'

  const config = await db.proxyConfig.create({
    data: {
      name,
      type,
      proxies,
      rotateMode: 'round-robin',
      enabled: true,
    },
  })

  console.log(`Created proxy config: ${config.id}`)
  console.log(`  Name: ${config.name}`)
  console.log(`  Type: ${config.type}`)
  console.log(`  Proxies: ${lineCount} (round-robin rotation)`)
  console.log(`  Enabled: ${config.enabled}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
