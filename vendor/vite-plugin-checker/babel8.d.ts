import type { Options } from '@babel/code-frame'

export interface SourceLocation {
  start: { line: number; column?: number }
  end?: { line: number; column?: number }
}

export declare function codeFrameColumns(source: string, location: SourceLocation, options?: Options): string
