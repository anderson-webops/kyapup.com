# Upstream synchronization

Kyapup's independent initial commit `d007a2668b044ac33c1cc390302172edf7db16aa`
has exactly the same tree as the owned template's `v2.1.2`:
`75882cd63fffd6f76e3f5f12af27c06f3aa977f5`. The histories do not share a
commit ancestor. Use that verified content baseline for three-way source
integration rather than inventing ancestry or replacing the gallery wholesale.

The shared Node26, dependency, compiler, npm-bootstrap, security-library and
artifact changes are integrated through template
`67573f4bee02f93c1b975cc039e894cc1a2cb868`. Its upstream includes antfu's
`bca9f861108bca09b6e0abc4260324dd574e170b`. The qualified Glob14.0.4 documentation
correction is included separately. Source integration does not establish
release qualification or host activation.

Preserve Kyapup's frontend, gallery and administrator APIs, private originals,
sanitized images, SQLite stores and secondary-administrator recovery controls.
Its independently locked production API includes Sharp and must retain both
Linux ARM64 libc variants with matching versions and integrity across locks.
The direct artifact contract identifies `kyapup`; its state remains outside
releases. The inherited Netlify build adapter does not provide durable-gallery
production storage.

Native importer tests use the `test-import-photos.mjs` name and Node's test
runner, matching the other script fixtures. Keep those cases, the browser's
synthetic gallery/admin scenarios and exact-artifact recovery checks when
reviewing future template changes. Publishing requires complete dependency
provenance and the existing independent ARM64 and protected-host gates.
