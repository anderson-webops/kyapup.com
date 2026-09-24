# Workspace Instructions

- This repository is the Nuxt monorepo template derived from `antfu/vitesse-nuxt`.
- Keep `origin` pointed at the template repository and `upstream` pointed at `antfu/vitesse-nuxt`.
- Maintain the root npm workspace pattern with exactly two primary workspaces: `front-end` and `back-end`.
- Use Node 24.18.1 with npm 12.0.2 and validate template changes with `npm run audit:all`, `npm run audit:prod`,
  `npm run validate`, and `npm run a11y` before pushing.
- Keep `package-lock.json` up to date whenever dependencies or workspace manifests change.
- Keep `back-end/package-lock.json` in parity with the backend manifest because the direct API runtime uses it for its
  production-only install.
- Do not leave completed template work uncommitted or unpushed.
- Preserve the Docker-free direct Nginx/systemd and Netlify adapters so every production path deploys the Express
  backend instead of silently discarding it.

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
