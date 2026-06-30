/**
 * Seed the Webshare proxies into the database as a single ProxyConfig.
 */
import { db } from '../src/lib/db'

const PROXIES = [
  'http://USER:PASS@PROXY_IP_1:6754',
  'http://USER:PASS@PROXY_IP_2:7684',
  'http://USER:PASS@PROXY_IP_3:6014',
  'http://USER:PASS@PROXY_IP_4:5863',
  'http://USER:PASS@PROXY_IP_5:6462',
  'http://USER:PASS@PROXY_IP_6:6641',
  'http://USER:PASS@PROXY_IP_7:6361',
  'http://USER:PASS@PROXY_IP_8:6370',
  'http://USER:PASS@PROXY_IP_9:5611',
  'http://USER:PASS@PROXY_IP_10:6185',
].join('\n')

async function main() {
  // Check if a Webshare config already exists
  const existing = await db.proxyConfig.findFirst({
    where: { name: 'Webshare Residential' },
  })

  if (existing) {
    const updated = await db.proxyConfig.update({
      where: { id: existing.id },
      data: { proxies: PROXIES, enabled: true },
    })
    console.log(`Updated existing config: ${updated.id}`)
    return
  }

  const config = await db.proxyConfig.create({
    data: {
      name: 'Webshare Residential',
      type: 'http',
      proxies: PROXIES,
      rotateMode: 'round-robin',
      enabled: true,
    },
  })

  console.log(`Created proxy config: ${config.id}`)
  console.log(`  Name: ${config.name}`)
  console.log(`  Type: ${config.type}`)
  console.log(`  Proxies: 10 (round-robin rotation)`)
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
