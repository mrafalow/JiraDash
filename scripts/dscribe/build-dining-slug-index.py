#!/usr/bin/env python3
"""Build compact WDW dining slug index from DScribe crawl (items.jsonl)."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "dining-slug-index.json"

EVO_PAGE_PUB = "283"
LGCY_PAGE_PUB = "627"


def items_path() -> Path:
    data = os.environ.get("DSCRIBE_DATA", "").strip()
    if data:
        p = Path(data) / "dscribe" / "crawl" / "items.jsonl"
        if p.is_file():
            return p
    home = Path.home() / "Documents" / "disney-dining-content-ops-full" / "data"
    return home / "dscribe" / "crawl" / "items.jsonl"


def slug_from_page(rec: dict) -> str | None:
    title = (rec.get("title") or "").strip()
    if title and re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", title):
        return title
    webdav = rec.get("webdav") or ""
    m = re.search(r"/([^/]+)\.tpg$", webdav)
    if m:
        return m.group(1).lower()
    path = rec.get("path") or ""
    parts = [p for p in path.split("\\") if p]
    if parts:
        last = parts[-1]
        if re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", last, re.I):
            return last.lower()
    return None


def park_from_path(path: str) -> str:
    parts = [p for p in (path or "").split("\\") if p]
    slug = parts[-1].lower() if parts else ""
    for i, p in enumerate(parts):
        pl = p.lower()
        if pl in ("dining", "things-to-do") and i + 1 < len(parts):
            candidate = parts[i + 1].lower()
            if candidate != slug:
                return candidate
    return ""


def item_number(tcm_id: str) -> int | None:
    m = re.match(r"tcm:\d+-(\d+)-64$", tcm_id)
    if m:
        return int(m.group(1))
    return None


def build_index(by_id: dict) -> dict:
    index: dict = {}

    def add_entry(rec: dict, tree: str, pub_prefix: str):
        if rec.get("type") != "Page":
            return
        pub = rec.get("id", "").split("-")[0].split(":")[1] if ":" in rec.get("id", "") else ""
        if pub != pub_prefix:
            return
        path = rec.get("path") or ""
        if "dining" not in path.lower() and "dining" not in (rec.get("webdav") or "").lower():
            return
        slug = slug_from_page(rec)
        if not slug:
            return
        park = park_from_path(path)
        key = f"{park}/{slug}" if park else slug
        num = item_number(rec.get("id", ""))
        if not num:
            return
        parent = rec.get("parent")
        chain: list[str] = []
        cur = parent
        seen: set[str] = set()
        while cur and cur not in seen:
            seen.add(cur)
            chain.append(cur)
            parent_rec = by_id.get(cur)
            if not parent_rec:
                break
            p = parent_rec.get("parent")
            if not p or str(p).startswith("tcm:0-"):
                break
            cur = p
        chain.reverse()
        title = rec.get("title") or slug
        if title == slug:
            title = " ".join(w.capitalize() for w in slug.split("-"))

        slot = index.setdefault(
            key,
            {"slug": slug, "parkSegment": park, "displayName": title, "evo": None, "lgcy": None},
        )
        if slot.get("displayName") == slug or len(title) > len(str(slot.get("displayName", ""))):
            slot["displayName"] = title
        entry = {
            "pageTcm": rec["id"],
            "itemNumber": num,
            "pageTitle": rec.get("title"),
            "parentChain": chain,
        }
        if tree == "evo":
            if slot["evo"] is None:
                slot["evo"] = entry
        else:
            if slot["lgcy"] is None:
                slot["lgcy"] = entry

    for rec in by_id.values():
        rid = rec.get("id", "")
        if rid.startswith(f"tcm:{EVO_PAGE_PUB}-") and rid.endswith("-64"):
            add_entry(rec, "evo", EVO_PAGE_PUB)
        elif rid.startswith(f"tcm:{LGCY_PAGE_PUB}-") and rid.endswith("-64"):
            add_entry(rec, "lgcy", LGCY_PAGE_PUB)

    return {"version": 1, "entries": index}


def main() -> None:
    path = items_path()
    if not path.is_file():
        raise SystemExit(f"Crawl not found: {path}\nSet DSCRIBE_DATA to your data directory.")
    by_id: dict = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            try:
                by_id[json.loads(line)["id"]] = json.loads(line)
            except (json.JSONDecodeError, KeyError):
                continue
    data = build_index(by_id)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Wrote {len(data['entries'])} entries to {OUT}")


if __name__ == "__main__":
    main()
