# Kya security and storage model

## Public and administrator boundaries

The public page displays only photos selected for publication. The unlinked
`/admin` frontend is a convenience, not an access control. Express authenticates
all library reads and administrator writes. An archived photo's derivative URLs
also require authentication; knowing an ID does not make that photo public.
Original files have no serving route.

One owner password is stored as a salted scrypt hash in protected server
configuration. There are no public registration or role-management flows.
Production requires an explicit hash, absolute storage path, and exact allowed
HTTPS origins. Session cookies are HttpOnly, SameSite Strict, scoped to `/api`,
and Secure in production. Sessions expire after 12 hours. Session expiry and
password changes require the owner to sign in again.

Login requires an allowed Origin. Other cookie-authenticated mutations also
require the session's CSRF token. Both domain names are configured explicitly;
there is no wildcard CORS policy or shared parent-domain cookie. The browser
calls same-origin `/api` in development and production.

## Photo handling

The API accepts still JPEG, PNG, WebP, and AVIF uploads up to 25 MiB, 60 million
pixels, and 20,000 pixels per edge. Sharp decoding has time limits and two upload
slots. HEIC is not supported. It creates resized WebP display derivatives without
source metadata. Original bytes
remain private for preservation. New uploads are archived by default. Publication,
featured selection, display order, alt text, and presentation settings are stored
in SQLite outside the release. Unpublishing a photo removes its featured state.
Media responses use `Cache-Control: no-store` so archive changes are not undermined
by a deliberately cacheable public image endpoint. A viewer can still save a photo
while it is public; later archiving cannot revoke already downloaded copies.

The runtime account alone owns the mode `0700` state directory. Nginx proxies
media requests through the API and never serves that directory as static content.
The production archive verifier rejects database extensions and undeclared native
libraries. It independently requires the declared Sharp and libvips artifacts.

## Runtime controls

Minimal GET/HEAD health and readiness responses disclose no secrets or diagnostics,
set no cookies, and are never cached. Probe mutation attempts still return 405.
Readiness includes the storage dependency; shutdown prevents new application work
while existing connections drain. Rate limiting and fixed proxy trust remain at
the API boundary. The reverse proxy replaces forwarded headers and applies the
same 25 MiB request limit as the API.

Helmet, Nginx, and generated frontend policy provide browser headers. Production
source maps are disabled. The service binds to loopback, runs without capabilities,
and has a read-only system view except its private persistent state. The approved
Node runtime is selected explicitly. Dependency locks, audits, native image
bindings, and the exact copied Linux ARM64 artifact are separate release gates.

## Verification and operational limits

API tests and compiled-runtime acceptance cover login, CSRF, archived media,
publication, photo processing, configuration, and persistence. The runtime fixture
uses temporary synthetic data and never a real password or photo library. The
protected promotion fixture tests interrupted activation and rollback without
executing candidate application code as root.

A source build, passing local tests, a tag, or a GitHub release does not establish
production deployment. Domain routing, TLS, private configuration, backups, and
live administrator behavior must be verified on the separately authorized host.
See [the server runbook](../deploy/README.md). Historical template audit documents
in this folder describe their named source baseline and are not a full security
assessment of Kya's added photo and authentication features.
