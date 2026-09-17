# JiraDash — Studio Titan

Local Jira dashboard that ranks your WDW solo work by attention score.

## Quick start

1. Copy credentials into a repo-root `.env` (gitignored):

```env
JIRA_BASE_URL=https://disneyexperiences.atlassian.net/
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-atlassian-api-token
JIRA_CLOUD_ID=70826d2c-16d0-4cfa-b445-cc7c9d3bce39
```

Paste or rotate the token on the `JIRA_API_TOKEN=` line. For Disney, also set **`JIRA_CLOUD_ID`** (same as home). The proxy tries the Platform gateway first; if that returns 401 (some corporate networks), it automatically retries via **`JIRA_BASE_URL`**.

Optional: **`JIRA_USE_SITE_API=1`** skips the gateway entirely.

2. Install and run:

```bash
npm install
npm start
```

3. Open [http://127.0.0.1:3847/](http://127.0.0.1:3847/)

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
| `server.js` | Static files + Basic Auth Jira proxy |
