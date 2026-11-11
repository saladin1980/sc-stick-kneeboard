"""Merge Joystick Diagrams' per-mode SVG exports into one diagram per stick.

Reads every `<id>-<device>-<mode>.svg` in the source folder (read-only), groups
them by device, and writes `<device> - all modes.svg` + `.png` into the output
folder. The stick art is taken from the device's own export; every slot is
overlaid with its bind (one mode) or mode dots (two or more), and a side panel
lists every bound button with each mode's bind.

Stdlib only. PNG is rendered by headless Microsoft Edge (or Chrome).

    python merge_diagrams.py                 # src = parent folder, out = src/merged
    python merge_diagrams.py --src D --out O --no-png
"""
from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent

FILE_RE = re.compile(r"^\d+-(?P<device>.+)-(?P<mode>[^-]+)\.svg$", re.I)
SLOT_RE = re.compile(
    r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" '
    r'fill="none" stroke="none"/><g[^>]*><switch>.*?<text[^>]*>(.*?)</text></switch></g>',
    re.S,
)
IMAGE_RE = re.compile(r"<image\b[^>]*/>", re.S)

# One fixed colour per mode, the same on every stick. Unknown modes get FALLBACK in turn.
MODE_COLOURS = {
    "Spaceship": "#1f6fb4",
    "Spaceship mining": "#a87900",
    "Spaceship salvage": "#2a8a2a",
    "Spaceship scanning": "#0e8a8a",
    "Turrets": "#c2399b",
    "Vehicle": "#8c564b",
    "Weapons": "#7b4fbf",
    "Fps": "#d9650b",
    "General": "#555555",
}
FALLBACK = ["#b03030", "#3d5a80", "#6a8d00", "#9c4f96", "#00796b", "#795548"]

ART_W, ART_H = 1159, 807          # Joystick Diagrams template canvas
COL_W = 330                       # one panel column
PANEL_PAD = 16
FONT = "Segoe UI, Arial, Helvetica, sans-serif"


@dataclass
class Slot:
    key: str            # "x,y"
    x: float
    y: float
    w: float
    h: float
    name: str
    order: int
    binds: dict = field(default_factory=dict)   # mode -> label


@dataclass
class Device:
    name: str           # e.g. "VKBsim Gladiator EVO R"
    side: str           # "R", "L" or "?"
    modes: list = field(default_factory=list)
    sources: list = field(default_factory=list)
    slots: dict = field(default_factory=dict)   # key -> Slot
    images: list = field(default_factory=list)
    template: str = ""
    warnings: list = field(default_factory=list)


# ---------------------------------------------------------------- reading

def clean_label(raw: str) -> str:
    t = html.unescape(raw).replace("\xa0", " ").replace("\n", " ").strip()
    t = re.sub(r"\s+", " ", t)
    if t.replace("/", "").strip() == "":
        return ""
    # Axis slots are "X / Y"; mark an empty half instead of a bare slash.
    if t.startswith("/"):
        t = "– " + t
    if t.endswith("/"):
        t = t + " –"
    return t


def fmt(v: float) -> str:
    return f"{v:g}"


