# HTTP library compatibility

The four `.webops.2` packages execute the unchanged upstream major-version
implementations recorded in `UPSTREAM.json`. Their CommonJS entrypoints adapt
Express 5 and body-parser callers to those implementations. ESM imports retain
the upstream interface. The original modules, maps, licenses and package metadata
remain in each generated package.

Conditional exports select separate strict declarations for the CommonJS and
ESM interfaces. TypeScript 6 and 7 compile both forms, while negative fixtures
reject invalid calls. Raw-body's CommonJS declarations also preserve its encoding
shortcuts. Earlier `.webops.1` archives remain unchanged historical inputs.

- Cookie 2 keeps Express's positional serialization and URI encoding, including
  signed/JSON values and security attributes. Explicit name/value arguments take
  precedence over extra option properties.
- Encodeurl 3 exposes its modern encoder as the callable CommonJS value.
- Raw-body 4 keeps callback/promise calling forms and iconv-lite encoding support
  through the new decoder hook. Limits, cancellation and error handling execute
  the upstream reader. Explicit decoder options remain caller-owned.
- Type-is 3 performs matching through its new matcher and `TypeIs`, with MIME
  extension lookup and the existing no-body, no-match and wildcard return values.

`npm run package:http-compat` regenerates the deployment inputs. Its `--check`
mode verifies the official input digests, reproduces the package payloads and
checks both consuming lockfile integrities. Tests exercise actual Express,
body-parser, router and static-serving callers. Every package and decoder/MIME
dependency remains included in dependency audits and artifact acceptance.
