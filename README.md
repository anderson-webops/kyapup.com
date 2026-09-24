# Kya

A photo-first home for Kya. The public page is a large, responsive photo wall with an oversized featured photograph, subtle hover motion, and a keyboard-accessible full-screen viewer. The discreet `/admin` page lets the owner upload photos, keep an archive, choose the public selection, mark favorites, and either pin a favorite or rotate favorites on a timer.

The site is based on the existing [anderson-webops/vitesse-nuxt-template](https://github.com/anderson-webops/vitesse-nuxt-template) at `0e893bd` (`v2.1.2`), derived from [antfu/vitesse-nuxt](https://github.com/antfu/vitesse-nuxt). No additional template fork is required. This application lives in [anderson-webops/kyapup.com](https://github.com/anderson-webops/kyapup.com).

## Using the gallery

Open `/admin` and sign in. Tap **Add photos**, choose your pictures, then tap **Show selected**. Tap a star to make a photo a favorite; favorites appear largest. Choose **One favorite** or **Rotate favorites** at the top. **Save for later** hides a photo without deleting it. Changes save automatically.

## Local development

Use Node.js **24.18.1** and npm **12.0.2**. All dependency operations start at the repository root.

```sh
npm ci
cp .env.example back-end/.env
# Set ADMIN_PASSWORD_HASH in back-end/.env using the helper below.
# Run these in two separate terminals:
npm run server
npm run dev
```

The frontend is at `http://localhost:3333` and proxies same-origin `/api` requests to the independent API at `127.0.0.1:3006`. Set the local password hash in `back-end/.env` using the [password helper instructions](deploy/README.md#first-administrator-setup). The default local library is the ignored `back-end/data/` directory; production state lives outside the checkout. Production requires explicit configuration and does not ship with a default password.

```sh
npm run validate
npm run a11y
npm run test:direct-runtime
```

Validation includes locked native image dependencies, lint, types, backend tests, artifact-verifier regressions, production builds, and deployment-output checks. A direct runtime smoke test exercises the compiled API with a temporary synthetic photo library. The exact Linux ARM64 archive has a separate isolated acceptance gate.

## Photo library

- New uploads start in the private archive. Select photos to show them publicly and mark favorites to give them prominence.
- Featured photos can rotate or remain fixed. The remaining public photos form the photo wall.
- Uploads, metadata, and the selected presentation persist on the server under `PHOTO_DATA_DIR`, separate from code and releases.
- Original uploads are private. Display images are resized WebP derivatives with metadata removed. Archived images require administrator authentication even when their IDs are known.
- Upload still JPG, PNG, WebP, or AVIF photos up to 25 MiB and 60 megapixels, with neither edge over 20,000 pixels. HEIC photos must be exported to a supported format first. The admin interface reports unsupported images and failed uploads without publishing them.
- Nothing uploaded through the admin portal is committed to this public repository.

## Future imports from Apple Photos

A dedicated bearer-authenticated API can import an explicit selection from Kya’s People & Pets grouping after deployment. Stable library/asset IDs prevent duplicates, imports start in Saved for later, and repeat runs preserve manual choices. The server only stores a hash of the optional import credential. See [the import guide](docs/import-api.md) for the API, tested manifest client, and the local pet-index checks still needed before accessing Photos. No actual Photos library has been accessed or imported during development.

## Production

Use the direct Nginx/systemd deployment in [deploy/README.md](deploy/README.md). It serves a static Nuxt frontend and one Express API with Node's built-in SQLite database and Sharp image processing. The service stores its library under `/var/lib/kyapup`, reads protected configuration from `/etc/kyapup/api.env`, and listens only on loopback.

`kyapup.com` and `kyagirl.com` can serve the same site from the same release and library. Configure both hostnames in the existing TLS server and in `ALLOWED_ORIGINS`. There is no domain banner or redirect requirement. DNS, certificates, and production activation remain operator work.

The inherited Netlify adapter is retained as template source, but ephemeral function storage cannot host this persistent photo library. Do not deploy this application through that adapter without a separate durable-storage design.

See [the runtime artifact contract](docs/runtime-artifact-contract.md) for independent archive verification, and [the security model](docs/security-model.md) for the administrator and storage boundaries.
