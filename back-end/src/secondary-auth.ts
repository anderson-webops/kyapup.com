import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { isAbsolute, resolve } from 'node:path'
import { validPasswordHash, verifyPassword } from './auth.js'
import { SecondaryLoginState } from './secondary-state.js'

export interface SecondaryEnvironment {
  ADMIN_SECONDARY_PASSWORD_HASH?: string
  ADMIN_SECONDARY_NOT_BEFORE?: string
  ADMIN_SECONDARY_FAILURE_LIMIT?: string
  ADMIN_SECONDARY_FAILURE_WINDOW_SECONDS?: string
  ADMIN_SECONDARY_LOCKOUT_SECONDS?: string
  ADMIN_SECONDARY_STATE_MAX_ENTRIES?: string
  ADMIN_SECONDARY_STATE_PATH?: string
  ADMIN_SECONDARY_ID_HMAC_KEY?: string
}

export type SecondaryConfiguration = { mode: 'disabled' | 'unavailable' } | {
  mode: 'enabled'
  passwordHash: string
  notBefore: number
  failureLimit: number
  failureWindowMs: number
  lockoutMs: number
  maxEntries: number
  statePath: string
  identityKey: Buffer
}

/** Invalid or partial secondary configuration never disables primary recovery. */
export function readSecondaryConfig(environment: SecondaryEnvironment): SecondaryConfiguration {
  const values = [environment.ADMIN_SECONDARY_PASSWORD_HASH, environment.ADMIN_SECONDARY_NOT_BEFORE,
    environment.ADMIN_SECONDARY_FAILURE_LIMIT, environment.ADMIN_SECONDARY_FAILURE_WINDOW_SECONDS,
    environment.ADMIN_SECONDARY_LOCKOUT_SECONDS, environment.ADMIN_SECONDARY_STATE_MAX_ENTRIES,
    environment.ADMIN_SECONDARY_STATE_PATH, environment.ADMIN_SECONDARY_ID_HMAC_KEY]
  if (values.every(value => !value)) return { mode: 'disabled' }
  const invalid = { mode: 'unavailable' } as const
  if (values.some(value => !value)) return invalid
  const [passwordHash, date, limit, window, lockout, capacity, statePath, key] = values as string[]
  if (!validPasswordHash(passwordHash) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date)) return invalid
  const notBefore = Date.parse(date)
  if (!Number.isFinite(notBefore) || new Date(notBefore).toISOString() !== date.replace(/(?<!\.\d{3})Z$/, '.000Z')) return invalid
  if (limit !== '3' || window !== '172800' || lockout !== '172800'
    || !/^[1-9]\d{0,4}$/.test(capacity) || Number(capacity) > 10_000) return invalid
  if (!isAbsolute(statePath) || resolve(statePath) !== statePath) return invalid
  let identityKey: Buffer
  if (/^[a-f0-9]{64}$/i.test(key)) identityKey = Buffer.from(key, 'hex')
  else if (/^[A-Za-z0-9_-]{43}$/.test(key)) {
    identityKey = Buffer.from(key, 'base64url')
    if (identityKey.length !== 32 || identityKey.toString('base64url') !== key) return invalid
  }
  else return invalid
  return { mode: 'enabled', passwordHash, notBefore, failureLimit: 3, failureWindowMs: 172_800_000,
    lockoutMs: 172_800_000, maxEntries: Number(capacity), statePath, identityKey }
}

/** Canonical /32 and /64 keys; persisted identifiers contain no raw address. */
export function secondaryNetworkIdentity(address: string | undefined, key: Buffer): string | undefined {
  if (!address || address.includes('%')) return undefined
  const version = isIP(address)
  let network: string
  if (version === 4) network = `v4:${address}/32`
  else if (version === 6) {
    let value = address.toLowerCase()
    if (value.includes('.')) {
      const end = value.lastIndexOf(':')
      const octets = value.slice(end + 1).split('.').map(Number)
      value = `${value.slice(0, end + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
    }
    const halves = value.split('::')
    const left = halves[0] ? halves[0].split(':') : []
    const right = halves[1] ? halves[1].split(':') : []
    const groups = halves.length === 2 ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right] : left
    const bytes = Buffer.alloc(16)
    groups.forEach((group, index) => bytes.writeUInt16BE(Number.parseInt(group, 16), index * 2))
    network = bytes.subarray(0, 10).every(byte => byte === 0) && bytes[10] === 255 && bytes[11] === 255
      ? `v4:${[...bytes.subarray(12)].join('.')}/32`
      : `v6:${bytes.subarray(0, 8).toString('hex')}/64`
  }
  else return undefined
  return createHmac('sha256', key).update(network).digest('hex')
}

export type SecondaryDecision = { status: 'authenticated' | 'incorrect' | 'locked' | 'unavailable', retryAfterSeconds?: number }

export class SecondaryAuthenticator {
  private state?: SecondaryLoginState
  private sweepTimer?: ReturnType<typeof setInterval>
  constructor(private readonly config: SecondaryConfiguration, private readonly clock = Date.now) {
    if (config.mode !== 'enabled') return
    try {
      this.state = new SecondaryLoginState(config.statePath, {
        failureLimit: config.failureLimit, failureWindowMs: config.failureWindowMs,
        lockoutMs: config.lockoutMs, maxEntries: config.maxEntries,
        identityKeyId: createHmac('sha256', config.identityKey).update('kyapup-secondary-identity-key-v1').digest('hex') })
      this.sweepTimer = setInterval(() => this.state?.sweep(this.clock()), 60_000)
      this.sweepTimer.unref()
    }
    catch { /* Fail closed without logging configuration, addresses or database errors. */ }
  }

  async authenticate(password: string, address: string | undefined): Promise<SecondaryDecision> {
    if (this.config.mode === 'disabled') return { status: 'incorrect' }
    if (this.config.mode !== 'enabled') return { status: 'unavailable' }
    const started = this.clock()
    if (!Number.isSafeInteger(started)) return { status: 'unavailable' }
    if (started < this.config.notBefore) return { status: 'incorrect' }
    if (!this.state) return { status: 'unavailable' }
    const identity = secondaryNetworkIdentity(address, this.config.identityKey)
    if (!identity) return { status: 'unavailable' }
    const admission = this.state.check(identity, started)
    if (admission.status !== 'allowed') return admission
    const matched = await verifyPassword(password, this.config.passwordHash)
    const completed = this.clock()
    if (!Number.isSafeInteger(completed)) return { status: 'unavailable' }
    // Recheck at the decision point as well as before asynchronous hashing.
    if (completed < this.config.notBefore) return { status: 'incorrect' }
    return this.state.decide(identity, completed, matched)
  }

  startupMessage() {
    if (this.config.mode === 'disabled') return 'Secondary authentication disabled'
    if (this.config.mode !== 'enabled' || !this.state) return 'Secondary authentication unavailable; primary recovery retained'
    return `Secondary authentication state ready; not-before=${new Date(this.config.notBefore).toISOString()}`
  }

  close() {
    clearInterval(this.sweepTimer)
    this.state?.close()
  }
}
