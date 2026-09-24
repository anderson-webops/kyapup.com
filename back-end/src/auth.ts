import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const cost = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const pattern = /^scrypt\$32768\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/

export function validPasswordHash(hash: string) {
  return pattern.test(hash)
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, cost, (error, key) => error ? reject(error) : resolve(key))
  })
}

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 1024) throw new Error('Use a password between 12 and 1024 characters')
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `scrypt$32768$8$1$${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPassword(password: string, hash: string) {
  const match = pattern.exec(hash)
  if (!match) return false
  const key = await derive(password, Buffer.from(match[1], 'hex'))
  return timingSafeEqual(key, Buffer.from(match[2], 'hex'))
}

export function validImportTokenHash(hash: string) {
  return /^[a-f0-9]{64}$/i.test(hash)
}

export function verifyImportToken(authorization: string | undefined, hash: string) {
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/i.exec(authorization ?? '')
  if (!match || !validImportTokenHash(hash)) return false
  const actual = createHash('sha256').update(match[1], 'utf8').digest()
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'))
}

export interface Session {
  id: string
  csrfToken: string
  expiresAt: number
}

export class Sessions {
  private readonly entries = new Map<string, Session>()
  constructor(private readonly ttlMs = 12 * 60 * 60 * 1000) {}

  get(id: string | undefined) {
    this.prune()
    return id ? this.entries.get(id) : undefined
  }

  create() {
    this.prune()
    // Cap memory even when credentials are used to create many sessions.
    while (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!)
    const session = { id: randomBytes(32).toString('hex'), csrfToken: randomBytes(32).toString('hex'), expiresAt: Date.now() + this.ttlMs }
    this.entries.set(session.id, session)
    return session
  }

  remove(id: string | undefined) {
    if (id) this.entries.delete(id)
  }

  private prune() {
    for (const [id, session] of this.entries) {
      if (session.expiresAt <= Date.now()) this.entries.delete(id)
    }
  }
}