def load_slotmap(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def read_sources(src: Path, slotmap: dict) -> dict[str, Device]:
    devices: dict[str, Device] = {}
    for p in sorted(src.glob("*.svg")):
        m = FILE_RE.match(p.name)
        if not m:
            continue
        dev_name, mode = m.group("device").strip(), m.group("mode").strip()
        side = dev_name.split()[-1] if dev_name.split()[-1] in ("R", "L") else "?"
        dev = devices.setdefault(dev_name, Device(dev_name, side))
        text = p.read_text(encoding="utf-8")
        if not dev.images:
            dev.images = IMAGE_RE.findall(text)
        dev.modes.append(mode)
        dev.sources.append(p.name)
        smap = slotmap.get(side, {})
        for x, y, w, h, raw in SLOT_RE.findall(text):
            key = f"{fmt(float(x))},{fmt(float(y))}"
            info = smap.get(key)
            label = clean_label(raw)
            if isinstance(info, str):           # template text, not a bind
                if info == "#title" and label:
                    dev.template = label
                continue
            if info is None:
                name, order = f"slot {key}", 900
                if label:
                    msg = f"{p.name}: slot {key} is not in slotmap.json (label {label!r})"
                    if msg not in dev.warnings:
                        dev.warnings.append(msg)
            else:
                name, order = info["name"], info["order"]
            slot = dev.slots.setdefault(
                key, Slot(key, float(x), float(y), float(w), float(h), name, order))
            if label:
                slot.binds[mode] = label
    for dev in devices.values():
        dev.modes = sorted(set(dev.modes), key=mode_sort_key)
    return devices


def mode_sort_key(mode: str):
    known = list(MODE_COLOURS)
    return (known.index(mode) if mode in known else len(known), mode.lower())


def mode_colours(modes) -> dict:
    out, i = {}, 0
    for m in modes:
        if m in MODE_COLOURS:
            out[m] = MODE_COLOURS[m]
        else:
            out[m] = FALLBACK[i % len(FALLBACK)]
            i += 1
    return out


# ---------------------------------------------------------------- text sizing

_NARROW = set("iljtfr.,:;'!|() []-")
_WIDE = set("mwMW@%")


def text_width(s: str, size: float) -> float:
    """Rough Segoe UI / Arial width, slightly pessimistic so nothing overflows."""
    w = 0.0
    for ch in s:
        if ch in _NARROW:
            w += 0.32
        elif ch in _WIDE:
            w += 0.86
        elif ch.isupper() or ch.isdigit():
            w += 0.64
        else:
            w += 0.54
    return w * size


MIN_ART_FONT = 8   # QA D3 (Master 2026-11-11): never smaller; ellipsize past it


def fit_in_box(label: str, w: float, h: float):
    """Return (font_size, [line]) for one line inside the box: 9 -> 8 px, then ellipsized at 8 px.

    The panel always carries the full label, so the art may shorten it.
    """
    max_w = w - 4
    for size in (9, 8.5, MIN_ART_FONT):
        if text_width(label, size) <= max_w:
            return size, [label]
    cut = label
    while len(cut) > 1 and text_width(cut.rstrip() + "…", MIN_ART_FONT) > max_w:
        cut = cut[:-1]
    # prefer a word boundary when it keeps most of the text
    if not label[len(cut):len(cut) + 1].isspace() and " " in cut.strip():
        word_cut = cut.rstrip().rsplit(" ", 1)[0]
        if len(word_cut) >= 0.6 * len(cut):
            cut = word_cut
    return MIN_ART_FONT, [cut.rstrip() + "…"]


def multi_tag(n: int, room: float) -> str:
    """Text after the mode dots, shortest form that fits (QA D4)."""
    for tag in (f"{n} modes ▸ list", f"{n} modes", f"{n}▸"):
        if text_width(tag, 8.5) <= room:
            return tag
    return ""


# ---------------------------------------------------------------- rendering

def render_svg(dev: Device, generated: str) -> tuple[str, int, int]:
    colours = mode_colours(dev.modes)
    bound = sorted((s for s in dev.slots.values() if s.binds), key=lambda s: (s.order, s.key))
    used_modes = {m for s in bound for m in s.binds}
    shown = [m for m in dev.modes if m in used_modes]          # QA D2: empty modes are hidden
    empty_modes = [m for m in dev.modes if m not in used_modes]

    # Panel layout: legend, then button blocks flowed into columns.
    line_h, head_h, gap = 14, 16, 7
    top = 92 + 18 * ((len(shown) + 1) // 2)           # header + 2-column legend
    usable = ART_H - top - (44 if empty_modes else 30)
    columns, col, used = [], [], 0
    for s in bound:
        block = head_h + line_h * len(s.binds) + gap
        if col and used + block > usable:
            columns.append(col)
            col, used = [], 0
        col.append(s)
        used += block
    if col:
        columns.append(col)
    n_cols = max(1, len(columns))
    panel_w = PANEL_PAD * 2 + COL_W * n_cols
    W, H = ART_W + panel_w, ART_H

    o = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
             f'version="1.1" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
    o.append(f'<title>{escape(dev.name)} — all modes</title>')
    o.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="#ffffff"/>')
    # Joystick Diagrams art (embedded raster + logo), same transform as the source.
    o.append('<g transform="translate(-0.5 -0.5)">')
    o.extend(dev.images)
    o.append('</g>')

    # Slot overlays
    for s in bound:
        o.append(f'<g class="slot" data-button="{escape(s.name)}">')
        o.append(f'<rect x="{s.x + 0.5}" y="{s.y + 0.5}" width="{s.w - 1}" height="{s.h - 1}" fill="#ffffff"/>')
        cx, cy = s.x + s.w / 2, s.y + s.h / 2
        if len(s.binds) == 1:
            mode, label = next(iter(s.binds.items()))
            size, lines = fit_in_box(label, s.w, s.h)
            lh = size * 1.05
            y0 = cy - lh * (len(lines) - 1) / 2 + size * 0.35
            for i, ln in enumerate(lines):
                o.append(f'<text x="{cx:.1f}" y="{y0 + i * lh:.1f}" font-family="{FONT}" font-size="{size}" '
                         f'fill="{colours[mode]}" text-anchor="middle">{escape(ln)}</text>')
        else:
            n = len(s.binds)
            r, step = 3.2, 8
            start = s.x + 6
            for i, mode in enumerate(sorted(s.binds, key=mode_sort_key)):
                o.append(f'<circle cx="{start + i * step:.1f}" cy="{cy:.1f}" r="{r}" fill="{colours[mode]}"/>')
            tx = start + (n - 1) * step + r + 3
            tag = multi_tag(n, s.x + s.w - 3 - tx)
            if tag:
                o.append(f'<text x="{tx:.1f}" y="{cy + 3:.1f}" font-family="{FONT}" font-size="8.5" '
                         f'fill="#333333">{escape(tag)}</text>')
        o.append('</g>')

    # Panel
    px = ART_W + PANEL_PAD
    o.append(f'<line x1="{ART_W}" y1="20" x2="{ART_W}" y2="{H - 20}" stroke="#d0d0d0" stroke-width="1"/>')
    title = dev.name + " — all modes"
    o.append(f'<text x="{px}" y="40" font-family="{FONT}" font-size="20" font-weight="bold" fill="#111111">{escape(title)}</text>')
    sub = f"{len(shown)} modes · {sum(len(s.binds) for s in bound)} binds on {len(bound)} inputs · generated {generated}"
    o.append(f'<text x="{px}" y="60" font-family="{FONT}" font-size="10.5" fill="#555555">{escape(sub)}</text>')
    # Legend, two columns
    for i, mode in enumerate(shown):
        lx = px + (i % 2) * 170
        ly = 84 + 18 * (i // 2)
        o.append(f'<rect x="{lx}" y="{ly - 9}" width="11" height="11" rx="2" fill="{colours[mode]}"/>')
        o.append(f'<text x="{lx + 16}" y="{ly}" font-family="{FONT}" font-size="11.5" fill="{colours[mode]}" '
                 f'font-weight="bold">{escape(mode)}</text>')
    # Button blocks
    for ci, column in enumerate(columns):
        x = px + ci * COL_W
        y = top + 12
        for s in column:
            o.append(f'<g class="entry" data-button="{escape(s.name)}">')
            o.append(f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="11.5" font-weight="bold" '
                     f'fill="#111111">{escape(s.name)}</text>')
            y += line_h + 1
            for mode in sorted(s.binds, key=mode_sort_key):
                label = s.binds[mode]
                o.append(f'<rect x="{x + 2}" y="{y - 8}" width="8" height="8" rx="1.5" fill="{colours[mode]}"/>')
                o.append(f'<text x="{x + 15}" y="{y}" font-family="{FONT}" font-size="10.5" fill="#222222" '
                         f'data-mode="{escape(mode)}">{escape(label)}'
                         f'<tspan fill="{colours[mode]}" font-size="9.5">  {escape(mode)}</tspan></text>')
                y += line_h
            y += gap
            o.append('</g>')

    # Footer: provenance + credit (Joystick Diagrams is GPL-2.0)
    if empty_modes:
        o.append(f'<text x="{px}" y="{H - 38}" font-family="{FONT}" font-size="9" fill="#777777">'
                 f'Modes with no binds: {escape(", ".join(empty_modes))}</text>')
    o.append(f'<text x="{px}" y="{H - 24}" font-family="{FONT}" font-size="9" fill="#777777">'
             f'Template: {escape(dev.template or "unknown")}. Art and labels from Joystick Diagrams exports '
             f'(github.com/Rexeh/joystick-diagrams, GPL-2.0).</text>')
    o.append(f'<text x="{px}" y="{H - 12}" font-family="{FONT}" font-size="9" fill="#777777">'
             f'Sources: {len(dev.sources)} files, {escape(dev.sources[0].split("-")[0])}-…-&lt;mode&gt;.svg</text>')
    o.append('</svg>')
    return "\n".join(o) + "\n", W, H


def find_browser() -> str | None:
    for c in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe"):
        if os.path.exists(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome")


def render_png(svg_path: Path, png_path: Path, w: int, h: int, scale: int = 2) -> None:
    browser = find_browser()
    if not browser:
        raise RuntimeError("no Edge/Chrome found for PNG rendering (use --no-png)")
    with tempfile.TemporaryDirectory(prefix="kbmap-edge-") as prof:
        cmd = [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
               f"--user-data-dir={prof}", f"--force-device-scale-factor={scale}",
               f"--window-size={w},{h}", f"--screenshot={png_path}", svg_path.resolve().as_uri()]
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
    if not png_path.exists():
        raise RuntimeError(f"browser did not write {png_path}")


def png_size(path: Path) -> tuple[int, int]:
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


# ---------------------------------------------------------------- main

def run(src: Path, out: Path, slotmap_path: Path = HERE / "slotmap.json", png: bool = True,
        log=print) -> dict[str, Device]:
    src, out = src.resolve(), out.resolve()
    if out == src:
        raise SystemExit("refusing to write into the source folder: pick a subfolder")
    devices = read_sources(src, load_slotmap(slotmap_path))
    if not devices:
        raise SystemExit(f"no Joystick Diagrams SVGs found in {src}")
    out.mkdir(parents=True, exist_ok=True)
    generated = _dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    for dev in devices.values():
        for w in dev.warnings:
            log("WARNING:", w)
        svg_text, W, H = render_svg(dev, generated)
        base = out / f"{dev.name} - all modes"
        svg_path = base.with_suffix(".svg")
        # LF on every OS, so the file is byte-identical to what the site's download produces (QA 2026-11-11)
        svg_path.write_text(svg_text, encoding="utf-8", newline="\n")
        log(f"wrote {svg_path.name}  ({len(dev.modes)} modes, {W}x{H})")
        if png:
            png_path = base.with_suffix(".png")
            render_png(svg_path, png_path, W, H)
            log(f"wrote {png_path.name}  {png_size(png_path)}")
    return devices


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=HERE.parent, help="folder with the Joystick Diagrams SVGs")
    ap.add_argument("--out", type=Path, default=None, help="output folder (default: <src>/merged)")
    ap.add_argument("--slotmap", type=Path, default=HERE / "slotmap.json")
    ap.add_argument("--no-png", action="store_true", help="write SVG only")
    a = ap.parse_args(argv)
    run(a.src, a.out or a.src / "merged", a.slotmap, png=not a.no_png)
    return 0


if __name__ == "__main__":
    sys.exit(main())
