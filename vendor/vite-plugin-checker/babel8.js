import { codeFrameColumns as modernCodeFrameColumns } from '@babel/code-frame'

function position(value) {
  const column = value.column
  return { ...value, column: typeof column === 'number' ? column - 1 : column }
}

export function codeFrameColumns(source, location, options) {
  return modernCodeFrameColumns(source, {
    start: position(location.start),
    ...(location.end ? { end: position(location.end) } : {}),
  }, options)
}
