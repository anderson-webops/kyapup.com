const modern = require('./dist/index.js')
const contentType = require('content-type')
const mime = require('mime-types')

function normalize(value) {
  if (typeof value !== 'string')
    return false
  const normalized = modern.normalize(value, {
    lookup: extension => modern.DEFAULT_LOOKUP(extension) || mime.lookup(extension) || undefined,
  })
  return normalized.includes('/') ? normalized : false
}

function is(value, ...patterns) {
  if (value && typeof value === 'object')
    value = value.headers['content-type']
  if (!value)
    return false

  let actual
  try {
    actual = contentType.parse(value, { parameters: false }).type
    if (!modern.match('*/*')(actual))
      return false
  }
  catch {
    return false
  }

  const expected = Array.isArray(patterns[0]) ? patterns[0] : patterns.filter(pattern => pattern !== undefined)
  if (expected.length === 0)
    return actual

  for (const pattern of expected) {
    const normalized = normalize(pattern)
    if (!normalized)
      continue
    try {
      if (new modern.TypeIs([normalized]).is(actual))
        return pattern.startsWith('+') || pattern.includes('*') ? actual : pattern
    }
    catch {
      continue
    }
  }
  return false
}

function typeIs(request, ...patterns) {
  return modern.hasBody(request) ? is(request.headers['content-type'], ...patterns) : null
}

function match(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string')
    return false
  try {
    return modern.match(expected)(actual)
  }
  catch {
    return false
  }
}

module.exports = Object.assign(typeIs, modern, { is, normalize, match })
