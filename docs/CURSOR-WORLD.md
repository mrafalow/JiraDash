# Cursor world (Marcin)

Short map for which folder to open and how to end chats without losing context.

## Workspaces

| Open this folder | For |
|------------------|-----|
| `~/Documents/Cursor/JiraDash` (or `~/cursor-work/jira-dashboard/JiraDash`) | **Jira dashboard / Studio Titan** — Jira tables, Validate, Studioshare deploy |
| `~/cursor-work/system-debugging/` | **Disney systems** — D-Scribe, dining content, Watcher, tokens on VPN |
| `~/cursor-work/ai-experimentation/` | **Experiments** — agent mode tests, prompts, local vs cloud |
| `~/cursor-work/_archive/` | **Parked** — unclear items; nothing deleted |

**Rule:** Pick the folder **before** starting a new chat so history stays on-topic.

## Skills (global)

Live in `~/.cursor/skills/` (symlinks to skill packages elsewhere). Not stored in the JiraDash repo.

- Dining / D-Scribe / publishing / knowledge retrieval — content-ops skills  
- `studioshare-launch-site` — deploy static sites on Studioshare Launch  

Cursor-built skills live in `~/.cursor/skills-cursor/`.

## Projects

Use Cursor **File → Open Folder** on the paths above. There is no separate “Project” object to configure beyond the workspace root you open.

## Local vs cloud agent

| Use **local** | Use **cloud** |
|---------------|-----------------|
| Disney VPN, D-Scribe cookie, internal GitLab, localhost `npm start` | GitHub-only edits, no VPN, quick docs |

## End-of-chat checklist (for the assistant)

When wrapping up a session, report in plain language:

1. **What we did** — one short paragraph  
2. **Dashboard repo** — path unchanged; GitHub/GitLab remotes untouched unless we intentionally changed them  
3. **Your next step** — e.g. restart server, hard refresh, or confirm a move list  
4. **Open questions** — anything waiting on you  
5. **Where to continue** — which folder to open for the follow-up chat  

Keep updates **short**; this file and `DECISIONS.md` may be re-sent as context.

## Chats

Past conversations stay tied to the workspace they were started in. They are **not** moved when folders are reorganized. New topics → new folder first, then new chat.
