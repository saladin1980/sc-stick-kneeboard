"""Oracle gate for Stage B: prove the XML-direct path against Joystick Diagrams' own output.

Stage 1 (must be exact): resolve_binds in "jd" mode (export rebinds only, JD's labels and modes,
         last write wins) must reproduce every label in JD's per-mode SVG exports, slot for slot.
Stage 2 (must be fully explained): every difference between "full" mode (defaults + game labels,
         all actions kept) and the jd result falls into a named category. Anything else fails.

    python oracle_diff.py --xml "<the actionmaps export>" --data ..\\site\\data\\sc-controls-<v>.json
Writes oracle\\oracle-report.md and oracle\\oracle-report.json. Exit 1 if the gate fails.
Reads the export, the data file and the JD SVGs only.
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

import merge_diagrams as md
import resolve_binds as rb

HERE = Path(__file__).resolve().parent


def jd_expected(src: Path) -> dict:
    """{(device, mode, slot base name): label} from the JD SVG exports."""
    devs = md.read_sources(src, md.load_slotmap(HERE / "slotmap.json"))
    out = {}
    for dev in devs.values():
        for s in dev.slots.values():
            for mode, label in s.binds.items():
                # "Button 23 (Encoder 1 ↑)" -> "Button 23"; other names stay whole
                base = s.name.split(" (")[0] if s.name.startswith("Button ") else s.name
                out[(dev.name, mode, base)] = label
    return out, devs


def jd_actual(export: dict, rules: dict) -> tuple[dict, list]:
    """Our jd-mode result laid out the way JD's template lays it out."""
    raw = rb.resolve_jd(export, rules)
    out, unplaced = {}, []
    axes = collections.defaultdict(dict)
    for (device, mode, inp), label in raw.items():
        if "+" in inp:
            unplaced.append((device, mode, inp, label, "modifier bind"))
            continue
        if inp in ("x", "y"):
            axes[(device, mode)][inp] = label
            continue
        name = rb.slot_name(inp)
        if name is None:
            unplaced.append((device, mode, inp, label, "the JD template has no box for this input"))
            continue
        out[(device, mode, name)] = label
    for (device, mode), xy in axes.items():
        label = md.clean_label(f"{xy.get('x', '')} / {xy.get('y', '')}")
        if label:
            out[(device, mode, "X / Y axis")] = label
    return out, unplaced


def stage2(export: dict, data: dict, rules: dict, default_instances: str) -> dict:
    full = rb.resolve_full(export, data, default_instances)
    cats = collections.defaultdict(list)
    # collisions JD hid: one input, one JD mode, several rebind actions
    seen = collections.defaultdict(list)
    for r in export["rebinds"]:
        if r["raw"]:
            seen[(export["devices"].get(r["instance"]), rb.jd_mode(r["actionmap"], rules), r["raw"])].append(r["action"])
    for key, actions in seen.items():
        if len(actions) > 1:
            cats["collision: JD showed only the last action, the site shows all"].append(
                f"{key[0]} · {key[1]} · {key[2]}: {', '.join(actions)} (JD showed {rb.jd_label(actions[-1], rules)!r})")
    unexplained = []
    for b in full:
        jd_lab = rb.jd_label(b["action"], rules)
        where = f"{b['device']} · {rb.jd_mode(b['actionmap'], rules)} · {b['input']}"
        if b["source"] == "default":
            cats["default added: a game default JD never shows (export holds changes only)"].append(
                f"{where}: {b['label']} ({b['action']})")
        elif b["source"] == "rebind":
            if b["label"] != jd_lab:
                cats["label wording: the game's own string instead of JD's id-based label"].append(
                    f"{where}: JD {jd_lab!r} -> game {b['label']!r}")
        else:
            unexplained.append(b)
        if b["input"] and rb.slot_name(b["input"]) is None and b["input"] not in ("x", "y"):
            cats["no box on the JD art for this input (shown in the list part only)"].append(
                f"{where}: {b['label']}")
    unbinds = [r for r in export["rebinds"] if not r["raw"]]
    defaults_by_action = {(am["name"], a["name"]) for am in data["actionmaps"] for a in am["actions"] if a.get("joystick")}
    evidence = collections.Counter()
    for r in unbinds:
        has_default = (r["actionmap"], r["action"]) in defaults_by_action
        evidence[(f"js{r['instance']}", "action has a game default" if has_default else "no game default")] += 1
    return {"categories": cats, "unexplained": unexplained, "full_count": len(full),
            "unbind_evidence": {f"{k[0]}: {k[1]}": v for k, v in sorted(evidence.items())}}


