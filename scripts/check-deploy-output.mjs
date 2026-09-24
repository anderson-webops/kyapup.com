#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const paths = {
  apiApp: resolve(projectRoot, 'back-end/dist/app.js'),
  apiServer: resolve(projectRoot, 'back-end/dist/server.js'),
  directNginx: resolve(projectRoot, 'deploy/nginx/kyapup.server.conf'),
  directPrepare: resolve(projectRoot, 'deploy/systemd/prepare-release.sh'),
  directPromote: resolve(projectRoot, 'deploy/systemd/promote-release.sh'),
  directService: resolve(projectRoot, 'deploy/systemd/kyapup-api.service'),
  frontendHealth: resolve(projectRoot, 'front-end/.output/public/healthz'),
  frontendIndex: resolve(projectRoot, 'front-end/.output/public/index.html'),
  frontendAdmin: resolve(projectRoot, 'front-end/.output/public/admin/index.html'),
}

for (const path of Object.values(paths))
  await access(path)

const [apiApp, apiServer, directNginx, directPrepare, directPromote, directService, frontendHealth, frontendIndex] = await Promise.all([
  readFile(paths.apiApp, 'utf8'),
  readFile(paths.apiServer, 'utf8'),
  readFile(paths.directNginx, 'utf8'),
  readFile(paths.directPrepare, 'utf8'),
  readFile(paths.directPromote, 'utf8'),
  readFile(paths.directService, 'utf8'),
  readFile(paths.frontendHealth, 'utf8'),
  readFile(paths.frontendIndex, 'utf8'),
])

function assert(condition, message) {
  if (!condition)
    throw new Error(message)
}

assert(JSON.parse(frontendHealth).ok === true, 'Static health check must return {"ok":true}')
assert(/http-equiv=["']content-security-policy["']/i.test(frontendIndex), 'Generated HTML must include a CSP meta policy')
assert(!frontendIndex.includes('http://localhost:3006'), 'Generated HTML must not embed the local API origin')
assert(!frontendIndex.includes('/api/pageview'), 'Generated HTML must not reference the removed mutable endpoint')
assert(!apiApp.includes('startedAt') && !apiApp.includes('pageview'), 'Compiled API must not expose process timing or page-view state')
assert(!apiApp.includes('sourceMappingURL') && !apiServer.includes('sourceMappingURL'), 'Production API output must not expose source maps')
assert(/^User=kyapup$/m.test(directService), 'Direct API service must use its unprivileged account')
assert(/^ExecStart=\/opt\/node-24\.18\.1\/bin\/node /m.test(directService), 'Direct API must select the approved runtime without replacing the host-wide binary')
assert(/^Environment=HOST=127\.0\.0\.1$/m.test(directService), 'Direct API service must bind only to loopback')
assert(/^NoNewPrivileges=true$/m.test(directService), 'Direct API service must deny privilege escalation')
assert(/^ProtectSystem=strict$/m.test(directService), 'Direct API service must have a read-only system view')
assert(/^StateDirectory=kyapup$/m.test(directService), 'The photo library must persist outside releases')
assert(/^StateDirectoryMode=0700$/m.test(directService), 'Photo storage must be private to the API account')
assert(/^Environment=PHOTO_DATA_DIR=\/var\/lib\/kyapup$/m.test(directService), 'The API must use its persistent photo directory')
assert(/^EnvironmentFile=\/etc\/kyapup\/api\.env$/m.test(directService), 'Production credentials must come from protected external configuration')
assert(!/0\.0\.0\.0|docker/i.test(directService), 'Direct API service must not depend on a container listener')
assert(/proxy_pass http:\/\/127\.0\.0\.1:3006;/.test(directNginx), 'Nginx must proxy the API to loopback')
assert(/client_max_body_size 25m;/.test(directNginx), 'The upload proxy must match the 25 MiB application limit')
assert(!/^(?:root|alias) .*\/var\/lib\/kyapup/m.test(directNginx), 'Nginx must never serve private photo storage directly')
assert(/X-Forwarded-For \$remote_addr/.test(directNginx), 'Nginx must replace, not append, the forwarded chain')
assert(!/\$proxy_add_x_forwarded_for/.test(directNginx), 'Nginx must not trust a client-supplied forwarded chain')
assert(/npm audit signatures/.test(directPrepare), 'Direct preparation must verify package signatures')
assert(/origin\/main/.test(directPrepare), 'Direct preparation must require the exact remote main revision')
assert(/--unset-all http\.https:\/\/github\.com\/\.extraheader/.test(directPrepare), 'Release preparation must remove the checkout credential before dependency scripts run')
assert(/--ipv4/.test(directPromote) && /--ipv6/.test(directPromote), 'Promotion must gate both address families')
assert(/if \[\[ -L "\$current_link" \]\]; then/.test(directPromote), 'First promotion must not invent a rollback target')
assert(/restoring the previous direct release/i.test(directPromote), 'Promotion must provide source rollback')

for (const removedPath of ['.dockerignore', 'Dockerfile', 'compose.yaml', 'docker-compose.yml', 'nginx.conf']) {
  try {
    await access(resolve(projectRoot, removedPath))
    throw new Error(`${removedPath} must be absent from the direct production template`)
  }
  catch (error) {
    if (error?.code !== 'ENOENT')
      throw error
  }
}

console.log('Deployment output check passed for the persistent systemd/Nginx photo gallery.')
