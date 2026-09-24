# Security and authorization model

## Current boundary

This template has no identity system, login, session, role, administrator, promotion, demotion, or privileged mutation workflow. Its only API response is a public, read-only liveness signal. The former process-local page-view counter was removed because a state-changing `GET` endpoint without an authorization or persistence model is not a safe example for downstream applications.

The security boundary is the Express application, not the Nuxt UI. The browser uses the same-origin `/api` route in every supported deployment. Cross-origin credential sharing is disabled, and CORS is not treated as authentication.

## Enforced controls

- Only `GET`, `HEAD`, and `OPTIONS` are accepted below `/api`.
- The health response contains no process start time, version, environment, or secret metadata and is never cached.
- Helmet supplies response hardening headers; Nginx, Netlify, and generated Nuxt output add browser-facing defense-in-depth headers and CSP.
- API requests are rate limited, with proxy trust set explicitly by each deployment adapter rather than globally trusting forwarded headers.
- Listener ports and proxy-hop counts are range checked.
- Server request, header, keep-alive, and shutdown durations are bounded.
- Production source maps are disabled.
- The direct API is loopback-only and runs as an unprivileged, capability-free systemd service with a read-only system
  view; Nginx is the only public listener.
- npm optional dependencies and Linux ARM64 native lock entries are checked, while unreviewed dependency install scripts fail installation.

## Requirements for downstream authentication

Before adding any protected data or mutation, a downstream repository must:

1. Authenticate on the backend using a reviewed session or token design.
2. Authorize every protected route on the server using deny-by-default role or capability checks.
3. Re-read the actor's current role from trusted server-side state for promotion, demotion, and destructive operations.
4. Prevent self-promotion and require an authorized actor for every role change.
5. Revoke or refresh active sessions after security-sensitive account changes.
6. Record immutable audit events for role and privilege changes without logging credentials or session secrets.
7. Add positive and negative tests for anonymous, ordinary, stale-role, demoted, and administrator cases.
8. Add CSRF protection before accepting cookie-authenticated mutations.
9. Keep secrets in deployment-scoped environment storage, never in Nuxt public runtime configuration or source control.

Frontend visibility checks may improve usability, but they never satisfy these requirements.
