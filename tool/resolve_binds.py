"""Stage B reference resolver: a player's actionmaps export + the game data -> effective joystick binds.

The site's JavaScript resolver is a port of this file. Two modes:

* full    (what the site shows): game defaults + the player's rebinds, labels from the game's own
          strings, every action on an input kept (no overwriting).
* jd      (oracle only): exactly what Joystick Diagrams' Star Citizen plugin does: the export's
          rebinds only, JD's label rules + mode table, last action on an input wins. Used to prove
          this parser reproduces JD's 13 diagrams before anything new is trusted.

Bind shape: {"device": "VKBsim Gladiator EVO R", "instance": 2, "actionmap": "spaceship_movement",
             "action": "v_afterburner", "input": "button6", "label": "...", "source": "rebind"|"default",
             "modifier": None|"...", "activation": None|"double_tap"}
"""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

JS_RE = re.compile(r"^js(\d+)_(.*)$")
KB_RE = re.compile(r"^kb1_(.*)$")
KEY_ALIAS = {"]": "rbracket", "[": "lbracket"}          # quirks seen in the game's own defaults


# ---------------------------------------------------------------- export parsing

def parse_product(product: str) -> str:
    """' VKBsim Gladiator EVO R    {0200231D-...}' -> 'VKBsim Gladiator EVO R' (the GUID is dropped)."""
    return re.sub(r"\s*\{[0-9A-Fa-f-]+\}\s*$", "", product or "").strip()


def parse_export(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)
    devices = {}
    for opt in root.findall("options"):
        if opt.get("type") == "joystick" and opt.get("instance"):
            devices[int(opt.get("instance"))] = parse_product(opt.get("Product", ""))
    rebinds, kb_rebinds = [], []
    for order, am in enumerate(root.findall("actionmap")):
        for act in am.findall("action"):
            for rb in act.findall("rebind"):
                inp = rb.get("input", "")
                m = JS_RE.match(inp)
                k = KB_RE.match(inp)
                if m:
                    rebinds.append({"actionmap": am.get("name"), "action": act.get("name"),
                                    "instance": int(m.group(1)), "raw": m.group(2).strip(),
                                    "activation": rb.get("activationMode") or None})
                elif k:                                       # Stage C: keyboard
                    kb_rebinds.append({"actionmap": am.get("name"), "action": act.get("name"),
                                       "raw": k.group(1).strip(), "activation": rb.get("activationMode") or None})
    return {"devices": devices, "rebinds": rebinds, "kb_rebinds": kb_rebinds}


def split_modifier(raw: str) -> tuple[str | None, str]:
    """'rctrl+button3' -> ('rctrl', 'button3'); JD assumes at most one modifier before '+'."""
    if "+" in raw:
        mod, rest = raw.split("+", 1)
        return mod, rest.split("+")[-1]
    return None, raw


# ---------------------------------------------------------------- full mode (the site)

def humanize(action_id: str) -> str:
    parts = action_id.split("_")
    words = parts[1:] if len(parts) > 1 and len(parts[0]) <= 3 else parts
    return " ".join(words).capitalize()


def resolve_full(export: dict, data: dict, default_instances: str = "1") -> list[dict]:
    """default_instances: "1" (or any instance number) = game defaults apply to that joystick only;
    "all" = to every joystick. The site's "my default stick is L/R" toggle passes the matching instance."""
    labels, maps = {}, {}
    for am in data["actionmaps"]:
        for a in am["actions"]:
            labels[(am["name"], a["name"])] = a.get("label") or humanize(a["name"])
            maps.setdefault(am["name"], []).append(a)
    devices = export["devices"]
    instances = sorted(devices) if str(default_instances) == "all" else \
        [i for i in sorted(devices) if i == int(default_instances)]

    # An action has ONE joystick slot (the game's controls screen has one joystick cell per action;
    # Sal's export: 257 rebinds, never two joystick rebinds on one action). So any joystick rebind,
    # on any stick and including a blank unbind, replaces the action's joystick default.
    rebound = {(rb["actionmap"], rb["action"]) for rb in export["rebinds"]}

    out = []
    for am_name, actions in maps.items():
        for a in actions:
            if (am_name, a["name"]) in rebound:
                continue
            for inst in instances:
                for raw in a.get("joystick", []):
                    mod, inp = split_modifier(raw)
                    out.append(_bind(devices, inst, am_name, a["name"], inp, mod,
                                     labels.get((am_name, a["name"])), "default", a.get("activation")))
    # rebinds (a blank one is an explicit unbind and adds nothing)
    for rb in export["rebinds"]:
        if not rb["raw"]:
            continue
        mod, inp = split_modifier(rb["raw"])
        lab = labels.get((rb["actionmap"], rb["action"])) or humanize(rb["action"])
        out.append(_bind(devices, rb["instance"], rb["actionmap"], rb["action"], inp, mod, lab,
                         "rebind", rb["activation"]))
    return out


