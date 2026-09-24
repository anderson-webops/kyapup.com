# Importing Kya from Apple Photos

The server provides a dedicated authenticated import API. A local Mac workflow selects Kya from Photos' existing People & Pets index, exports those photos, then uploads an explicit manifest. The server does not open, scan, or receive the Photos library itself. No Photos access or real import credential is needed to build or test the site.

New imports enter **Saved for later**. Repeating an import leaves each existing photo, its original upload, visibility, favorite status, description, and spotlight selection unchanged. The import credential can check known import IDs and add photos; it cannot browse the private archive, retrieve private images, publish, hide, delete, or alter administrator settings.

## One-time server setup

After deployment, deliberately run this helper in an unprivileged trusted checkout:

```sh
node back-end/scripts/create-import-token.mjs
```

It prints a random `token` and its `sha256` digest. Keep the **token** in the importing Mac's Keychain or another secure credential store. Put only the **sha256** value in the server's root-owned, mode 0600 `/etc/kyapup/api.env`:

```ini
PHOTO_IMPORT_TOKEN_SHA256=<64-character-sha256-value>
```

Restart the API after changing this setting. An absent value disables the import API, with no effect on the normal password-protected admin. Rotate by generating a new pair and replacing the hash; removing the hash revokes import access. Do not commit either value or paste the token into shell history, issue comments, manifests, or logs. The helper's output is sensitive and should not be captured in shared terminal logs.

## Selecting the right photos on the Mac

This source-selection step must be verified against the actual Mac and library when an import is requested. It has **not** been run as part of site development.

1. Identify the exact Photos library and confirm that Kya is named and indexed under People & Pets. Use an explicitly selected library, not whichever one a tool happens to open by default. Photos on macOS Sonoma or later supports pet recognition; indexing and names are local facts to verify. [Apple guidance](https://support.apple.com/en-us/105081), [People & Pets](https://support.apple.com/guide/photos/find-and-name-people-and-pets-phtad9d981ab/mac).
2. Use the existing pet index. The read-only database tooling in **osxphotos 0.77.1** introduces `PhotoInfo.search_info.pets`, which supplies indexed pet-name strings. Feature-detect this field and look for exact `Kya` membership, then review the candidate thumbnails locally. Do not treat a general text search or `--person Kya` alone as a complete pet selection. The tool's pet-face identity work is still open, so duplicate or ambiguous names require resolving the correct group locally. [Versioned release](https://github.com/RhetTbull/osxphotos/releases/tag/v0.77.1), [pet-field source](https://github.com/RhetTbull/osxphotos/blob/v0.77.1/osxphotos/searchinfo.py), [pet-face issue](https://github.com/RhetTbull/osxphotos/issues/1238).
3. Save a local allowlist of the selected `PhotoInfo.uuid` values. These asset IDs, together with a stable library namespace, drive deduplication. Never use filenames, captions, face labels, or a filesystem path as the asset identity. Keep the namespace unchanged across future runs; a replacement library or asset migration requires reconciliation. [Identifier documentation](https://rhettbull.github.io/osxphotos/API_README.html#uuid).
4. Export only those allowlisted still photos to a private staging directory outside this public repository. Prefer the edited photo when one exists, otherwise the original; exclude hidden photos, Live Photo video companions, RAW companions, and unrelated burst frames. Export HEIC as JPEG. Use the tool's dry-run first and inspect the selected/exported counts. Keep cloud-only items pending until any needed iCloud download is explicitly in scope. Query/export must not rename faces, change albums, or write to the Photos database. [Export options](https://rhettbull.github.io/osxphotos/cli#export).
5. Strip unnecessary metadata from the upload copies and verify those copies locally. JPEG conversion alone does not establish that GPS, other people's names, or other metadata was removed. Do not upload the Photos database, sidecars, export reports, or the exporter database. Original Apple Photos assets remain unchanged. The website also strips metadata when creating its public WebP derivatives.

No automatic Photos-library adapter is enabled by this repository. Its tested importer consumes only the explicitly prepared manifest described below. This avoids claiming pet-index completeness, identity resolution, or Mac permissions that have not yet been verified.

## Manifest and import client

Prepare `manifest.json` next to the exported photos:

```json
{
  "version": 1,
  "libraryId": "photos-main",
  "photos": [
    {
      "uuid": "11111111-2222-3333-4444-555555555555",
      "file": "11111111-2222-3333-4444-555555555555.jpg"
    }
  ]
}
```

`libraryId` is a stable local namespace of 1–48 lowercase letters, digits, hyphens, or underscores. It must start with a letter or digit. Each `uuid` is the Photos asset UUID; the client normalizes UUID case. Files can be relative to the manifest. Keep this manifest private and outside the repository. It contains only selected photo IDs and paths, not a full library inventory.

Validate locally first. This command does not connect to the site or upload anything:

```sh
node scripts/import-photos.mjs /private/staging/manifest.json
```

For an actual authorized import, inject `KYA_IMPORT_TOKEN` from the credential store into the process environment and set `KYA_SITE_URL` to `https://kyapup.com` or `https://kyagirl.com`, then run:

```sh
node scripts/import-photos.mjs /private/staging/manifest.json --apply
```

The client checks each source ID before uploading, sends photos one at a time, pauses and retries the same request up to three times when rate-limited, stops at other failures, and prints counts without tokens or source IDs. Rerunning is safe after interruptions, including a lost upload response. It validates supported image headers and the 25 MiB limit before upload, uses bounded request timeouts, refuses cross-host redirects, and accepts production credentials only at the two named HTTPS sites. Loopback HTTP is allowed for local synthetic tests.

If a previously imported Apple Photos asset is edited later, its stable ID still resolves to the existing site photo. This API deliberately does not replace that image or its curation. A replacement workflow would be a separate explicit change. The API also does not deduplicate an earlier manual admin upload against a later library import, or detect visually identical photos with different source IDs.

## API contract

Every request uses `Authorization: Bearer <token>`. The bearer API does not use browser cookies or CSRF tokens. Browser admin endpoints keep their separate session, Origin, and CSRF protections.

| Method and route | Input | Success |
| --- | --- | --- |
| `GET /api/import/status` | Query `source=apple-photos` and `externalId=photos-main/<asset-uuid>` | `200 {"exists":false}` or `200 {"exists":true,"photo":{...}}` |
| `POST /api/import/photos` | Same query; raw image bytes with `Content-Type: application/octet-stream` | `201 {"created":true,"photo":{...}}` or `200 {"created":false,"photo":{...}}` |

The source must be `apple-photos`. External IDs are 1–200 ASCII letters, digits, dots, underscores, hyphens, or slashes. The first character must be a letter or digit. IDs never become filesystem paths. Store the namespace and UUID together to avoid collisions between distinct libraries. No pet name or face metadata needs to be transmitted.

Uploads accept still JPEG, PNG, WebP, or AVIF up to 25 MiB, 60 MP, and 20,000 pixels per edge. New photos have `visible:false` and `featured:false`. The server keeps the received original privately and generates metadata-stripped display copies. The private import mapping and original checksum are stored atomically with the photo and backed up with the rest of `PHOTO_DATA_DIR`; simultaneous requests for one identity converge on one photo. Mapping fields are excluded from the public gallery response.

Errors use `{"error":"code"}`. Common cases: `401 import_authentication_required`, `503 import_not_configured`, `400 invalid_import_identity`, `413 request_too_large`, `415 unsupported_photo_type`, `400 unsupported_photo_dimensions`, and `429 too_many_requests`. All API responses are non-cacheable. Existing browser endpoints at `/api/admin/*` are documented by their source and tested separately; the import token does not authorize them.
