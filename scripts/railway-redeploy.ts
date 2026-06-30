/**
 * Trigger a Railway redeploy.
 */
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

const RAILWAY_TOKEN = 'a0d0ae8e-861a-429c-a2f1-f4f938e77cdb'
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2'
const SERVICE_ID = '70585087-0b19-4536-9c25-985d5b6c4005'
const ENV_ID = '0dcbb580-e9f6-4125-8e6e-27903c6392b3'

function gql(query: string, variables: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ query, variables })
  writeFileSync('/tmp/railway-payload.json', payload)
  const cmd = `curl -s -H "Authorization: Bearer ${RAILWAY_TOKEN}" "${RAILWAY_API}" -X POST -H "Content-Type: application/json" -d @/tmp/railway-payload.json`
  return JSON.parse(execSync(cmd, { encoding: 'utf-8', timeout: 60000 }))
}

// Redeploy mutation
const mutation = `
  mutation($input: DeploymentRedeployInput!) {
    deploymentRedeploy(input: $input)
  }
`

// First, get the latest deployment ID
const serviceQuery = `
  query($id: String!) {
    service(id: $id) {
      deployments(first: 1) {
        edges {
          node {
            id
            status
          }
        }
      }
    }
  }
`

const svcResult = gql(serviceQuery, { id: SERVICE_ID })
if (svcResult.errors) {
  console.log('Error:', JSON.stringify(svcResult.errors, null, 2))
  process.exit(1)
}

const latestDeploy = svcResult.data?.service?.deployments?.edges?.[0]?.node
console.log(`Latest deployment: ${latestDeploy.id} (${latestDeploy.status})`)

// Trigger redeploy
const redeployResult = gql(mutation, {
  input: {
    deploymentId: latestDeploy.id,
  },
})

if (redeployResult.errors) {
  console.log('Redeploy error:', JSON.stringify(redeployResult.errors, null, 2))
  process.exit(1)
}

console.log('Redeploy triggered:', redeployResult.data?.deploymentRedeploy ? 'SUCCESS' : 'FAILED')
