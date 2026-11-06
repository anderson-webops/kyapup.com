import { request } from 'node:https'

export function getSecureResponse(url, ca, servername) {
  return new Promise((resolveResponse, rejectResponse) => {
    const client = request(url, {
      ca,
      rejectUnauthorized: true,
      ...(servername
        ? { servername }
        : {}),
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => body += chunk)
      response.once('error', rejectResponse)
      response.once('end', () => resolveResponse({ status: response.statusCode, body }))
    })
    client.setTimeout(3000, () => client.destroy(new Error('HTTPS fixture request timed out')))
    client.once('error', rejectResponse)
    client.end()
  })
}
