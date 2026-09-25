import { chmod, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { SecondaryLoginState } from '../src/secondary-state.js'

const identity = '1'.repeat(64)
const other = '2'.repeat(64)
const windowMs = 172_800_000
const options = { maxEntries: 10_000, failureLimit: 3, failureWindowMs: windowMs, lockoutMs: windowMs, identityKeyId: 'a'.repeat(64) }
const opened: SecondaryLoginState[] = []
const directories: string[] = []
const workers: Worker[] = []

afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.terminate()))
  opened.splice(0).forEach(store => store.close())
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture(maxEntries = 10_000) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'kya-auth-state-')))
  directories.push(directory)
  await chmod(directory, 0o700)
  const path = join(directory, 'login-state.sqlite')
  const open = () => {
    const store = new SecondaryLoginState(path, { ...options, maxEntries })
    opened.push(store)
    return store
  }
  return { directory, path, open, store: open() }
}

describe('Persistent secondary login state', () => {
  it('keeps a rolling failure window rather than resetting a fixed bucket', async () => {
    const { store } = await fixture()
    expect(store.decide(identity, 100, false).status).toBe('incorrect')
    expect(store.decide(identity, 200, false).status).toBe('incorrect')
    // The first failure expires exactly here, but the second must survive.
    expect(store.decide(identity, 100 + windowMs, false).status).toBe('incorrect')
    expect(store.decide(identity, 101 + windowMs, false)).toEqual({ status: 'locked', retryAfterSeconds: 172_800 })
  })

  it('persists lockouts, never extends them, and admits at the exact expiry', async () => {
    const f = await fixture()
    f.store.decide(identity, 100, false)
    f.store.decide(identity, 101, false)
    expect(f.store.decide(identity, 102, false).status).toBe('locked')
    f.store.close()
    const reopened = f.open()
    expect(reopened.decide(identity, 102 + windowMs - 1, true)).toEqual({ status: 'locked', retryAfterSeconds: 1 })
    expect(reopened.decide(identity, 102 + windowMs, true)).toEqual({ status: 'authenticated' })
    expect(reopened.decide(identity, 103 + windowMs, false)).toEqual({ status: 'incorrect' })
  })

  it('retains partial counters across restart and clears only successful unblocked attempts', async () => {
    const f = await fixture()
    f.store.decide(identity, 10, false)
    f.store.close()
    const reopened = f.open()
    expect(reopened.decide(identity, 11, false).status).toBe('incorrect')
    expect(reopened.decide(identity, 12, true).status).toBe('authenticated')
    expect(reopened.decide(identity, 13, false).status).toBe('incorrect')
    expect(reopened.decide(identity, 14, false).status).toBe('incorrect')
    expect(reopened.decide(identity, 15, false).status).toBe('locked')
  })

  it('does not evict an active lockout or counter at capacity and sweeps expired records', async () => {
    const f = await fixture(2)
    for (let i = 0; i < 3; i++) f.store.decide(identity, 100, false)
    f.store.decide(other, 101, false)
    const extra = '3'.repeat(64)
    expect(f.store.check(extra, 102)).toEqual({ status: 'unavailable' })
    expect(f.store.decide(extra, 102, true)).toEqual({ status: 'unavailable' })
    expect(f.store.check(identity, 102).status).toBe('locked')
    expect(f.store.sweep(100 + windowMs)).toBe(true)
    expect(f.store.check(extra, 100 + windowMs).status).toBe('allowed')
    expect(f.store.decide(other, 100 + windowMs, false).status).toBe('incorrect')
    expect(f.store.sweep(100 + 2 * windowMs)).toBe(true)
    const database = new DatabaseSync(f.path, { readOnly: true })
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM secondary_attempts').all()[0]?.count).toBe(0)
    }
    finally { database.close() }
  })

  it('persists clock rollback detection and binds the identity key and policy', async () => {
    const f = await fixture()
    f.store.decide(identity, 5000, false)
    f.store.close()
    const before = await readFile(f.path)
    for (const patch of [{ identityKeyId: 'b'.repeat(64) }, { lockoutMs: windowMs + 1 }]) {
      expect(() => new SecondaryLoginState(f.path, { ...options, ...patch })).toThrow('Secondary login state unavailable')
      expect(await readFile(f.path)).toEqual(before)
    }
    const reopened = f.open()
    expect(reopened.check(identity, 4999)).toEqual({ status: 'unavailable' })
    expect(reopened.sweep(4999)).toBe(false)
    expect(reopened.check(identity, 5000)).toEqual({ status: 'allowed' })
  })

  it('denies unavailable, corrupt, insecure and unsupported state without modifying unrelated data', async () => {
    const f = await fixture()
    f.store.close()
    expect(f.store.decide(identity, 100, true)).toEqual({ status: 'unavailable' })
    await chmod(f.directory, 0o755)
    expect(() => f.open()).toThrow('Secondary login state unavailable')
    await chmod(f.directory, 0o700)
    await chmod(f.path, 0o644)
    expect(() => f.open()).toThrow('Secondary login state unavailable')
    await chmod(f.path, 0o600)
    const alias = join(f.directory, 'alias.sqlite')
    await symlink(f.path, alias)
    expect(() => new SecondaryLoginState(alias, options)).toThrow('Secondary login state unavailable')
    const foreign = join(f.directory, 'foreign.sqlite')
    const database = new DatabaseSync(foreign)
    database.exec("CREATE TABLE photos (name TEXT); INSERT INTO photos VALUES ('synthetic preserved photo'); PRAGMA user_version = 2;")
    database.close()
    await chmod(foreign, 0o600)
    const before = await readFile(foreign)
    expect(() => new SecondaryLoginState(foreign, options)).toThrow('Secondary login state unavailable')
    expect(await readFile(foreign)).toEqual(before)
    const corrupt = join(f.directory, 'corrupt.sqlite')
    await writeFile(corrupt, 'synthetic corrupt database', { mode: 0o600 })
    expect(() => new SecondaryLoginState(corrupt, options)).toThrow('Secondary login state unavailable')
  })

  it('enforces the entry and database-size limits and rejects invalid identifiers', async () => {
    const f = await fixture(3)
    for (let i = 1; i <= 4; i++) {
      const result = f.store.decide(String(i).repeat(64), i, false)
      expect(result.status).toBe(i <= 3 ? 'incorrect' : 'unavailable')
    }
    expect(f.store.check('192.0.2.1', 5)).toEqual({ status: 'unavailable' })
    expect(f.store.check(identity, Number.NaN)).toEqual({ status: 'unavailable' })
    expect(() => new SecondaryLoginState(f.path, { ...options, maxEntries: 10001 })).toThrow()
    const database = new DatabaseSync(f.path)
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM secondary_attempts').all()[0]?.count).toBe(3)
      expect(database.prepare('PRAGMA page_count').all()[0]?.page_count).toBeLessThanOrEqual(2048)
    }
    finally { database.close() }
    expect((await stat(f.path)).size).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect((await stat(f.path)).mode & 0o777).toBe(0o600)
    expect((await readFile(f.path)).includes(Buffer.from('192.0.2.1'))).toBe(false)
  })

  it('linearizes simultaneous failures from independent SQLite connections', async () => {
    const f = await fixture()
    const source = await readFile(new URL('../src/secondary-state.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
    const modulePath = join(f.directory, 'secondary-state.mjs')
    await writeFile(modulePath, compiled, { mode: 0o600 })
    const code = `
      const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.module).then(({ SecondaryLoginState }) => {
        const store = new SecondaryLoginState(workerData.path, workerData.options);
        parentPort.once('message', () => {
          const result = store.decide(workerData.identity, 1000, false);
          store.close(); parentPort.postMessage(result);
        });
        parentPort.postMessage('ready');
      });
    `
    for (let i = 0; i < 3; i++) {
      const worker = new Worker(code, { eval: true, workerData: { module: pathToFileURL(modulePath).href, path: f.path, options, identity } })
      workers.push(worker)
      await new Promise<void>((resolve, reject) => {
        worker.once('message', value => value === 'ready' ? resolve() : reject(new Error('Unexpected worker status')))
        worker.once('error', reject)
      })
    }
    const results = workers.map(worker => new Promise<{ status: string }>((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.postMessage('go')
    }))
    expect((await Promise.all(results)).map(result => result.status).sort()).toEqual(['incorrect', 'incorrect', 'locked'])
    expect(f.store.check(identity, 1000).status).toBe('locked')
  }, 10_000)
})
