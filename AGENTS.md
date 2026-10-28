# Repository Guidelines

## Standing Dependency Completion Policy

Treat dependency remediation as part of completing authorized work on this
site, not as an optional follow-up. Proactively resolve vulnerabilities,
compatibility problems, broken installations and lockfile issues. Cover direct
and transitive dependencies, production and development dependencies,
workspaces and root-level tools. Do not dismiss findings because they are
pre-existing or development-only.

Before creating a release tag or publishing a release, require a clean locked
installation for every applicable dependency graph, zero known dependency
vulnerabilities in both full and production audits, and all applicable project
checks. An unavailable or incomplete audit is not a clean result. Use supported
upgrades, replacements or maintainable patches that preserve functionality.
Do not silence findings, weaken checks or force incompatible versions merely
to obtain a passing result.

Intermediate commits may capture coherent progress. Commit and push validated
work through this site's authorized delivery process, and complete meaningful
releases rather than stopping after reporting fixable dependency blockers.
Documentation-only housekeeping does not require an application release.

Preserve unrelated work, coordinate with other active chats, and retain existing
security, approval and production-access boundaries. Existing maintenance pauses
and repository exclusions remain in force; this policy does not expand access
or authorize otherwise excluded work. If a genuine blocker prevents completion,
preserve progress and report the exact blocker and remaining work. Distinguish
a published release from verified live deployment.

Treat this as a standing instruction for this site.

Shared Sites policy (`../AGENTS.md` when available) applies. These essentials also apply in standalone checkouts:
- Never SSH, SCP, SFTP, tunnel to, or configure access to production. Do not deploy it; protected server-side automation owns activation, and source delivery alone does not prove deployment.
- GitGuardian quota, authentication, network, or service failure is not a commit/push blocker. Review outgoing changes, run another available local secret scan, preserve other hooks, and stop on real secret findings.
- Commit small, coherent, validated changes frequently as work progresses and push completed work through this repository's authorized source path, usually its default branch; use pull requests only when required.
- Group related changes into meaningful deployable milestones. Align version metadata, create a new immutable annotated semver tag, and publish its matching verified GitHub release with the required accepted artifacts.
- Complete finished deployable work through the published release consumed by protected deployment. Independently verify public release identity and acceptance read-only, or report the exact remaining blocker. Never move published tags or replace published release assets.

## Project Structure & Module Organization

- `front-end/` contains the Nuxt 4 application. UI lives in `src/components`, layouts in `src/layouts`, routes in
  `src/pages`, composables in `src/composables`, and shared constants under `src/constants`.
- `back-end/` contains the standalone Express API. Keep route wiring and middleware in `src/`, and emit compiled output
  to `dist/`.
- Root files (`package.json`, `tsconfig.base.json`, `eslint.config.js`, `netlify.toml`) define the shared monorepo
  toolchain. `deploy/` contains the direct Nginx/systemd production path.

## Build, Test, and Development Commands

- `npm ci` installs the committed workspace dependency graph. Use Node 24.18.1 and npm 12.0.2 at the repo root; do not mix package managers for normal
  development.
- `npm run dev` starts the Nuxt front-end on port `3333`.
- `npm run server` starts the Express API with `tsx watch` on port `3006`.
- `npm run typecheck` runs both the Nuxt and back-end TypeScript checks.
- `npm run lint` runs ESLint across both workspaces.
- `npm run build` generates the static front-end to `front-end/.output/public` and compiles the back-end to
  `back-end/dist`.

## Coding Style & Naming Conventions

- Follow the repo ESLint configuration. Front-end files use the upstream Nuxt/Vitesse formatting style; root and
  back-end files follow the shared monorepo lint rules.
- Prefer descriptive component and composable names. Use PascalCase for Vue components and camelCase for utility and
  composable exports.
- Keep route-facing files in `front-end/src/pages` aligned with Nuxt’s file-based routing conventions.

## Testing & Verification

- Run `npm run validate` before delivering application changes; it includes lint, types, tests, build, and deployment-output checks.
- When changing API behavior, verify both the front-end call site and the Express route behavior together.
- Keep browser API traffic same-origin at `/api`; deployment adapters must route that path to the Express app.
- Direct Nginx/systemd is the supported production path. The inherited Netlify adapter cannot host the durable photo
  library without a separately reviewed storage design.
- Treat gallery access, image processing, and persistent-library regressions as high impact.
- For direct runtime changes, run the required-path/hash regressions in `npm test`
  and the exact Linux ARM64 archive workflow in `docs/runtime-artifact-contract.md`.
  A source build, workspace install or lockfile native entry alone is not artifact
  acceptance. Verify the copied runtime against the original trusted archive.
- Preserve the static public gallery, authenticated admin API, private originals,
  sanitized display images, and persistent library outside releases. Extend the
  artifact contract and isolated acceptance fixtures for any new runtime dependency.

## Downstream Template Workflow

- `origin` is `anderson-webops/kyapup.com`; `template` points to the owned Vitesse Nuxt template, and `upstream`
  points to `antfu/vitesse-nuxt`. Review template changes selectively and preserve Kyapup's site-specific state.
- Keep the front-end/back-end workspace structure unless a reviewed site change requires otherwise.

## Lockfile Boundaries

- Keep `back-end/package-lock.json` synchronized with backend manifest changes; it is the production-only direct API
  lock, while the root lock remains authoritative for workspace development. Regenerate affected locks with manifest
  changes and verify a clean root `npm ci` plus the shared audit and validation gates.

## Protected release administration

- Maintain `deploy/README.md` as the contract for server-owned, root-controlled helpers. Source agents test those helpers only in isolated unprivileged fixtures and never install or invoke them on production. Preserve protected parent/archive/candidate paths, unprivileged cache creation and installed-host compatibility.
- Changes to this boundary require `npm run test:promotion` on isolated Linux plus the exact ARM64 artifact workflow. Preserve failure/interrupt rollback, locked promotion and independently validated metadata. Do not substitute a marker file for acceptance.
