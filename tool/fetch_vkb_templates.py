"""Fetch VKB's official fillable stick templates (PDF) into Templates\\vkb\\ and extract the page image.

Build-time only, run by hand. The site never fetches anything. Source page:
https://www.vkbgaming.com/fillable-templates/ (no licence/redistribution terms stated; fine for Sal's own,
local use; bundling on a PUBLIC site is Sal's call at publish time).

    python fetch_vkb_templates.py            # Sal's pair (SCG RH, SCG-OTA LH) + the other Gladiator grips
    python fetch_vkb_templates.py SCG-RH     # just one

Rules:
- Writes ONLY inside Templates\\vkb\\. Never touches Sal's own files in Templates\\.
- Skips a PDF that already exists (no re-download). Prints the SHA-256 of every file, and records them in
  Templates\\vkb\\templates.json so a later VKB update is noticed (the hash changes).
- PDFs are treated as untrusted data: nothing in them is executed. Page images are extracted by
  extract_page_image() (no PDF engine needed if the page is one embedded JPEG).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import re
import sys
import urllib.request
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE.parent / "Templates"
VKB_DIR = TEMPLATES / "vkb"
BASE = "https://www.vkbgaming.com/wp-content/uploads/2026/03/"

# Sal's pair first (confirmed by Sal 2026-11-11): RIGHT = SCG RH, LEFT = SCG Omni-Throttle LH.
CATALOG = {
    "SCG-RH":     {"file": "VKB-Gladiator-SCG-RH-v1.0.pdf",     "side": "R", "grip": "SCG",               "sal": True},
    "SCG-OTA-LH": {"file": "VKB-Gladiator-SCG-OTA-LH-v1.0.pdf", "side": "L", "grip": "SCG Omni-Throttle", "sal": True},
    "SCG-LH":     {"file": "VKB-Gladiator-SCG-LH-v1.0.pdf",     "side": "L", "grip": "SCG",               "sal": False},
    "SCG-OTA-RH": {"file": "VKB-Gladiator-SCG-OTA-RH-v1.0.pdf", "side": "R", "grip": "SCG Omni-Throttle", "sal": False},
}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) keybind-template-fetch/1.0"


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def fetch(key: str) -> Path:
    item = CATALOG[key]
    dest = VKB_DIR / item["file"]
    if dest.exists():
        print(f"exists, skipped: {dest.name}")
        return dest
    req = urllib.request.Request(BASE + item["file"], headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        if r.status != 200:
            raise SystemExit(f"{item['file']}: HTTP {r.status}")
        data = r.read()
    if not data.startswith(b"%PDF"):
        raise SystemExit(f"{item['file']}: not a PDF (got {data[:16]!r})")
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(dest)
    print(f"downloaded: {dest.name} ({len(data) // 1024} KB)")
    return dest


def extract_page_image(pdf: Path) -> Path | None:
    """If the PDF's page image is a single embedded JPEG (DCTDecode), write it out as-is. Returns the path."""
    data = pdf.read_bytes()
    best = None
    for m in re.finditer(rb"<<(.*?)>>\s*stream\r?\n", data, re.S):
        head = m.group(1)
        if b"/Subtype/Image" not in head.replace(b" ", b"") and b"/Subtype /Image" not in head:
            continue
        length = re.search(rb"/Length\s+(\d+)(?!\s+\d+\s+R)", head)
        if not length:
            continue
        raw = data[m.end(): m.end() + int(length.group(1))]
        w = re.search(rb"/Width\s+(\d+)", head)
        h = re.search(rb"/Height\s+(\d+)", head)
        dims = (int(w.group(1)) if w else 0, int(h.group(1)) if h else 0)
        if b"DCTDecode" in head and raw[:2] == b"\xff\xd8":
            if best is None or dims[0] * dims[1] > best[0][0] * best[0][1]:
                best = (dims, raw)
    if not best:
        return None
    out = pdf.with_suffix(".jpg")
    if not out.exists():
        out.write_bytes(best[1])
    return out


def main(argv=None) -> int:
    keys = (argv if argv is not None else sys.argv[1:]) or list(CATALOG)
    unknown = [k for k in keys if k not in CATALOG]
    if unknown:
        raise SystemExit(f"unknown template(s) {unknown}; known: {', '.join(CATALOG)}")
    VKB_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = VKB_DIR / "templates.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    for k in keys:
        pdf = fetch(k)
        img = extract_page_image(pdf)
        entry = {**CATALOG[k], "url": BASE + CATALOG[k]["file"], "pdf_sha256": sha256(pdf),
                 "image": img.name if img else None, "image_sha256": sha256(img) if img else None}
        old = manifest.get(k)
        if old and old.get("pdf_sha256") != entry["pdf_sha256"]:
            print(f"NOTE: {k} changed since last recorded (was {old['pdf_sha256'][:12]}…)")
        entry["recorded"] = old["recorded"] if old and old.get("pdf_sha256") == entry["pdf_sha256"] else \
            _dt.date.today().isoformat()
        manifest[k] = entry
        print(f"  {k}: pdf sha256 {entry['pdf_sha256']}" + (f"\n  {k}: image {img.name} sha256 {entry['image_sha256']}" if img else "\n  (no embedded JPEG page image found)"))
    manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
