/**
 * Update Railway service build + start commands.
 * The start script installs Chromium system deps at container start,
 * then runs the worker.
 */
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

const RAILWAY_TOKEN = 'a0d0ae8e-861a-429c-a2f1-f4f938e77cdb'
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2'
const SERVICE_INSTANCE_ID = 'c06426f7-bef7-407c-85a0-bf7d5925d439'

function gql(query: string, variables: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ query, variables })
  writeFileSync('/tmp/railway-payload.json', payload)
  const cmd = `curl -s -H "Authorization: Bearer ${RAILWAY_TOKEN}" "${RAILWAY_API}" -X POST -H "Content-Type: application/json" -d @/tmp/railway-payload.json`
  return JSON.parse(execSync(cmd, { encoding: 'utf-8', timeout: 30000 }))
}

// Update the service instance with new build + start commands
const mutation = `
  mutation($input: ServiceInstanceUpdateInput!) {
    serviceInstanceUpdate(input: $input)
  }
`

const result = gql(mutation, {
  input: {
    id: SERVICE_INSTANCE_ID,
    buildCommand: 'bun install && bunx patchright install chromium',
    startCommand: 'bash scripts/railway-start.sh',
  },
})

if (result.errors) {
  console.log('Error:', JSON.stringify(result.errors, null, 2))
  process.exit(1)
}

console.log('Update result:', result.data?.serviceInstanceUpdate ? 'SUCCESS' : 'FAILED')
