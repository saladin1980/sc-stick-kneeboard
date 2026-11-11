"""make_dist tests: python -m unittest -v test_dist   (builds into temp folders only)"""
import re
import shutil
import tempfile
import unittest
from pathlib import Path

import make_dist as md


class Dist(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="kbmap-dist-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def build(self, *extra):
        out = self.tmp / "dist"
        self.assertEqual(md.main(["--out", str(out), *extra]), 0)
        return out, sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())

    def test_public_copy_is_exactly_the_shipped_set(self):
        out, files = self.build()
        site = sorted(md.shipped_files())
        self.assertEqual(files, sorted(site + ["LICENSE", "NOTICE", "_headers", md.MARKER]))
        for banned in ("tests/", "README.md", ".publishignore"):          # art/vkb/ ships since Sal's ruling
            self.assertFalse(any(f.startswith(banned) or f == banned for f in files), banned)
        for must in ("index.html", "jd.html", "css/kneeboard.css", "js/app.js", "js/kbd.js", "data/sc-controls.js"):
            self.assertIn(must, files)
        for f in site:                                        # byte-identical copies
            self.assertEqual((out / f).read_bytes(), (md.SITE / f).read_bytes(), f)

    def test_vkb_art_ships_by_default_and_lean_copy_drops_only_it(self):
        _, full = self.build()
        self.assertEqual(sorted(f for f in full if f.startswith("art/vkb/")),
                         ["art/vkb/SCG-LH.js", "art/vkb/SCG-OTA-LH.js", "art/vkb/SCG-OTA-RH.js", "art/vkb/SCG-RH.js"])
        _, lean = self.build("--without-vkb-art")
        self.assertEqual(sorted(set(full) - set(lean)), sorted(f for f in full if f.startswith("art/vkb/")))
        self.assertEqual(set(lean) - set(full), set())

    def test_headers_carry_the_page_csp_plus_frame_ancestors(self):
        out, _ = self.build()
        h = (out / "_headers").read_text(encoding="utf-8")
        csp = md.csp_from_index()
        self.assertIn(f"Content-Security-Policy: {csp}; frame-ancestors 'none'", h)
        self.assertIn("connect-src 'none'", h)
        self.assertIn("X-Content-Type-Options: nosniff", h)
        self.assertIn("Referrer-Policy: no-referrer", h)

    def test_license_and_notice(self):
        out, _ = self.build()
        lic = (out / "LICENSE").read_text(encoding="utf-8")
        self.assertTrue(lic.lstrip().startswith("GNU GENERAL PUBLIC LICENSE"))
        self.assertIn("Version 2, June 1991", lic)
        notice = (out / "NOTICE").read_text(encoding="utf-8")
        for need in ("Joystick Diagrams", "GPL-2.0", "UntoldForce", "by VKB (vkbgaming.com)", "Free to use per VKB",
                     "not affiliated with", "Cloud Imperium Games", "scdatatools", "PyMuPDF"):
            self.assertIn(need, notice)
        # no personal info: no e-mail address, no local path, no LAN address
        self.assertIsNone(re.search(r"[\w.+-]+@[\w-]+\.[\w.]+|[A-Za-z]:\\|Users[\\/]|192\.168\.", notice))

    def test_refuses_foreign_or_unsafe_folders(self):
        foreign = self.tmp / "not-ours"
        foreign.mkdir()
        (foreign / "keep.txt").write_text("x")
        with self.assertRaises(SystemExit):
            md.main(["--out", str(foreign)])
        self.assertTrue((foreign / "keep.txt").exists())
        with self.assertRaises(SystemExit):
            md.main(["--out", str(md.SITE)])


if __name__ == "__main__":
    unittest.main()
