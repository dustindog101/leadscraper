/**
 * Railway API helper — query project status, deployments, logs.
 */
import { execSync } from 'child_process'
import { writeFileSync, readFileSync } from 'fs'

const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || 'a0d0ae8e-861a-429c-a2f1-f4f938e77cdb'
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2'

function gql(query: string, variables: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ query, variables })
  const tmpFile = '/tmp/railway-payload.json'
  writeFileSync(tmpFile, payload)
  const cmd = `curl -s -H "Authorization: Bearer ${RAILWAY_TOKEN}" "${RAILWAY_API}" -X POST -H "Content-Type: application/json" -d @${tmpFile}`
  const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 })
  return JSON.parse(result)
}

const PROJECT_QUERY = `
  query($id: String!) {
    project(id: $id) {
      id
      name
      services {
        edges {
          node {
            id
            name
            deployments(first: 5) {
              edges {
                node {
                  id
                  status
                  createdAt
                }
              }
            }
          }
        }
      }
      environments {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }
`

// List projects
const projects = gql('{ projects { edges { node { id name } } } }')
console.log('Projects:')
const projectEdges = projects.data?.projects?.edges || []
for (const e of projectEdges) {
  console.log(`  ${e.node.name} (${e.node.id})`)
}

// Get details for each project
for (const pe of projectEdges) {
  const pid = pe.node.id
  console.log(`\n=== ${pe.node.name} ===`)
  const details = gql(PROJECT_QUERY, { id: pid })
  if (details.errors) {
    console.log('Error:', JSON.stringify(details.errors, null, 2))
    continue
  }
  const proj = details.data?.project
  if (!proj) continue
  for (const env of proj.environments?.edges || []) {
    console.log(`  Env: ${env.node.name} (${env.node.id})`)
  }
  for (const s of proj.services?.edges || []) {
    console.log(`  Service: ${s.node.name} (${s.node.id})`)
    for (const d of s.node.deployments?.edges || []) {
      const meta = d.node.meta
      const errInfo = meta?.errorCode ? ` error=${meta.errorCode}` : ''
      console.log(`    Deploy: ${d.node.status} at ${d.node.createdAt} (id: ${d.node.id})${errInfo}`)
    }
  }
}
