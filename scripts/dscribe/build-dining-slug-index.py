#!/usr/bin/env python3
"""Build compact WDW dining slug index from DScribe crawl (items.jsonl).

Indexes Building Blocks (-2) and Root/page (-4) folder chains for:
  EVO040 content pub 281 (no remap)
  EVO065 structure 283 → publish 934
  LGCY065 structure 627 → publish 914
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "dining-slug-index.json"

# Crawl source pubs → index slot key
PUB_SLOTS = {
    "281": "evo040",
    "283": "evo065",
    "627": "lgcy065",
}

# EVO045 content BB folders (472, 501, …) — item numbers remap to 281 / 934 publish explorers.
BB_PUB_TREES: dict[str, list[str]] = {
    "472": ["evo040", "evo065"],
    "501": ["evo040", "evo065"],
    "270": ["evo040", "evo065"],
    "525": ["evo040", "evo065"],
    "421": ["evo040", "evo065"],
}


def trees_for_bb_pub(pub: str) -> list[str]:
    if pub in PUB_SLOTS:
        return [PUB_SLOTS[pub]]
    return BB_PUB_TREES.get(pub, [])

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$", re.I)


def items_path() -> Path:
    data = os.environ.get("DSCRIBE_DATA", "").strip()
    if data:
        p = Path(data) / "dscribe" / "crawl" / "items.jsonl"
        if p.is_file():
            return p
    home = Path.home() / "Documents" / "disney-dining-content-ops-full" / "data"
    return home / "dscribe" / "crawl" / "items.jsonl"


def slug_from_title(title: str) -> str | None:
    t = (title or "").strip()
    if t and SLUG_RE.match(t):
        return t.lower()
    return None


def slug_from_page(rec: dict) -> str | None:
    s = slug_from_title(rec.get("title") or "")
    if s:
        return s
    webdav = rec.get("webdav") or ""
    m = re.search(r"/([^/]+)\.tpg$", webdav)
    if m and SLUG_RE.match(m.group(1)):
        return m.group(1).lower()
    path = rec.get("path") or ""
    parts = [p for p in path.split("\\") if p]
    if parts:
        last = parts[-1]
        if SLUG_RE.match(last):
            return last.lower()
    return None


def park_from_path(path: str, webdav: str = "", facility_slug: str | None = None) -> str:
    """Prod URL park segment (e.g. all-star-sports-resort), not CMS folder names like resort-dining."""
    slug = (facility_slug or "").strip().lower()
    wd = (webdav or "").lower()
    if slug and "/resort-dining/" in wd:
        m = re.search(r"/resort-dining/([^/]+)/" + re.escape(slug), wd)
        if m:
            return m.group(1).lower()

    parts = [p for p in (path or "").split("\\") if p]
    pl_parts = [p.lower() for p in parts]
    if "resort-dining" in pl_parts:
        ri = pl_parts.index("resort-dining")
        if ri + 1 < len(parts):
            resort = parts[ri + 1].lower()
            if slug and ri + 2 < len(parts) and parts[ri + 2].lower() == slug:
                return resort
            if slug and resort != slug:
                return resort

    last = parts[-1].lower() if parts else ""
    for i, p in enumerate(parts):
        pl = p.lower()
        if pl in ("dining", "things-to-do") and i + 1 < len(parts):
            candidate = parts[i + 1].lower()
            if candidate in ("resort-dining", "wdw", "root", "building blocks"):
                continue
            if candidate != last:
                return candidate
    return ""


def item_number(tcm_id: str, suffix: str) -> int | None:
    m = re.match(rf"tcm:\d+-(\d+)-{re.escape(suffix)}$", tcm_id)
    if m:
        return int(m.group(1))
    return None


def pub_from_id(tcm_id: str) -> str:
    if ":" not in (tcm_id or ""):
        return ""
    return tcm_id.split(":")[1].split("-")[0]


def path_mentions_dining(rec: dict) -> bool:
    path = (rec.get("path") or "").lower()
    webdav = (rec.get("webdav") or "").lower()
    return "dining" in path or "dining" in webdav


def walk_parent_chain(by_id: dict, start_parent: str | None) -> list[str]:
    """Walk parents upward; return root→leaf order (excludes publication root)."""
    chain: list[str] = []
    cur = start_parent
    seen: set[str] = set()
    while cur and cur not in seen:
        seen.add(cur)
        # Stop before publication / org roots (tcm:0-…) and BB/Root synthetic tops
        if str(cur).startswith("tcm:0-"):
            break
        body = str(cur).split(":")[1] if ":" in str(cur) else ""
        # Publication Root (…-3-4) / Building Blocks (…-1-2) — not part of facility chain
        if body.endswith("-3-4") or body.endswith("-1-2"):
            break
        chain.append(cur)
        parent_rec = by_id.get(cur)
        if not parent_rec:
            break
        p = parent_rec.get("parent")
        if not p or str(p).startswith("tcm:0-"):
            break
        # Also stop if next parent is BB/Root folder
        pbody = str(p).split(":")[1] if ":" in str(p) else ""
        if pbody.endswith("-3-4") or pbody.endswith("-1-2"):
            break
        cur = p
    chain.reverse()
    return chain


def display_name_from_slug(slug: str, title: str | None) -> str:
    if title and title != slug and not SLUG_RE.match(title or ""):
        return title
    if title and title != slug:
        return " ".join(w.capitalize() for w in slug.split("-"))
    return " ".join(w.capitalize() for w in slug.split("-"))


def empty_slot() -> dict:
    return {
        "pageTcm": None,
        "itemNumber": None,
        "pageTitle": None,
        "bbParentChain": [],
        "pageParentChain": [],
    }


def ensure_entry(index: dict, key: str, slug: str, park: str, title: str) -> dict:
    slot = index.setdefault(
        key,
        {
            "slug": slug,
            "parkSegment": park,
            "displayName": title,
            "evo040": None,
            "evo065": None,
            "lgcy065": None,
        },
    )
    if slot.get("displayName") == slug or len(title) > len(str(slot.get("displayName", ""))):
        slot["displayName"] = title
    return slot


def ensure_tree_slot(entry: dict, tree: str) -> dict:
    if entry.get(tree) is None:
        entry[tree] = empty_slot()
    return entry[tree]


def index_page(by_id: dict, index: dict, rec: dict, tree: str) -> None:
    if rec.get("type") not in ("Page", None) and not str(rec.get("id", "")).endswith("-64"):
        # Prefer typed Page; still accept -64 ids
        if not str(rec.get("id", "")).endswith("-64"):
            return
    rid = rec.get("id", "")
    if not rid.endswith("-64"):
        return
    if not path_mentions_dining(rec):
        return
    slug = slug_from_page(rec)
    if not slug:
        return
    park = park_from_path(rec.get("path") or "", rec.get("webdav") or "", slug)
    key = f"{park}/{slug}" if park else slug
    num = item_number(rid, "64")
    if not num:
        return
    # pageParentChain = folders from under Root down to page's parent (facility folder)
    chain = walk_parent_chain(by_id, rec.get("parent"))
    title = display_name_from_slug(slug, rec.get("title"))
    entry = ensure_entry(index, key, slug, park, title)
    tree_slot = ensure_tree_slot(entry, tree)
    if not tree_slot.get("pageParentChain"):
        tree_slot["pageParentChain"] = chain
        tree_slot["pageTcm"] = rid
        tree_slot["itemNumber"] = num
        tree_slot["pageTitle"] = rec.get("title")


def is_migration_bb_path(rec: dict) -> bool:
    path = (rec.get("path") or "").lower()
    return "contentmigration" in path or "things to do - wdw" in path


def index_bb_folder(by_id: dict, index: dict, rec: dict, tree: str) -> None:
    rid = rec.get("id", "")
    if not rid.endswith("-2"):
        return
    if is_migration_bb_path(rec):
        return
    # Skip publication Building Blocks root itself
    body = rid.split(":")[1] if ":" in rid else ""
    if body.endswith("-1-2"):
        return
    if not path_mentions_dining(rec):
        # Also accept slug-titled folders even if path omits dining
        slug = slug_from_title(rec.get("title") or "")
        if not slug:
            return
    else:
        slug = slug_from_title(rec.get("title") or "")
        if not slug:
            # try last path segment
            parts = [p for p in (rec.get("path") or "").split("\\") if p]
            if parts and SLUG_RE.match(parts[-1]):
                slug = parts[-1].lower()
            else:
                return
    park = park_from_path(rec.get("path") or "", rec.get("webdav") or "", slug)
    key = f"{park}/{slug}" if park else slug
    # Include this folder as the leaf of the BB chain
    ancestors = walk_parent_chain(by_id, rec.get("parent"))
    chain = ancestors + [rid]
    title = display_name_from_slug(slug, rec.get("title"))
    entry = ensure_entry(index, key, slug, park, title)
    tree_slot = ensure_tree_slot(entry, tree)
    if not tree_slot.get("bbParentChain"):
        tree_slot["bbParentChain"] = chain


def index_structure_facility(by_id: dict, index: dict, rec: dict, tree: str) -> None:
    """060/065 structure group (-4) named like the URL slug → page/root explorer chain."""
    rid = rec.get("id", "")
    if not rid.endswith("-4"):
        return
    if rec.get("type") not in ("StructureGroup", "Folder", None):
        return
    if not path_mentions_dining(rec):
        return
    slug = slug_from_title(rec.get("title") or "")
    if not slug:
        return
    park = park_from_path(rec.get("path") or "", rec.get("webdav") or "", slug)
    key = f"{park}/{slug}" if park else slug
    ancestors = walk_parent_chain(by_id, rec.get("parent"))
    chain = ancestors + [rid]
    title = display_name_from_slug(slug, rec.get("title"))
    entry = ensure_entry(index, key, slug, park, title)
    tree_slot = ensure_tree_slot(entry, tree)
    if not tree_slot.get("pageParentChain") or len(chain) > len(
        tree_slot.get("pageParentChain") or []
    ):
        tree_slot["pageParentChain"] = chain
        tree_slot["pageTitle"] = rec.get("title") or slug


def build_index(by_id: dict) -> dict:
    index: dict = {}

    for rec in by_id.values():
        rid = rec.get("id", "")
        pub = pub_from_id(rid)
        if rid.endswith("-64"):
            tree = PUB_SLOTS.get(pub)
            if tree:
                index_page(by_id, index, rec, tree)
        elif rid.endswith("-2"):
            for tree in trees_for_bb_pub(pub):
                index_bb_folder(by_id, index, rec, tree)
        elif rid.endswith("-4"):
            tree = PUB_SLOTS.get(pub)
            if tree:
                index_structure_facility(by_id, index, rec, tree)

    # For pages that have pageParentChain but empty bb — leave bb empty (UI falls back)
    return {"version": 2, "entries": index}


def load_by_id() -> dict:
    path = items_path()
    if not path.is_file():
        raise SystemExit(
            f"Crawl not found: {path}\n"
            "Set DSCRIBE_DATA to your data directory "
            "(e.g. …/disney-dining-content-ops-full/data), then re-run:\n"
            "  python3 scripts/dscribe/build-dining-slug-index.py"
        )
    by_id: dict = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                rid = rec.get("id")
                if rid:
                    by_id[rid] = rec
            except (json.JSONDecodeError, TypeError, AttributeError):
                continue
    return by_id


def main() -> None:
    import sys

    if len(sys.argv) >= 3 and sys.argv[1] == "--lookup":
        lookup_key = sys.argv[2].strip()
        by_id = load_by_id()
        data = build_index(by_id)
        def merge_slots(a: dict | None, b: dict | None, allow_longer: bool = True) -> dict | None:
            if not b:
                return a
            if not a:
                return b
            out = dict(a)
            bb_b = b.get("bbParentChain") or []
            bb_a = out.get("bbParentChain") or []
            if not bb_a and bb_b:
                out["bbParentChain"] = bb_b
            elif allow_longer and len(bb_b) > len(bb_a):
                out["bbParentChain"] = bb_b
            pg_b = b.get("pageParentChain") or []
            pg_a = out.get("pageParentChain") or []
            if not pg_a and pg_b:
                out["pageParentChain"] = pg_b
                out["pageTitle"] = b.get("pageTitle") or out.get("pageTitle")
            elif allow_longer and len(pg_b) > len(pg_a):
                out["pageParentChain"] = pg_b
                out["pageTitle"] = b.get("pageTitle") or out.get("pageTitle")
            return out

        def merge_entries(a: dict | None, b: dict | None, allow_longer: bool = True) -> dict | None:
            if not b:
                return a
            if not a:
                return dict(b)
            out = dict(a)
            out["displayName"] = b.get("displayName") or out.get("displayName")
            for tree in ("evo040", "evo065", "lgcy065"):
                out[tree] = merge_slots(out.get(tree), b.get(tree), allow_longer)
            return out

        entries = data["entries"]
        url_park = lookup_key.split("/")[0] if "/" in lookup_key else ""
        slug_tail = lookup_key.split("/")[-1] if "/" in lookup_key else lookup_key
        entry = entries.get(lookup_key)
        if entry:
            entry = dict(entry)
        for k, v in entries.items():
            if k == lookup_key:
                continue
            if v.get("slug") != slug_tail and not k.endswith("/" + slug_tail) and k != slug_tail:
                continue
            key_park = v.get("parkSegment") or (k.split("/")[0] if "/" in k else "")
            same_park = bool(url_park and key_park == url_park)
            if not entry:
                if not url_park or same_park:
                    entry = merge_entries(entry, v)
                continue
            entry = merge_entries(entry, v, allow_longer=same_park)
        print(json.dumps(entry or {}))
        return

    by_id = load_by_id()
    data = build_index(by_id)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Wrote {len(data['entries'])} entries to {OUT}")


if __name__ == "__main__":
    main()
