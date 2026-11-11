"""Apply the one fix scdatatools 1.0.4 (PyPI) needs to open current Data.p4k files, to OUR venv only.

Symptom without it:  zipfile.BadZipFile: Corrupt extra field 0001 (size=18)
Cause: current p4k builds carry longer ZIP64 extra fields; scdatatools' P4KInfo._decodeExtra
accepts only lengths of exactly 16 / 8. The same fix is in the SC DataPack's patches/scdatatools/p4k.py
(the SC DataPack venv runs it); this script applies just those two lines (scdatatools is MIT).

    .venv\\Scripts\\python patch_scdatatools.py            # patches the scdatatools in the running venv
Never point this at another project's venv.
"""
import sys
from pathlib import Path

FIXES = [("elif ln == 16:", "elif ln >= 16:"), ("elif ln == 8:", "elif ln >= 8:")]


def main() -> int:
    import scdatatools  # noqa: F401  (the venv running this script)
    p4k = Path(sys.modules["scdatatools"].__file__).parent / "p4k.py"
    if "Keybinding Mapping" not in str(p4k):
        raise SystemExit(f"refusing: {p4k} is not this project's venv")
    text = p4k.read_text(encoding="utf-8")
    if all(new in text for _, new in FIXES):
        print(f"already patched: {p4k}")
        return 0
    for old, new in FIXES:
        if text.count(old) != 1:
            raise SystemExit(f"unexpected p4k.py (found {text.count(old)}x {old!r}); not patching")
        text = text.replace(old, new)
    p4k.write_text(text, encoding="utf-8")
    print(f"patched: {p4k}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
