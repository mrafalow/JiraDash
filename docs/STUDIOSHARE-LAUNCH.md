# Deploy Studio Titan (JiraDash) on Studioshare Launch

Launch builds from **GitLab** (`gitlab.disney.com`), not GitHub. Your GitHub repo stays as-is; add a **gitlab** remote and push when you want the hosted site to update.

## What was added in this repo

| File | Purpose |
|------|---------|
| `Dockerfile` | Runs `node server.js` on port **8080** |
| `.launch/compose.yaml` | Maps Launch port **80 → 8080** (required) |
| `.dockerignore` | Keeps secrets and heavy report PDFs out of the image |

## One-time setup (you — browser + terminal)

### 1. GitLab repo

1. Open [gitlab.disney.com](https://gitlab.disney.com) (Disney SSO).
2. **New project → Create blank project** — name e.g. `jira-dash`, **Private**, **do not** initialize with README.
3. Copy the HTTPS clone URL: `https://gitlab.disney.com/<namespace>/jira-dash.git`

### 2. Push this project to GitLab

In **your** terminal (from this repo folder):

```bash
git remote add gitlab https://gitlab.disney.com/<namespace>/jira-dash.git
git push -u gitlab HEAD:main
```

Use a GitLab **Personal Access Token** as the password when prompted (`read_repository` + `write_repository`).

### 3. Let Launch read the private repo

**Project → Manage → Members → Invite** user **`f-pta-gitlab-svc`** with role **Reporter**.

### 4. Create the Launch app

1. [developer.studioshare.wds.io](https://developer.studioshare.wds.io) → **Create application**.
2. Connect it to the GitLab repo and branch **`main`**.

### 5. GitLab webhook (Launch does not add this automatically)

Repo → **Settings → Webhooks**:

- URL: `https://api.studioshare.wds.io/launch/webhooks/gitlab`
- Trigger: **Push events**
- SSL verification: on  
- Save → **Test → Push events** (expect HTTP 200)

### 6. Jira credentials on Launch

The container does **not** include `.env`. In the Launch app **Settings → Environment variables** (or equivalent secrets UI), set at least:

```env
JIRA_BASE_URL=https://disneyexperiences.atlassian.net/
JIRA_EMAIL=you@disney.com
JIRA_API_TOKEN=…
JIRA_CLOUD_ID=…
```

Optional: `JIRA_CONTENT_JQL`, `DSCRIBE_DATA` (not typical in Launch), `PORT` (leave **8080**).

**Redeploy** after changing env vars.

### 7. Access model

For an internal prototype: **Security → Authentication off**, **Public facing off** (Disney network only). Add coworkers under **Permissions** if you use MyID gating.

## Day-to-day updates

```bash
git add .
git commit -m "…"
git push origin          # GitHub (your usual)
git push gitlab main     # Studioshare redeploy (after webhook)
```

Or configure `git push` to update both remotes once.

## Verify

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://<your-app-domain>/api/health
```

Expect **200** on Disney network. Open `/` for the dashboard.

## Local Docker smoke test

```bash
docker build -t jira-dash .
docker run --rm -p 8080:8080 --env-file .env jira-dash
```

Open http://localhost:8080/
