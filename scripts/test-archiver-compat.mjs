import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const root = createRequire(new URL('../package.json', import.meta.url))
const nitro = createRequire(root.resolve('nitropack/package.json'))

for (const [name, consumer] of [
  ['root', root],
  ['Nitro', nitro],
]) {
  test(`Archiver 8 provides ${name}'s supported named API and real archive streams`, { timeout: 5000 }, async () => {
    const entrypoint = consumer.resolve('archiver')
    const metadata = JSON.parse(readFileSync(resolve(dirname(entrypoint), 'package.json'), 'utf8'))
    assert.equal(metadata.version, '8.0.0')
    const { ZipArchive, TarArchive } = await import(pathToFileURL(entrypoint))
    for (const Archive of [ZipArchive, TarArchive]) {
      const archive = new Archive({ store: true })
      const chunks = []
      const completed = new Promise((resolve, reject) => {
        archive.on('data', chunk => chunks.push(chunk))
        archive.once('error', reject)
        archive.once('end', resolve)
      })
      archive.append('static-build-fixture', { name: 'fixture.txt' })
      await archive.finalize()
      await completed
      const contents = Buffer.concat(chunks)
      assert.ok(contents.includes(Buffer.from('fixture.txt')))
      assert.ok(contents.includes(Buffer.from('static-build-fixture')))
    }
  })
}

test('the template uses Archiver 8 only as a build dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.devDependencies.archiver, '^8.0.0')
  assert.equal(manifest.dependencies.archiver, undefined)
  assert.deepEqual(manifest.workspaces, ['front-end', 'back-end'])
})
