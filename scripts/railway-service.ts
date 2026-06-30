/**
 * Get Railway service details — build/start commands, env vars.
 */
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

const RAILWAY_TOKEN = 'a0d0ae8e-861a-429c-a2f1-f4f938e77cdb'
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2'

function gql(query: string, variables: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ query, variables })
  writeFileSync('/tmp/railway-payload.json', payload)
  const cmd = `curl -s -H "Authorization: Bearer ${RAILWAY_TOKEN}" "${RAILWAY_API}" -X POST -H "Content-Type: application/json" -d @/tmp/railway-payload.json`
  return JSON.parse(execSync(cmd, { encoding: 'utf-8', timeout: 30000 }))
}

const SERVICE_ID = '70585087-0b19-4536-9c25-985d5b6c4005'

const query = `
  query($id: String!) {
    service(id: $id) {
      id
      name
      serviceInstances {
        edges {
          node {
            id
            buildCommand
            startCommand
            source {
              image
              repo
            }
          }
        }
      }
    }
  }
`

const result = gql(query, { id: SERVICE_ID })
if (result.errors) {
  console.log('Error:', JSON.stringify(result.errors, null, 2))
  process.exit(1)
}

const svc = result.data?.service
console.log(`Service: ${svc.name} (${svc.id})`)
for (const e of svc.serviceInstances?.edges || []) {
  const si = e.node
  console.log(`\nInstance: ${si.id}`)
  console.log(`  Build: ${si.buildCommand || '(default)'}`)
  console.log(`  Start: ${si.startCommand || '(default)'}`)
  console.log(`  Source: ${JSON.stringify(si.source)}`)
}
