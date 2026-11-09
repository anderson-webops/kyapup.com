import type * as modern from './dist/index.js' with { 'resolution-mode': 'import' }

type SerializeOptions = Omit<Parameters<typeof modern.stringifySetCookie>[0], 'name' | 'value'>
  & NonNullable<Parameters<typeof modern.stringifySetCookie>[1]>

declare const cookie: typeof modern & {
  parse: typeof modern.parseCookie
  serialize(name: string, value: string, options?: SerializeOptions): string
}

export = cookie
