import { createHash } from 'node:crypto'
import { readFile, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = await realpath(path.resolve(import.meta.dirname, '..'))
const directory = path.join(root, 'node_modules/devframe')
const entries = [
  ['dist/index-JJbcyrny.d.mts', '0c44267d39cfdc38232fe375c45ed3a3466a06c1827beaec7ee4e9fbc92f1dd9', 'd39b7a66b2bd802eabe2b2487c9af2525568704642b8787eef8431c5f0dd189e'],
  ['dist/client/index.d.mts', '9f37e07288dead2569f4492af55d1949cc0ddfe797f2a5d44d9131f8254f061f', '880edac95e04b12c1e2ab00bb4d25a48c6cd35751ebf2dc96b5cc4c7530694bb'],
]
const digest = source => createHash('sha256').update(source).digest('hex')

for (const [name, original, patched] of entries) {
  const filename = path.join(directory, name)
  if (await realpath(filename) !== filename)
    throw new Error(`Unexpected Devframe declaration path: ${name}`)
  const source = await readFile(filename, 'utf8')
  if (digest(source) === patched)
    continue
  const updated = source.replaceAll('ScopedSharedStates<NS>[T]', `DevframeRpcSharedStates[Extract<\`\${NS}:\${T}\`, keyof DevframeRpcSharedStates>]`)
  if (digest(source) !== original || digest(updated) !== patched)
    throw new Error(`Review the Devframe TypeScript 7 compatibility patch for ${name}`)
  const temporary = `${filename}.webops-tmp`
  await writeFile(temporary, updated, { flag: 'wx', mode: 0o644 })
  await rename(temporary, filename)
}
