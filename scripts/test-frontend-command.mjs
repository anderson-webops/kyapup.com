import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { frontendCommand } from './frontend-command.mjs'

for (const name of ['front-end', 'named-front-end']) {
  test(`the browser launcher resolves the ${name} workspace from its own directory`, async (context) => {
    const scratch = resolve(import.meta.dirname, '../.ai-work/runs')
    await mkdir(scratch, { recursive: true })
    const root = await mkdtemp(resolve(scratch, 'frontend-command-'))
    context.after(() => rm(root, { recursive: true }))
    const directory = resolve(root, 'front-end')
    await mkdir(directory)
    await writeFile(resolve(root, 'package.json'), JSON.stringify({
      private: true,
      workspaces: ['front-end'],
    }))
    await writeFile(resolve(directory, 'package.json'), JSON.stringify({ name, private: true }))
    const command = frontendCommand(root)
    const output = execFileSync('npm', [
      '--offline',
      '--yes=false',
      ...command.args,
      process.execPath,
      '-p',
      'process.cwd()',
    ], {
      cwd: command.cwd,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    assert.equal(output.trim(), directory)
  })
}
