# JiraDash — Studio Titan

Local Jira dashboard that ranks your WDW In Focus work by attention score.

## Quick start

1. Copy credentials into a repo-root `.env` (gitignored):

```env
JIRA_BASE_URL=https://disneyexperiences.atlassian.net/
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-atlassian-api-token
JIRA_CLOUD_ID=70826d2c-16d0-4cfa-b445-cc7c9d3bce39
```

Paste or rotate the token on the `JIRA_API_TOKEN=` line. For Disney, set **`JIRA_CLOUD_ID`** (same as home) so scoped tokens use the Platform gateway — without it, the site hostname often returns a false **404** for project WDW. If unset, the server tries to discover cloudId from `/_edge/tenant_info` and still prefers the gateway. If that returns 401 on some corporate networks, it automatically retries via **`JIRA_BASE_URL`**.

Optional: **`JIRA_USE_SITE_API=1`** skips the gateway entirely.

2. Install and run:

```bash
npm install
npm start
```

3. Open [http://127.0.0.1:3847/](http://127.0.0.1:3847/)

## Validate view (ticket work)

Sidebar **Validate**: paste a WDW prod dining URL (`disneyworld.disney.go.com/dining/…`) to get:

- Display name, prod / stage / stage `en_CA` links
- **EVO065** and **LGCY065** D-Scribe explorer links (Root + Building Blocks), plus page editor/folder when the slug is in the index

Optional env for a full slug index (recommended on your Mac):

```env
DSCRIBE_DATA=/path/to/disney-dining-content-ops-full/data
```

Rebuild the index from the DScribe crawl:

```bash
python3 scripts/dscribe/build-dining-slug-index.py
```

Writes [`data/dining-slug-index.json`](data/dining-slug-index.json). The repo includes a small seed index for offline use; replace it after rebuilding locally.

API (same logic as the UI): `GET /api/dining/resolve?url=…`

If the server was started before Validate landed, the UI falls back to the browser: `data/dining-slug-index.json` + `scripts/dscribe/dscribe-links.js` (same EVO/LGCY publish pub IDs as the WDW-194122 inventory). Restart `npm start` and confirm the console line `Validate: /api/dining/resolve ready`.

| Publication | Publish pub | Structure crawl pub | Root folder | Building Blocks |
|-------------|-------------|---------------------|-------------|-----------------|
| EVO065 WDW Parent (All) Publish | 934 | 283 | `tcm:934-3-4` | `tcm:934-1-2` |
| LGCY065 Parent (All) Publish | 914 | 627 | `tcm:914-3-4` | `tcm:914-1-2` |

## First Jira test

```bash
npm run test:jira
```

Expect `OK: authenticated as …`. If it fails with 401/403, update `JIRA_API_TOKEN` in `.env`.

## Files

| File | Role |
|------|------|
| `studio-titan.html` | Structure |
| `styles.css` | Look and feel |
| `jira.js` | Jira fetch via local proxy |
| `prioritize.js` | Ranking / next-action logic |
| `app.js` | UI wiring |
| `server.js` | Static files + Jira proxy + `/api/dining/resolve` |
| `validate.js` | Validate view UI |
| `scripts/dscribe/` | D-Scribe link builders, dining resolve, index builder |
| `data/dining-slug-index.json` | Slug → EVO/LGCY page metadata (rebuild from crawl) |
