import process from 'node:process'

export const minimumRuntime = '26.13.1'

export function assertSupportedRuntime(version = process.version) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  const parts = match?.slice(1).map(Number)
  if (!parts || match?.[0] !== version || !parts.every(Number.isSafeInteger)
    || parts[0] !== 26 || parts[1] < 13 || (parts[1] === 13 && parts[2] < 1)) {
    throw new Error('The API requires Node.js 26.13.1 or newer within Node 26.')
  }
}
