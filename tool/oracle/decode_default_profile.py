"""Regenerate the keyboard oracle's reference file from the live game, read-only.

    ..\\.venv\\Scripts\\python -B decode_default_profile.py            # from tool\\oracle\\

Reads Data/Libs/Config/defaultProfile.xml (CryXmlB) straight out of Data.p4k and writes the decoded XML to
    tool\\oracle\\defaultProfile-<game version>.decoded.xml
The site tests (tests/stagec.test.cjs) parse that file with their OWN regex code and compare it with the site
data. Independence, honestly stated: this shares scdatatools' P4K reader and CryXmlB decoder with
build_controls_data.py (same decoder), but not the build's parsing/extraction logic (ElementTree walk,
attribute/child handling). Run it after every game patch, together with build_controls_data.py.
Nothing is written under the game folder; the p4k + manifest fingerprint is checked before and after.
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import build_controls_data as bcd                   # noqa: E402  (fingerprint + p4k helpers only)


def main(argv=None) -> int:
    p4k = bcd.DEFAULT_P4K if not argv else Path(argv[0])
    before = bcd.game_fingerprint(p4k)
    raw = bcd.read_members(p4k, [bcd.PROFILE_MEMBER])[bcd.PROFILE_MEMBER]
    root = bcd.decode_profile(raw)
    after = bcd.game_fingerprint(p4k)
    if before != after:
        raise SystemExit(f"game files changed during the run, aborting: {before} -> {after}")
    version = bcd.read_manifest(p4k).get("version") or "unknown"
    out = HERE / f"defaultProfile-{version}.decoded.xml"
    out.write_text(ET.tostring(root, encoding="unicode"), encoding="utf-8")
    print(f"wrote {out.name} ({out.stat().st_size} bytes); game files unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
