import type * as modern from './dist/index.js' with { 'resolution-mode': 'import' }

interface RequestLike {
  headers: { 'content-type'?: string, 'content-length'?: string | number, 'transfer-encoding'?: string }
}

declare const typeIs: Omit<typeof modern, 'match' | 'normalize'> & {
  (request: RequestLike, types?: string | readonly string[], ...additional: string[]): string | false | null
  is(value: string | RequestLike | null | undefined, types?: string | readonly string[], ...additional: string[]): string | false
  normalize(value: unknown): string | false
  match(expected: string | false, actual: string): boolean
}

export = typeIs
