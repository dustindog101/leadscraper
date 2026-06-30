/**
 * Get Railway deployment logs.
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

const deploymentId = process.argv[2] || 'fcbad222-0623-4b65-9d93-95e4fdc1cbd0'

const query = `
  query($id: String!) {
    deployment(id: $id) {
      id
      status
      createdAt
      meta
      logs(first: 100) {
        edges {
          node {
            timestamp
            message
            type
          }
        }
      }
    }
  }
`

const result = gql(query, { id: deploymentId })
if (result.errors) {
  console.log('Error:', JSON.stringify(result.errors, null, 2))
  process.exit(1)
}

const dep = result.data?.deployment
console.log(`Deployment ${dep.id}: ${dep.status}`)
console.log(`Meta: ${JSON.stringify(dep.meta)}`)
console.log('\nLogs:')
for (const e of dep.logs?.edges || []) {
  const log = e.node
  console.log(`[${log.type}] ${log.message}`)
}
