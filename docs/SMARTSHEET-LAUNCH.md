# Smartsheet live runbook (Studio Titan Launches)

The **Live runbook** tab loads the same sheet linked from **Open runbook**, via Smartsheet REST API (server-side token — never sent to the browser).

## JiraDash (local dashboard)

1. In Smartsheet: **Account → Apps & Integrations → API Access** → **Generate new access token**.
2. Add to repo-root `.env` (gitignored):

```env
SMARTSHEET_ACCESS_TOKEN=your-personal-access-token
```

3. Restart the server: `npm start`.
4. **Launches** → expand a launch → **Live runbook**. Rows with **Status = Not Applicable** are hidden by default (toggle to show).

Sheet id is taken from `runbookUrl` or `smartsheetSheetId` in `data/launch-runbooks.json`. Responses are cached ~90s (`SMARTSHEET_CACHE_TTL_MS` optional).

API route: `GET /api/launch/runbook-live?epic=WDW-191147&refresh=1&includeNotApplicable=0`

## Cursor Smartsheet MCP (agent / chat)

For the **Smartsheet plugin** in Cursor (so the agent can read sheets in chat):

1. **Cursor Settings → MCP** → find **Smartsheet**.
2. If status is error, use **Authenticate** / reconnect (OAuth or token per plugin docs).
3. Until MCP shows healthy, JiraDash still works with `SMARTSHEET_ACCESS_TOKEN` in `.env` only.

The MCP and JiraDash use **separate** credentials today: MCP for Cursor chat, `.env` token for the local server live view.

## Offline / PDF export

If API is unavailable, export the sheet to PDF or CSV from Smartsheet. Milestone dates: `node scripts/sync-launch-runbook-dates.js`. Full task list + N/A: `node scripts/import-launch-runbook-tasks.js`.