def _bind(devices, inst, am, action, inp, mod, label, source, activation):
    return {"device": devices.get(inst, f"Joystick {inst}"), "instance": inst, "actionmap": am,
            "action": action, "input": inp, "label": label, "source": source,
            "modifier": mod, "activation": activation}


# ---------------------------------------------------------------- keyboard (Stage C)

MODIFIERS = {"lshift", "rshift", "lctrl", "rctrl", "lalt", "ralt"}


def split_keys(raw: str) -> tuple[list[str], str]:
    """'rctrl+rshift+1' -> (['rctrl', 'rshift'], '1'); tokens lower-cased, game quirks normalised.
    Order doesn't decide which is the key: 7 game defaults put the modifier last ('u+lshift', 'f6+lalt').
    The key is the non-modifier token; if every token is a modifier (a lone 'lalt'), the last one is the key."""
    parts = [KEY_ALIAS.get(p.strip(), p.strip().lower()) for p in raw.split("+") if p.strip()]
    if not parts:
        return [], ""
    keys = [p for p in parts if p not in MODIFIERS]
    if not keys:
        return parts[:-1], parts[-1]
    return [p for p in parts if p in MODIFIERS], keys[-1]


def resolve_keyboard(export: dict, data: dict) -> list[dict]:
    """Keyboard binds: game defaults + the player's kb1_ rebinds. One keyboard slot per action (Sal's export:
    130 actions with a kb rebind, never two on one action), so any kb1_ rebind, blank included, replaces
    that action's keyboard defaults."""
    meta = {}
    for am in data["actionmaps"]:
        for a in am["actions"]:
            meta[(am["name"], a["name"])] = a
    rebound = {(r["actionmap"], r["action"]) for r in export.get("kb_rebinds", [])}
    out = []
    for am in data["actionmaps"]:
        for a in am["actions"]:
            if (am["name"], a["name"]) in rebound:
                continue
            for raw in a.get("keyboard", []):
                mods, key = split_keys(raw)
                out.append(_kb(am["name"], a, key, mods, "default", a.get("activation")))
    for r in export.get("kb_rebinds", []):
        if not r["raw"]:
            continue
        mods, key = split_keys(r["raw"])
        a = meta.get((r["actionmap"], r["action"]), {"name": r["action"], "label": None})
        out.append(_kb(r["actionmap"], a, key, mods, "rebind", r["activation"],
                       known=(r["actionmap"], r["action"]) in meta))
    return out


def _kb(am, a, key, mods, source, activation, known=True):
    return {"device": "Keyboard", "actionmap": am, "action": a["name"], "input": key, "modifiers": mods,
            "label": a.get("label") or humanize(a["name"]), "source": source, "activation": activation,
            "ui": a.get("ui", True) if known else True, "guessed": not a.get("label")}


# ---------------------------------------------------------------- jd mode (oracle)

def load_jd_rules(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def jd_label(action: str, rules: dict) -> str:
    name = rules["custom_labels"].get(action, action)
    parts = name.split("_")
    return parts[0].capitalize() if len(parts) == 1 else " ".join(parts[1:]).capitalize()


def jd_mode(actionmap: str, rules: dict) -> str:
    """JD's profile name, as it lands in the export file name ('Spaceship Mining' -> 'Spaceship mining')."""
    return rules["profile_mappings"].get(actionmap, "Spaceship").capitalize()


def resolve_jd(export: dict, rules: dict) -> dict:
    """{(device, mode, input): label}, last write wins, rebinds only, modifiers kept separate."""
    out = {}
    for rb in export["rebinds"]:
        if not rb["raw"]:
            continue
        mod, inp = split_modifier(rb["raw"])
        key = (export["devices"].get(rb["instance"]), jd_mode(rb["actionmap"], rules), inp if not mod else f"{mod}+{inp}")
        out[key] = jd_label(rb["action"], rules)
    return out


# ---------------------------------------------------------------- inputs -> template slots

HAT = {"up": "Hat ↑", "down": "Hat ↓", "left": "Hat ←", "right": "Hat →"}


def slot_name(inp: str) -> str | None:
    """Joystick input -> the slot name used in slotmap.json (None = the JD template has no box for it)."""
    m = re.fullmatch(r"button(\d+)", inp)
    if m:
        return f"Button {int(m.group(1))}"
    m = re.fullmatch(r"hat1_(up|down|left|right)", inp)
    if m:
        return HAT[m.group(1)]
    if inp in ("x", "y"):
        return "X / Y axis"
    if inp == "rotz":
        return "Z axis (twist)"
    return None
