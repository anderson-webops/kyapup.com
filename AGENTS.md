# Repository Guidelines

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
- `npm run validate` runs the native-binding, lint, type, API test, build, and deployment-output gates.

## Coding Style & Naming Conventions

- Follow the repo ESLint configuration. Front-end files use the upstream Nuxt/Vitesse formatting style; root and
  back-end files follow the shared monorepo lint rules.
- Prefer descriptive component and composable names. Use PascalCase for Vue components and camelCase for utility and
  composable exports.
- Keep route-facing files in `app/pages` aligned with Nuxt’s file-based routing conventions.

## Testing & Verification

- Run `npm run lint`, `npm run typecheck`, and `npm run build` before pushing template changes.
- When changing API behavior, verify both the front-end call site and the Express route behavior together.
- Keep browser API traffic same-origin at `/api`; deployment adapters must route that path to the Express app.
- Preserve both Docker-free production adapters: direct Nginx/systemd and Netlify. Do not compile and discard the
  backend in either production path.
- Treat template breakage as high impact: small config changes can affect every downstream repo created from this
  template.
- For direct runtime changes, run the required-path/hash regressions in `npm test`
  and the exact Linux ARM64 archive workflow in `docs/runtime-artifact-contract.md`.
  A source build, workspace install or lockfile native entry alone is not artifact
  acceptance. Verify the copied runtime against the original trusted archive.
- Preserve the static frontend and minimal independent API. Carry the bounded
  rate store and repeated-signal drain forward without replacing downstream
  authentication, quotas, provider cleanup, dependency readiness or persistent
  state rules. Adding a dependency or service requires extending the artifact
  contract and isolated acceptance fixtures. Do not combine client services.

## Template Workflow

- `origin` is the published template repo for this monorepo pattern.
- `upstream` must continue to point to `antfu/vitesse-nuxt`.
- Preserve the front-end/back-end workspace structure when evolving the template unless a deliberate template version
  change is being made.

## Agent Delivery Workflow

- Do not leave completed work uncommitted. After each coherent, validated change set, create a commit and push it in
  the same session.
- Keep `package-lock.json` synchronized with dependency changes before every commit or push.
- Keep `back-end/package-lock.json` synchronized with backend manifest changes; it is the production-only direct API
  lock, while the root lock remains authoritative for workspace development and Netlify.
- Prefer small, logically grouped commits over one mixed commit.

## Dependency & Lockfile Discipline

- Treat the repo-root `npm ci` path as the source of truth for deploy readiness.
- Any time `package.json`, any workspace `package.json`, dependency ranges, `package-lock.json`, or dependency update tooling changes, verify lockfile parity from the repo root before committing.
- Do not rely on `npm install` fallback as success. A change is not deploy-ready unless root `npm ci` succeeds.

Required production/dev dependency update flow before every dependency commit:
1. Check production and development dependency freshness from the repository root with `npm outdated --workspaces --long` or the repo's documented equivalent.
2. Review both `dependencies` and `devDependencies` in the root and every workspace package; do not limit updates to production-only packages.
3. Apply needed updates with the narrowest command that updates the relevant manifest and lockfile together, such as `npm install -w <workspace> <package>@<version>` or `npm install -D -w <workspace> <package>@<version>`.
4. If the update is only a lockfile/security refresh, regenerate from the root with `npm install --package-lock-only --ignore-scripts --no-fund --no-audit`.
5. Run `npm audit` from the repository root and resolve remaining production or dev advisories before committing unless a documented upstream limitation prevents it.

Required dependency verification before every commit/push:
1. Run `npm ci` from the repository root.
2. Run `npm run lint`.
3. Run `npm run typecheck`.
4. Run `npm run build`.
5. If API or back-end behavior changed and the repo has a back-end workspace, run `npm run -w back-end test` or the repo's equivalent API test command.

If `npm ci` fails because `package.json` and `package-lock.json` are out of sync:
1. Run `npm install --package-lock-only --ignore-scripts --no-fund --no-audit` from the repository root.
2. Re-run `npm ci` from the repository root.
3. Commit the resulting `package-lock.json` change with the related dependency/package change.

Never commit or push dependency/package changes if root `npm ci` fails.

## Direct Delivery and Pull Requests

- After a coherent change set passes the repository's required checks, default to committing it and pushing it directly to the repository's default branch. Do not open a pull request unless the user explicitly asks for one, branch protection requires it, or an external-contribution policy makes direct integration inappropriate.
- For a release-worthy application change, update the project version as required, create an annotated tag, and publish or update the corresponding GitHub release in the same work session. Keep documentation-only, formatting-only, and other non-deployable housekeeping changes as committed and pushed source changes without inventing an application release.
- Never force-push a shared branch or move an existing published tag unless the user explicitly authorizes that exact history rewrite.
- If automation or repository policy creates a pull request, review it, wait for required checks, merge it when safe, and remove the merged branch before wrapping up. Do not leave redundant pull requests or branches open.
- Treat commit, push, tag, and GitHub release publication as source delivery only. Do not claim or perform production deployment unless it was separately authorized and verified.

## Protected release administration

- Follow `deploy/README.md` for versioned, root-controlled administrative helpers. Never execute build-owned installers, verifiers, units or promotion helpers as root. Preserve protected parent/archive/candidate paths, unprivileged cache creation and installed-host compatibility.
- Changes to this boundary require `npm run test:promotion` on isolated Linux plus the exact ARM64 artifact workflow. Preserve failure/interrupt rollback, locked promotion and independently validated metadata. Do not substitute a marker file for acceptance.
