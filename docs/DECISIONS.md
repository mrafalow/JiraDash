# Decision log (JiraDash / Studio Titan)

One line (or short paragraph) per meaningful change. Newest first.

- **2026-10-13:** Recently Closed translations review — after Prod Val closes, Needed/Not needed stored in browser; MS-owned parents show Nudge MS until Translations subtask opens (then pending); open subtask overrides Not needed.
- **2026-10-13:** TEAMS **Translations** lane lists `needsTranslationAction` on recently closed parents (decide Needed/Not needed, pending, nudge MS). Recently Closed table keeps the Translations column for context; no separate All/Translations-action toggle.
- **2026-10-13:** On the Horizon — calendar includes **published** (recently closed) due dates as neutral “done” days; default list excludes published; clicking a day shows all launches that day including published.
- **2026-10-13:** Validate — merge all index rows per slug (472 BB + 283 page chains); label EVO040 BB as **EVO045 (472)** when native; accept `/entertainment/` + locale prefixes; `data/dining-slug-aliases.json` for URL slug → CMS slug.
- **2026-10-08:** Cursor workspace reorg playbook adopted (`CURSOR-WORLD.md`, `~/cursor-work/` layout). Debug/dining skills stay global in `~/.cursor/skills/`; JiraDash repo path unchanged; chat separation = open the right folder before new chats.
- **2026-10-07:** Validate LGCY065 for dining uses pub **627** supplements (`dining-lgcy-slots-by-slug.json`), not EVO065 chain copy — CMS folder IDs differ (e.g. Sanaa Lounge / item 1019514).
- **2026-10-07:** EVO065/040 chain pick prefers **472** BB over **501** migration trees; optional per-slug chain supplements when crawl index stops short of facility folder.
