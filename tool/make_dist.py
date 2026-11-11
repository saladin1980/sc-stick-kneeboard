"""Build the publishable copy of the site into dist\\ (build only, never deploys).

    python make_dist.py                    # the published copy: site\\ minus .publishignore (VKB art included)
    python make_dist.py --without-vkb-art  # a lean copy without art\\vkb\\ (stick cards fall back to lists)
    python make_dist.py --out ..\\some-folder

Writes:
  - every file in site\\ except what site\\.publishignore lists (the one definition the tests also use)
  - LICENSE and NOTICE from the project root
  - _headers for Cloudflare Pages: the CSP from index.html's meta tag (single source) sent as an HTTP header,
    plus frame-ancestors 'none' (header-only), nosniff, no-referrer
  - .kbmap-dist (a marker: the script only ever deletes a dist folder that carries it)
Deploying (e.g. `wrangler pages deploy dist`) is Sal's call and is NOT done here.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SITE = ROOT / "site"
MARKER = ".kbmap-dist"


def publish_ignore() -> list[str]:
    lines = (SITE / ".publishignore").read_text(encoding="utf-8").splitlines()
    return [l.strip() for l in lines if l.strip() and not l.strip().startswith("#")]


def shipped_files(without_art: bool = False) -> list[str]:
    """Site-relative paths (forward slashes) of everything that ships."""
    ignore = publish_ignore() + (["art/vkb/"] if without_art else [])
    out = []
    for p in sorted(SITE.rglob("*")):
        rel = p.relative_to(SITE).as_posix()
        parts = rel.split("/")
        # skip a file if it, or any parent folder, is listed
        if any("/".join(parts[:i]) + "/" in ignore for i in range(1, len(parts))) or rel in ignore:
            continue
        if p.is_file():
            out.append(rel)
    return out


def csp_from_index() -> str:
    html = (SITE / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)">', html)
    if not m:
        raise SystemExit("index.html has no CSP meta tag")
    return m.group(1)


def headers_file() -> str:
    csp = csp_from_index() + "; frame-ancestors 'none'"
    return ("/*\n"
            f"  Content-Security-Policy: {csp}\n"
            "  X-Content-Type-Options: nosniff\n"
            "  Referrer-Policy: no-referrer\n"
            "  X-Frame-Options: DENY\n"
            "/data/*\n"
            "  Cache-Control: public, max-age=3600, must-revalidate\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "dist")
    ap.add_argument("--without-vkb-art", action="store_true", help="leave out art/vkb/ (a lean copy; sticks show lists)")
    a = ap.parse_args(argv)
    out = a.out.resolve()
    if out in (ROOT, SITE) or SITE in out.parents or out == ROOT.parent:
        raise SystemExit(f"refusing to build into {out}")
    if out.exists():
        if not (out / MARKER).exists():
            raise SystemExit(f"{out} exists and wasn't made by make_dist.py (no {MARKER}); not touching it")
        shutil.rmtree(out)
    files = shipped_files(a.without_vkb_art)
    for rel in files:
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SITE / rel, dst)
    for name in ("LICENSE", "NOTICE"):
        shutil.copy2(ROOT / name, out / name)
    (out / "_headers").write_text(headers_file(), encoding="utf-8", newline="\n")
    (out / MARKER).write_text("built by tool/make_dist.py\n", encoding="utf-8")
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"dist: {len(files)} site files + LICENSE, NOTICE, _headers -> {out} ({size // 1024} KB)"
          f"{' (without VKB art)' if a.without_vkb_art else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
