"""Write site data as a JS file that sets a global, because the page may not fetch anything.

The page's CSP is connect-src 'none' (and file:// pages can't fetch either), so JSON can't be loaded with
fetch(). A <script src> from the page's own folder is allowed, so data ships as:
    globalThis.<NAME> = {...};
"""
import json
from pathlib import Path


def write_js(obj, path: Path, global_name: str, note: str = "") -> Path:
    head = f"/* Generated{': ' + note if note else ''}. Do not edit by hand. */\n"
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(f"{head}globalThis.{global_name} = {body};\n", encoding="utf-8", newline="\n")
    return path


def write_art_js(jpg: Path, path: Path, key: str) -> Path:
    import base64
    b64 = base64.b64encode(jpg.read_bytes()).decode("ascii")
    path.write_text("/* Generated from the VKB Gladiator fillable template (by VKB, design by UntoldForce; free to use per VKB). */\n"
                    f"(globalThis.KBMAP_ART = globalThis.KBMAP_ART || {{}})[{json.dumps(key)}] = "
                    f"\"data:image/jpeg;base64,{b64}\";\n", encoding="ascii", newline="\n")
    return path
