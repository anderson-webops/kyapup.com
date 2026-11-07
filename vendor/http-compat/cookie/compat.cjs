const modern = require('./dist/index.js')

function parse(value, options) {
  if (typeof value !== 'string')
    throw new TypeError('argument str must be a string')
  const decode = options?.decode || decodeURIComponent
  return modern.parseCookie(value, {
    ...options,
    decode(encoded) {
      const unquoted = encoded.startsWith('"') ? encoded.slice(1, -1) : encoded
      try {
        return decode(unquoted)
      }
      catch {
        return unquoted
      }
    },
  })
}

function serialize(name, value, options) {
  return modern.stringifySetCookie({ ...options, name, value }, {
    encode: options?.encode ?? encodeURIComponent,
  })
}

module.exports = { ...modern, parse, serialize }
