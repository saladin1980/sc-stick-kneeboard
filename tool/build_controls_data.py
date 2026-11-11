"""Build the Star Citizen controls data for the site (Stage B), from the game's Data.p4k.

Reads, READ-ONLY, from the live install:
    Data/Libs/Config/defaultProfile.xml        (CryXmlB: every actionmap, action, label key, default bind)
    Data/Localization/<lang>/global.ini        (the label strings)
and writes ONE file:
    site/data/sc-controls-<game version>.json

Nothing is ever written under the game folder. Before and after the run the script records
the size + mtime of Data.p4k and the SHA-256 of build_manifest.id, and fails if either changed.

Needs scdatatools (P4K reader + CryXmlB decoder only). See tool/README.md for the venv.

    python build_controls_data.py
    python build_controls_data.py --p4k "C:\\...\\LIVE\\Data.p4k" --out ..\\site\\data
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_P4K = Path(r"C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Data.p4k")
PROFILE_MEMBER = "Data/Libs/Config/defaultProfile.xml"
LOC_MEMBER = "Data/Localization/{lang}/global.ini"
SCHEMA = 1


# ---------------------------------------------------------------- guards

def game_fingerprint(p4k: Path) -> dict:
    st = p4k.stat()
    manifest = p4k.parent / "build_manifest.id"
    return {
        "p4k_size": st.st_size,
        "p4k_mtime_ns": st.st_mtime_ns,
        "manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest() if manifest.exists() else None,
    }


def read_manifest(p4k: Path) -> dict:
    m = p4k.parent / "build_manifest.id"
    if not m.exists():
        return {}
    data = json.loads(m.read_text(encoding="utf-8")).get("Data", {})
    return {"version": data.get("Version"), "branch": data.get("Branch"),
            "build_date": data.get("BuildDateStamp"), "change": data.get("RequestedP4ChangeNum")}


# ---------------------------------------------------------------- p4k access (read-only)

def read_members(p4k_path: Path, wanted: list[str]) -> dict[str, bytes]:
    """Return {member_name: bytes} for each wanted member, read straight from the archive."""
    from scdatatools.p4k import P4KFile          # imported here so --help works without it

    p4k = P4KFile(str(p4k_path))                  # ZipFile subclass, opened for reading
    index = {i.filename.lower(): i for i in p4k.filelist if i.filename.lower() in {w.lower() for w in wanted}}
    out = {}
    for w in wanted:
        info = index.get(w.lower())
        if info is None:
            raise SystemExit(f"{w} not found in {p4k_path}")
        with p4k.open(info) as f:
            out[w] = f.read()
    return out


def decode_profile(raw: bytes) -> ET.Element:
    from scdatatools.engine.cryxml import etree_from_cryxml_string

    if raw[:8] == b"CryXmlB\0":
        tree = etree_from_cryxml_string(raw)
        return tree.getroot() if hasattr(tree, "getroot") else tree
    return ET.fromstring(raw)                      # plain XML in some builds


# ---------------------------------------------------------------- parsing

def parse_global_ini(raw: bytes) -> dict[str, str]:
    """key=value lines; keys can carry ',P' style suffixes; values can hold a literal \\n."""
    out = {}
    for line in raw.decode("utf-8-sig", errors="replace").splitlines():
        if not line or line.startswith(("#", ";")) or "=" not in line:
            continue
        key, val = line.split("=", 1)
        out[key.split(",", 1)[0].strip().lower()] = val.replace("\\n", " ").strip()
    return out


def label_for(ref: str | None, strings: dict[str, str]) -> str | None:
    if not ref:
        return None
    key = ref[1:] if ref.startswith("@") else ref
    val = strings.get(key.lower())
    return re.sub(r"\s+", " ", val).strip() if val else None


def joystick_defaults(action: ET.Element, device: str = "joystick") -> list[str]:
    """All inputs an action ships with for a device type ("joystick", "keyboard"): the attribute and/or
    <device input=...> children (and their <inputdata input=...> grandchildren)."""
    found = []
    attr = action.get(device)
    if attr is not None and attr.strip():
        found.append(attr.strip())
    for child in action.findall(device):
        inp = (child.get("input") or "").strip()
        if inp:
            found.append(inp)
        for sub in child:                          # <joystick><inputdata input=.../></joystick>
            sub_inp = (sub.get("input") or "").strip()
            if sub_inp:
                found.append(sub_inp)
    return list(dict.fromkeys(found))


def build_data(profile: ET.Element, strings: dict[str, str], meta: dict) -> dict:
    maps = []
    n_actions = n_defaults = n_labelled = n_kb = 0
    for am in profile.findall("actionmap"):
        actions = []
        for a in am.findall("action"):
            label = label_for(a.get("UILabel"), strings)
            n_actions += 1
            n_labelled += bool(label)
            defaults = joystick_defaults(a)
            n_defaults += bool(defaults)
            # ui: the action has a UILabel at all, i.e. the game lists it on its controls screen.
            # Actions without one (menu navigation etc.) are hidden on the cards.
            entry = {"name": a.get("name"), "label": label, "ui": bool(a.get("UILabel"))}
            mode = a.get("activationMode")
            if mode:
                entry["activation"] = mode
            if defaults:
                entry["joystick"] = defaults
            kb = joystick_defaults(a, "keyboard")          # Stage C: keyboard defaults, same shapes
            if kb:
                entry["keyboard"] = kb
                n_kb += 1
            actions.append(entry)
        maps.append({
            "name": am.get("name"),
            "label": label_for(am.get("UILabel"), strings),
            "category": label_for(am.get("UICategory"), strings),
            "actions": actions,
        })
    return {
        "schema": SCHEMA,
        "meta": {**meta, "generated": _dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
                 "counts": {"actionmaps": len(maps), "actions": n_actions,
                            "with_label": n_labelled, "with_joystick_default": n_defaults,
                            "with_keyboard_default": n_kb},
                 "source": "Star Citizen Data.p4k: defaultProfile.xml + global.ini (game data, Cloud Imperium Games)"},
        "actionmaps": maps,
    }


# ---------------------------------------------------------------- main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--p4k", type=Path, default=DEFAULT_P4K)
    ap.add_argument("--out", type=Path, default=HERE.parent / "site" / "data")
    ap.add_argument("--lang", default="english")
    a = ap.parse_args(argv)

    p4k, out = a.p4k.resolve(), a.out.resolve()
    game_dir = p4k.parent.parent.parent if p4k.parent.name.upper() in ("LIVE", "PTU", "EPTU") else p4k.parent
    if out == game_dir or game_dir in out.parents or p4k.parent in out.parents or out == p4k.parent:
        raise SystemExit("refusing: the output folder is inside the game folder")

    before = game_fingerprint(p4k)
    meta = read_manifest(p4k)
    members = read_members(p4k, [PROFILE_MEMBER, LOC_MEMBER.format(lang=a.lang)])
    profile = decode_profile(members[PROFILE_MEMBER])
    strings = parse_global_ini(members[LOC_MEMBER.format(lang=a.lang)])
    data = build_data(profile, strings, {**meta, "language": a.lang})
    after = game_fingerprint(p4k)
    if before != after:
        raise SystemExit(f"game files changed during the run, aborting: {before} -> {after}")

    out.mkdir(parents=True, exist_ok=True)
    version = meta.get("version") or "unknown"
    path = out / f"sc-controls-{version}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from sitejs import write_js                     # the page can't fetch: ship the same data as JS
    write_js(data, out / "sc-controls.js", "KBMAP_CONTROLS", f"from {path.name} by build_controls_data.py")
    c = data["meta"]["counts"]
    print(f"wrote {path.name}: {c['actionmaps']} actionmaps, {c['actions']} actions, "
          f"{c['with_label']} labelled, {c['with_joystick_default']} with a joystick default "
          f"({path.stat().st_size // 1024} KB); game files unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
