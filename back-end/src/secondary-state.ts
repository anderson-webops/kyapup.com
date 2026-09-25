import { closeSync, constants, lstatSync, openSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface SecondaryStateOptions {
  maxEntries: number
  failureLimit: number
  failureWindowMs: number
  lockoutMs: number
  identityKeyId: string
}

type DeniedState = { status: 'locked', retryAfterSeconds: number } | { status: 'unavailable' }
export type SecondaryStateCheck = { status: 'allowed' } | DeniedState
export type SecondaryStateDecision = { status: 'authenticated' } | { status: 'incorrect' } | DeniedState

interface StateRow {
  firstFailure: number | null
  secondFailure: number | null
  lockedUntil: number | null
}

interface MetadataRow {
  lastSeen: number
  identityKeyId: string
  failureLimit: number
  failureWindowMs: number
  lockoutMs: number
}

const hexIdentity = /^[a-f0-9]{64}$/
const pageSize = 4096
const maxPages = 2048
const maxDatabaseBytes = pageSize * maxPages
// A transaction may append at most one frame per database page, plus the WAL header.
const maxTransactionBytes = maxPages * (pageSize + 24) + 32
const maxWalBytes = 2 * maxTransactionBytes
const unavailable = () => ({ status: 'unavailable' as const })

/** Durable secondary-only policy. All decisions linearize in short SQLite transactions. */
export class SecondaryLoginState {
  private readonly database: DatabaseSync
  private readonly path: string
  private readonly parent: string
  private readonly options: SecondaryStateOptions
  private readonly parentInode: number
  private readonly databaseInode: number
  private closed = false

  constructor(path: string, options: SecondaryStateOptions) {
    let database: DatabaseSync | undefined
    try {
      if (!isAbsolute(path) || resolve(path) !== path || !options
        || !Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1 || options.maxEntries > 10_000
        || options.failureLimit !== 3 || !hexIdentity.test(options.identityKeyId)
        || ![options.failureWindowMs, options.lockoutMs].every(value => Number.isSafeInteger(value) && value > 0))
        throw new Error()
      this.path = path
      this.parent = dirname(path)
      this.options = { ...options }
      this.assertParents()
      const parent = lstatSync(this.parent)
      if ((parent.mode & 0o777) !== 0o700 || parent.uid !== process.getuid?.()) throw new Error()
      this.parentInode = parent.ino
      try {
        closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600))
      }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw new Error()
      }
      const file = this.assertPrivateFile(path)
      this.databaseInode = file.ino
      this.assertFiles()
      // Reject unrelated or incompatible existing databases before any persistent
      // pragma or journal conversion. A configuration mistake must not alter data.
      if (file.size > 0) {
        const probe = new DatabaseSync(path, { readOnly: true })
        try {
          probe.exec('PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 1000;')
          const version = probe.prepare('PRAGMA user_version').all()[0] as { user_version: number }
          const tables = probe.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all()
          if (version.user_version === 0) {
            if (tables.length) throw new Error()
          }
          else if (version.user_version === 1) {
            this.database = probe
            this.readMetadata()
            if (this.entryCount() > options.maxEntries) throw new Error()
            this.validateRows()
          }
          else throw new Error()
        }
        finally { probe.close() }
        this.assertFiles()
      }
      database = new DatabaseSync(path)
      this.database = database
      database.exec(`
        PRAGMA busy_timeout = 1000;
        PRAGMA trusted_schema = OFF;
        PRAGMA page_size = ${pageSize};
        PRAGMA max_page_count = ${maxPages};
        PRAGMA cache_spill = OFF;
      `)
      const actualPageSize = database.prepare('PRAGMA page_size').all()[0] as { page_size: number }
      const integrity = database.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>
      if (actualPageSize.page_size !== pageSize || integrity.length !== 1 || integrity[0].quick_check !== 'ok') throw new Error()
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA journal_size_limit = ${maxTransactionBytes};
        PRAGMA wal_autocheckpoint = 1;
      `)
      database.exec('BEGIN IMMEDIATE')
      try {
        this.assertWriteBudget()
        const version = database.prepare('PRAGMA user_version').all()[0] as { user_version: number }
        if (version.user_version === 0) {
          // An unrecognized nonempty database must never silently become fresh auth state.
          const tables = database.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all()
          if (tables.length) throw new Error()
          database.exec(`
            CREATE TABLE secondary_metadata (
              singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
              lastSeen INTEGER NOT NULL CHECK (lastSeen >= 0),
              identityKeyId TEXT NOT NULL CHECK (length(identityKeyId) = 64),
              failureLimit INTEGER NOT NULL CHECK (failureLimit = 3),
              failureWindowMs INTEGER NOT NULL CHECK (failureWindowMs > 0),
              lockoutMs INTEGER NOT NULL CHECK (lockoutMs > 0)
            ) STRICT;
            CREATE TABLE secondary_attempts (
              identity TEXT PRIMARY KEY CHECK (length(identity) = 64),
              firstFailure INTEGER,
              secondFailure INTEGER,
              lockedUntil INTEGER,
              CHECK (
                (lockedUntil IS NOT NULL AND lockedUntil > 0 AND firstFailure IS NULL AND secondFailure IS NULL)
                OR (lockedUntil IS NULL AND firstFailure IS NOT NULL AND firstFailure >= 0
                  AND (secondFailure IS NULL OR secondFailure >= firstFailure))
              )
            ) STRICT;
            PRAGMA user_version = 1;
          `)
          database.prepare('INSERT INTO secondary_metadata VALUES (1, 0, ?, ?, ?, ?)')
            .run(options.identityKeyId, options.failureLimit, options.failureWindowMs, options.lockoutMs)
        }
        else if (version.user_version !== 1) throw new Error()
        this.readMetadata()
        if (this.entryCount() > options.maxEntries) throw new Error()
        this.validateRows()
        database.exec('COMMIT')
      }
      catch {
        database.exec('ROLLBACK')
        throw new Error()
      }
      this.checkpoint()
      this.assertFiles()
    }
    catch {
      try { database?.close() }
      catch { /* Only a generic error may leave this boundary. */ }
      throw new Error('Secondary login state unavailable')
    }
  }

  check(identity: string, now: number): SecondaryStateCheck {
    if (typeof identity !== 'string') return unavailable()
    return this.run(identity, now, undefined) as SecondaryStateCheck
  }

  decide(identity: string, now: number, matched: boolean): SecondaryStateDecision {
    if (typeof identity !== 'string' || typeof matched !== 'boolean') return unavailable()
    return this.run(identity, now, matched) as SecondaryStateDecision
  }

  sweep(now: number): boolean {
    return this.run(undefined, now, undefined).status === 'allowed'
  }

  close() {
    if (this.closed) return
    this.closed = true
    try { this.checkpoint() }
    catch { /* Closing cannot make secondary authentication available. */ }
    try { this.database.close() }
    catch { /* Callers never receive filesystem or SQLite details. */ }
  }

  private run(identity: string | undefined, now: number, matched: boolean | undefined): SecondaryStateCheck | SecondaryStateDecision {
    if (this.closed || (identity !== undefined && !hexIdentity.test(identity))
      || !Number.isSafeInteger(now) || now < 0
      || now > Number.MAX_SAFE_INTEGER - Math.max(this.options.failureWindowMs, this.options.lockoutMs))
      return unavailable()
    let transaction = false
    try {
      this.assertFiles()
      this.checkpoint()
      this.database.exec('BEGIN IMMEDIATE')
      transaction = true
      this.assertWriteBudget()
      const metadata = this.readMetadata()
      if (now < metadata.lastSeen) {
        this.database.exec('ROLLBACK')
        transaction = false
        return unavailable()
      }
      this.database.prepare('UPDATE secondary_metadata SET lastSeen = ? WHERE singleton = 1').run(now)
      this.prune(now)
      const row = identity === undefined ? undefined : this.database.prepare('SELECT firstFailure, secondFailure, lockedUntil FROM secondary_attempts WHERE identity = ?')
        .all(identity)[0] as unknown as StateRow | undefined
      if (row) this.validateRow(row, now)
      let result: SecondaryStateCheck | SecondaryStateDecision
      if (identity === undefined) {
        result = { status: 'allowed' }
      }
      else if (row?.lockedUntil !== null && row?.lockedUntil !== undefined) {
        result = { status: 'locked', retryAfterSeconds: Math.ceil((row.lockedUntil - now) / 1000) }
      }
      else if (!row && this.entryCount() >= this.options.maxEntries) {
        result = unavailable()
      }
      else if (matched === undefined) {
        result = { status: 'allowed' }
      }
      else if (matched) {
        this.database.prepare('DELETE FROM secondary_attempts WHERE identity = ?').run(identity)
        result = { status: 'authenticated' }
      }
      else if (!row) {
        this.database.prepare('INSERT INTO secondary_attempts VALUES (?, ?, NULL, NULL)').run(identity, now)
        result = { status: 'incorrect' }
      }
      else if (row.secondFailure === null) {
        this.database.prepare('UPDATE secondary_attempts SET secondFailure = ? WHERE identity = ?').run(now, identity)
        result = { status: 'incorrect' }
      }
      else {
        this.database.prepare('UPDATE secondary_attempts SET firstFailure = NULL, secondFailure = NULL, lockedUntil = ? WHERE identity = ?')
          .run(now + this.options.lockoutMs, identity)
        result = { status: 'locked', retryAfterSeconds: Math.ceil(this.options.lockoutMs / 1000) }
      }
      this.database.exec('COMMIT')
      transaction = false
      this.assertFiles()
      this.checkpoint()
      return result
    }
    catch {
      if (transaction) {
        try { this.database.exec('ROLLBACK') }
        catch { /* Fail closed without exposing state or storage details. */ }
      }
      return unavailable()
    }
  }

  private prune(now: number) {
    this.database.prepare('DELETE FROM secondary_attempts WHERE lockedUntil <= ?').run(now)
    const cutoff = now - this.options.failureWindowMs
    this.database.prepare(`DELETE FROM secondary_attempts
      WHERE lockedUntil IS NULL AND COALESCE(secondFailure, firstFailure) <= ?`).run(cutoff)
    this.database.prepare(`UPDATE secondary_attempts SET firstFailure = secondFailure, secondFailure = NULL
      WHERE lockedUntil IS NULL AND firstFailure <= ? AND secondFailure > ?`).run(cutoff, cutoff)
  }

  private readMetadata(): MetadataRow {
    const rows = this.database.prepare('SELECT lastSeen, identityKeyId, failureLimit, failureWindowMs, lockoutMs FROM secondary_metadata').all() as unknown as MetadataRow[]
    if (rows.length !== 1) throw new Error()
    const row = rows[0]
    if (!Number.isSafeInteger(row.lastSeen) || row.lastSeen < 0
      || row.identityKeyId !== this.options.identityKeyId || row.failureLimit !== this.options.failureLimit
      || row.failureWindowMs !== this.options.failureWindowMs || row.lockoutMs !== this.options.lockoutMs)
      throw new Error()
    return row
  }

  private entryCount() {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM secondary_attempts').all()[0] as { count: number }
    if (!Number.isSafeInteger(row.count) || row.count < 0) throw new Error()
    return row.count
  }

  private validateRows() {
    const lastSeen = this.readMetadata().lastSeen
    const rows = this.database.prepare('SELECT identity, firstFailure, secondFailure, lockedUntil FROM secondary_attempts').all() as unknown as Array<StateRow & { identity: string }>
    for (const row of rows) {
      if (!hexIdentity.test(row.identity)) throw new Error()
      this.validateRow(row, lastSeen)
    }
  }

  private validateRow(row: StateRow, now: number) {
    const timestamp = (value: number | null) => value !== null && Number.isSafeInteger(value) && value >= 0
    if (row.lockedUntil !== null) {
      if (!timestamp(row.lockedUntil) || row.lockedUntil > now + this.options.lockoutMs
        || row.firstFailure !== null || row.secondFailure !== null) throw new Error()
    }
    else if (!timestamp(row.firstFailure) || row.firstFailure! > now
      || (row.secondFailure !== null && (!timestamp(row.secondFailure)
        || row.secondFailure < row.firstFailure! || row.secondFailure > now))) throw new Error()
  }

  private assertParents() {
    for (let parent = this.parent; ; parent = dirname(parent)) {
      const info = lstatSync(parent)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error()
      if (dirname(parent) === parent) break
    }
  }

  private assertPrivateFile(path: string) {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1
      || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600) throw new Error()
    return info
  }

  private assertFiles() {
    this.assertParents()
    const parent = lstatSync(this.parent)
    if (parent.ino !== this.parentInode || parent.uid !== process.getuid?.() || (parent.mode & 0o777) !== 0o700) throw new Error()
    const file = this.assertPrivateFile(this.path)
    if (file.ino !== this.databaseInode || file.size > maxDatabaseBytes) throw new Error()
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try {
        const sidecar = this.assertPrivateFile(`${this.path}${suffix}`)
        if (sidecar.size > (suffix === '-shm' ? 256 * 1024 : maxWalBytes)) throw new Error()
      }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw new Error()
      }
    }
  }

  private assertWriteBudget() {
    let size = 0
    try { size = statSync(`${this.path}-wal`).size }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw new Error()
    }
    // Check under the SQLite writer lock; pinned readers cannot cause unbounded WAL growth.
    if (size + maxTransactionBytes > maxWalBytes) throw new Error()
  }

  private checkpoint() {
    this.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all()
    // SQLITE_BUSY is safe: later writes have an explicit, conservative WAL byte budget.
  }
}
