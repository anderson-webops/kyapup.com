export interface ServerEnvironment {
  HOST?: string
  PORT?: string
  TRUST_PROXY_HOPS?: string
}

export interface ServerConfig {
  host: '127.0.0.1' | '::1'
  port: number
  trustProxyHops: number
}

function parseInteger(name: string, rawValue: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (rawValue === undefined || rawValue === '')
    return fallback

  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`)

  return value
}

export function readServerConfig(environment: ServerEnvironment = process.env): ServerConfig {
  const host = environment.HOST || '127.0.0.1'
  if (host !== '127.0.0.1' && host !== '::1')
    throw new RangeError('HOST must be the IPv4 or IPv6 loopback address')

  return {
    host,
    port: parseInteger('PORT', environment.PORT, 3006, 1, 65_535),
    trustProxyHops: parseInteger('TRUST_PROXY_HOPS', environment.TRUST_PROXY_HOPS, 0, 0, 2),
  }
}
