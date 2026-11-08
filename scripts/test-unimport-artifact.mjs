import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const graph = path.join(root, 'vendor/unimport/runtime')
const parent = path.join(root, '.ai-work/runs')
await mkdir(parent, { recursive: true })
const scratch = await mkdtemp(path.join(parent, 'unimport-artifact-'))
const environment = {
  PATH: path.dirname(process.execPath),
  HOME: scratch,
  TMPDIR: scratch,
  TMP: scratch,
  TEMP: scratch,
  NODE_ENV: 'production',
  NODE_PATH: '',
  NODE_OPTIONS: '',
}
const command = [
  '--permission',
  `--allow-fs-read=${scratch}`,
  `--allow-fs-read=${process.execPath}`,
  path.join(scratch, 'entry.mjs'),
  path.join(root, 'package.json'),
]
function execute() {
  return execFileSync(process.execPath, command, {
    cwd: scratch,
    env: environment,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30000,
  })
}

try {
  await cp(path.join(graph, 'node_modules'), path.join(scratch, 'node_modules'), { recursive: true })
  await cp(path.join(graph, 'package.json'), path.join(scratch, 'package.json'))
  await cp(path.join(root, 'scripts/fixtures/unimport-runtime.mjs'), path.join(scratch, 'entry.mjs'))
  assert.match(execute(), /passed with source and development dependencies denied/)
  const provenance = JSON.parse(await readFile(path.join(scratch, 'node_modules/unimport/WEBOPS-SOURCE.json'), 'utf8'))
  const contexts = Object.keys(provenance.outputSha256).filter(name => /^dist\/context-[\w-]+\.mjs$/u.test(name))
  assert.equal(contexts.length, 1)
  const module = path.join(scratch, 'node_modules/unimport', contexts[0])
  const retained = path.join(scratch, 'retained-runtime-module.mjs')
  await rename(module, retained)
  try {
    assert.throws(execute, error => error.status !== 0 && error.stderr.includes('ERR_MODULE_NOT_FOUND') && error.stderr.includes(path.basename(module)))
  }
  finally {
    await rename(retained, module)
  }
  assert.match(execute(), /passed with source and development dependencies denied/)
  console.log('Production-only compiler: confined core/addon/plugin execution, missing-module rejection and exact retained restart passed')
}
finally {
  await rm(scratch, { recursive: true, force: true })
}
