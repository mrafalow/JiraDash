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

### Cursor plugin troubleshooting

| Symptom | What to do |
|--------|------------|
| **Local: HTTP 401** / `errorCode` **1002** / *Your Access Token is invalid* | In [Smartsheet](https://app.smartsheet.com): **Account → Apps & Integrations → API Access** → generate a **new** Personal Access Token. In Cursor: **Settings → MCP → Configure smartsheet** → **Logout** (Local), paste or reconnect with the new token, then **Reload**. |
| **Cloud: Finish plugin setup** | Open **Configure smartsheet**, complete **Cloud** setup (Retry / sign-in per plugin). Local and Cloud auth are independent; fix Local first if you only need chat on this machine. |
| Plugin **ON** but tools still missing | Toggle plugin off/on, **Reload**, restart Cursor. Check **Show Output** for the smartsheet MCP log. |
| Agent **Authenticate** times out | Complete the browser OAuth or token prompt Cursor opens; if nothing appears, use **Configure smartsheet** manually instead of in-chat auth. |

**JiraDash Live runbook** does not use the Cursor plugin. It only reads **`SMARTSHEET_ACCESS_TOKEN`** from repo-root `.env` (gitignored). Add the same new PAT there and restart `npm start` if you want the **Launches → Live runbook** tab to work in the browser.

## Without API token

You cannot load Smartsheet rows on the server with the sheet URL alone (REST requires a Bearer token).

**In the dashboard:** expand a launch → **Smartsheet** tab. This embeds `runbookUrl` from `data/launch-runbooks.json` in an iframe. It works when you are logged into Smartsheet in the same browser. If the frame is blank (embed blocked), use **Open runbook**.

**Offline:** export CSV/PDF from Smartsheet and run `node scripts/sync-launch-runbook-dates.js` or `node scripts/import-launch-runbook-tasks.js`.

Optional: if your org enables **Publish to web**, you can add `publishedRunbookUrl` in runbook config for a read-only embed (policy-dependent).

## Offline / PDF export

If API is unavailable, export the sheet to PDF or CSV from Smartsheet. Milestone dates: `node scripts/sync-launch-runbook-dates.js`. Full task list + N/A: `node scripts/import-launch-runbook-tasks.js`.
