# LotSocial

LotSocial turns one dealership vehicle-detail-page URL into a source-grounded social caption, vertical-video storyboard, and durable associate inventory record.

## Pilot boundary

- One input: the exact public VDP URL.
- Scrape-or-fail: there is no manual vehicle-fact fallback.
- Closed access: the Worker pins the Sites hostname and an associate allowlist.
- Source-grounded output: copy uses captured facts and retains source/import timestamps.
- Human approval: every vehicle detail and creative must be reviewed before publishing.
- Cost control: per-associate import caps plus per-associate and global Bright Data caps.
- Rights control: dealership-grantable permissions and provider-controlled rights are enforced separately.

Customer testing is not public launch. Deployment, allowlist changes, paid-provider credentials, customer invitations, and production sends remain controlled operations.

## Local development

Requirements: Node.js `>=22.13.0` and pnpm `11.24.0`.

```bash
pnpm install --frozen-lockfile
npm run dev
npm test
```

`npm test` runs the production build, all behavior tests (including real Worker/Miniflare paths), bootstrap-schema parity, Drizzle migration drift, and lint.

## Required pilot configuration

Copy `.env.example` into the deployment environment and configure:

- `LOTSOCIAL_EXPECTED_SITES_HOSTNAME`
- `LOTSOCIAL_ASSOCIATE_ALLOWLIST`
- `LOTSOCIAL_DAILY_VDP_IMPORT_CAP`
- `LOTSOCIAL_DAILY_AUTHORIZATION_REQUEST_CAP`
- `LOTSOCIAL_DAILY_MANAGER_EMAIL_CAP`
- `LOTSOCIAL_DAILY_BRIGHTDATA_ASSOCIATE_CAP`
- `LOTSOCIAL_DAILY_BRIGHTDATA_GLOBAL_CAP`
- `LOTSOCIAL_MANAGEMENT_LINK_TTL_HOURS`
- `ENFORCEMENT_API_KEY`

Optional integrations stay disabled when their credentials are absent:

- `BRIGHTDATA_API_KEY` and `BRIGHTDATA_ZONE`
- `SHOTSTACK_API_KEY` and `SHOTSTACK_STAGE`
- `RESEND_API_KEY` and `EMAIL_FROM`

Full-page VDP screenshot evidence additionally requires a Cloudflare Browser Run binding named `BROWSER`. The host must use compatibility date `2026-03-24` or later. Without that binding, imports still retain the exact source payload and SHA-256 hash and truthfully record the screenshot status as `unavailable`.

## Operations

- `GET /api/ops/import-health` with `Authorization: Bearer <ENFORCEMENT_API_KEY>` returns seven-day success and paid-fallback usage by dealer host.
- `GET /api/ops/evidence?vehicleId=<id>` is restricted to managers/admins (or the internal enforcement key) and returns append-only import evidence with 15-minute signed artifact links. Add `&format=csv` for a spreadsheet-ready export.
- Authorization management links expire and rotate; issuing a fresh link invalidates every older management link.
- Drizzle migrations are canonical. Runtime bootstrap is retained for Sites-provisioned D1 and is checked byte-for-byte against migrations.

## Deployment gate

Before a closed pilot deployment:

1. Confirm the exact Sites hostname and tester allowlist.
2. Set conservative daily import and paid-fallback caps.
3. Verify the live D1 schema or use a fresh pilot database built from current migrations.
4. Run `npm test` from the release commit.
5. Exercise allowlisted, non-allowlisted, and non-Sites-host identity probes.
6. Import representative VDPs and confirm `/api/ops/import-health` records the outcomes.
7. Complete one caption and one render/download path before inviting testers.

Do not call a branch, package, or green build deployed until the Sites deployment and live probes have been read back.
