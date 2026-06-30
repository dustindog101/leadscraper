/**
 * Check Railway resource usage — CPU, memory, and billing.
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

// Get billing/usage info
const queries = [
  '{ me { id email name } }',
  '{ projects { edges { node { id name } } } }',
]

for (const q of queries) {
  console.log(`Query: ${q.substring(0, 50)}...`)
  const result = gql(q)
  if (result.errors) {
    console.log('  Error:', result.errors[0].message)
  } else {
    console.log('  Result:', JSON.stringify(result.data, null, 2))
  }
  console.log()
}

// Check the project's subscription/plan
const PROJECT_ID = 'aca1fd3c-842d-4a81-a657-bc87ef0fb690'
const subQuery = `
  query($id: String!) {
    project(id: $id) {
      id
      name
      subscription {
        id
        plan {
          id
          name
          usageLimits {
            cpuLimit
            memoryLimit
          }
        }
      }
    }
  }
`
console.log('Checking subscription...')
const subResult = gql(subQuery, { id: PROJECT_ID })
if (subResult.errors) {
  console.log('Error:', JSON.stringify(subResult.errors, null, 2))
} else {
  console.log(JSON.stringify(subResult.data, null, 2))
}
