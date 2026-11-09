const modern = require('./dist/index.js')
const iconv = require('iconv-lite')

function getRawBody(stream, options, callback) {
  if (typeof options === 'function')
    return modern.getRawBody(stream, { decoder: iconv.getDecoder }, options)

  const settings = options === true || typeof options === 'string'
    ? { encoding: options }
    : options
  return modern.getRawBody(stream, {
    ...settings,
    decoder: settings?.decoder === undefined ? iconv.getDecoder : settings.decoder,
  }, callback)
}

module.exports = Object.assign(getRawBody, modern)