def stage3_vkb(export: dict, data: dict, default_instances: str) -> dict:
    """VKB numbering is the source of truth: check the field map, every template, slotmap.json and Sal's binds."""
    fmap = json.loads((HERE / "vkb_fieldmap.json").read_text(encoding="utf-8"))["fields"]
    vkb_path = HERE.parent / "site" / "data" / "vkb-templates.json"
    problems, notes = [], []
    inputs = [f["input"] for f in fmap.values() if f["input"]]
    buttons = sorted(int(i[6:]) for i in inputs if i.startswith("button"))
    if buttons != list(range(1, 30)):
        problems.append(f"field map buttons are not exactly 1-29 once each: {buttons}")
    if len(set(inputs)) != len(inputs):
        problems.append("field map maps one input to two fields")
    if vkb_path.exists():
        vkb = json.loads(vkb_path.read_text(encoding="utf-8"))["templates"]
        for key, t in vkb.items():
            missing, extra = set(fmap) - set(t["fields"]), set(t["fields"]) - set(fmap)
            if missing or extra:
                problems.append(f"{key}: fields missing {sorted(missing)} / unmapped {sorted(extra)}")
        notes.append(f"templates checked: {', '.join(vkb)} (each {len(fmap)} field groups)")
    else:
        problems.append("site/data/vkb-templates.json missing: run extract_vkb_boxes.py")
    # slotmap.json (v1 / JD art) must name the same buttons the VKB numbering has
    sm = md.load_slotmap(HERE / "slotmap.json")
    for side in ("R", "L"):
        nums = sorted(int(v["name"].split()[1]) for v in sm[side].values()
                      if isinstance(v, dict) and v["name"].startswith("Button "))
        if nums != list(range(1, 30)):
            problems.append(f"slotmap {side}: buttons {nums} != 1-29")
    notes.append("slotmap.json R/L: buttons 1-29 once each, same set as the VKB field map. Encoder names differ "
                 "by source (JD art 'Encoder 1' = 23/24; VKB PDF 'En1 base right' = 23/24; VKB JPG 'En2' = 23/24): "
                 "numbers agree, names don't. Button numbers are the key everywhere.")
    # Sal's binds: every input lands on a VKB field?
    by_input = {f["input"]: name for name, f in fmap.items() if f["input"]}
    off = sorted({(b["device"], b["input"]) for b in rb.resolve_full(export, data, default_instances)
                  if b["input"] not in by_input})
    for d, i in off:
        notes.append(f"not on the VKB picture: {d} · {i}")
    return {"pass": not problems, "problems": problems, "notes": notes, "off_picture": off}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--xml", type=Path, required=True)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--src", type=Path, default=HERE.parent, help="folder with JD's SVG exports")
    ap.add_argument("--defaults", choices=["1", "all"], default="1", help="which joysticks game defaults apply to")
    ap.add_argument("--out", type=Path, default=HERE / "oracle")
    a = ap.parse_args(argv)

    export = rb.parse_export(a.xml.read_text(encoding="utf-8"))
    data = json.loads(a.data.read_text(encoding="utf-8"))
    rules = rb.load_jd_rules(HERE / "oracle" / "jd_star_citizen_plugin.json")

    expected, devs = jd_expected(a.src)
    actual, unplaced = jd_actual(export, rules)
    # JD writes no file for a mode with no binds on that device; compare only modes JD exported
    exported_modes = {(d.name, m) for d in devs.values() for m in d.modes}
    actual_cmp = {k: v for k, v in actual.items() if (k[0], k[1]) in exported_modes}
    missing_modes = sorted({(k[0], k[1]) for k in actual} - exported_modes)
    only_jd = sorted(set(expected) - set(actual_cmp))
    only_us = sorted(set(actual_cmp) - set(expected))
    differ = sorted(k for k in set(expected) & set(actual_cmp) if expected[k] != actual_cmp[k])
    s1_ok = not (only_jd or only_us or differ or missing_modes)

    s2 = stage2(export, data, rules, a.defaults)
    s2_ok = not s2["unexplained"]
    s3 = stage3_vkb(export, data, a.defaults)
    s3_ok = s3["pass"]

    a.out.mkdir(parents=True, exist_ok=True)
    L = [f"# Oracle report — Stage B vs Joystick Diagrams",
         "",
         f"- Export: `{a.xml.name}` · data: `{a.data.name}` · JD exports: {sum(len(d.sources) for d in devs.values())} SVGs",
         f"- Devices in the export: " + ", ".join(f"js{i} = {n}" for i, n in sorted(export['devices'].items())),
         f"- Game defaults applied to: {'js1 only' if a.defaults == '1' else 'every joystick'}",
         "",
         f"## Stage 1 — reproduce JD exactly: {'PASS' if s1_ok else 'FAIL'}",
         f"- JD labels compared: {len(expected)} · matched: {len(expected) - len(only_jd) - len(differ)}",
         f"- Only in JD: {len(only_jd)} · only in ours: {len(only_us)} · different text: {len(differ)} · modes JD didn't export: {len(missing_modes)}"]
    for k in only_jd:
        L.append(f"  - only JD: {k} = {expected[k]!r}")
    for k in only_us:
        L.append(f"  - only ours: {k} = {actual_cmp[k]!r}")
    for k in differ:
        L.append(f"  - differ: {k}: JD {expected[k]!r} vs ours {actual_cmp[k]!r}")
    for k in missing_modes:
        L.append(f"  - mode with binds but no JD file: {k}")
    if unplaced:
        L.append(f"- Binds JD's template can't place (not compared): {len(unplaced)}")
        for u in unplaced:
            L.append(f"  - {u[0]} · {u[1]} · {u[2]}: {u[3]} ({u[4]})")
    L += ["", f"## Stage 2 — full mode vs JD, every difference explained: {'PASS' if s2_ok else 'FAIL'}",
          f"- Full-mode binds: {s2['full_count']} · unexplained: {len(s2['unexplained'])}"]
    for cat, items in sorted(s2["categories"].items()):
        L.append(f"- **{cat}**: {len(items)}")
        for it in items:
            L.append(f"  - {it}")
    L += ["", "## Evidence: which joysticks do game defaults land on?",
          "Explicit unbinds (`jsN_ ` blank) in the export, by whether that action ships with a joystick default:"]
    for k, v in s2["unbind_evidence"].items():
        L.append(f"- {k}: {v}")
    L += ["", f"## Stage 3 — VKB template numbering is the source of truth: {'PASS' if s3_ok else 'FAIL'}"]
    L += [f"- PROBLEM: {p}" for p in s3["problems"]] + [f"- {n}" for n in s3["notes"]]
    L.append(f"- Sal's binds not on the VKB picture: {len(s3['off_picture'])}")
    gate = s1_ok and s2_ok and s3_ok
    L += ["", f"**Gate: {'PASS' if gate else 'FAIL'}**", ""]
    (a.out / "oracle-report.md").write_text("\n".join(L), encoding="utf-8")
    (a.out / "oracle-report.json").write_text(json.dumps({
        "stage1": {"pass": s1_ok, "compared": len(expected), "only_jd": [list(k) for k in only_jd],
                   "only_ours": [list(k) for k in only_us], "differ": [list(k) for k in differ],
                   "unplaced": unplaced},
        "stage2": {"pass": s2_ok, "categories": {k: len(v) for k, v in s2["categories"].items()},
                   "unexplained": s2["unexplained"]},
        "stage3": {"pass": s3_ok, "problems": s3["problems"], "off_picture": [list(x) for x in s3["off_picture"]]},
        "unbind_evidence": s2["unbind_evidence"]}, indent=1, ensure_ascii=False), encoding="utf-8")
    print("\n".join(L[:14]))
    print(f"... full report: {a.out / 'oracle-report.md'}")
    return 0 if gate else 1


if __name__ == "__main__":
    sys.exit(main())
