import type * as modern from './dist/index.js' with { 'resolution-mode': 'import' }

type GetRawBody = typeof modern.getRawBody & {
  (stream: modern.NodeRawBodyStream, encoding: modern.Encoding): Promise<string>
  (stream: modern.NodeRawBodyStream, encoding: modern.Encoding, callback: (error: modern.RawBodyError | null, body: string) => void): void
}

declare const rawBody: GetRawBody & Omit<typeof modern, 'default' | 'getRawBody'> & {
  default: GetRawBody
  getRawBody: GetRawBody
}

export = rawBody
