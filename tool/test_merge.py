"""Tests for merge_diagrams.py, written from the job's acceptance criteria.

Run:  python -m unittest -v test_merge   (from this folder)

Every test writes to a temp folder. The real source folder is only read, and
its files are hashed before and after to prove it (AC3).
"""
import hashlib
import html
import re
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import merge_diagrams as md

SLOTMAP = md.load_slotmap(md.HERE / "slotmap.json")
# Sal's own Joystick Diagrams exports when they're here (his machine); otherwise the SYNTHETIC sample
# (site/tests/fixtures/jd-sample, made by make-jd-sample.cjs) so the tests run anywhere, e.g. from the repo.
REAL = any(md.HERE.parent.glob("*VKBsim Gladiator EVO*.svg"))
SRC = md.HERE.parent if REAL else md.HERE.parent / "site" / "tests" / "fixtures" / "jd-sample"
EXPECT = {
    "files": 26 if REAL else 11,
    "R": ["Spaceship", "Spaceship mining", "Spaceship salvage", "Turrets", "Vehicle", "Weapons"] if REAL
         else ["Spaceship", "Spaceship mining", "Spaceship salvage", "Vehicle", "Weapons"],
    "L": ["Fps", "General", "Spaceship", "Spaceship salvage", "Spaceship scanning", "Vehicle", "Weapons"] if REAL
         else ["Fps", "General", "Spaceship", "Spaceship salvage", "Vehicle", "Weapons"],
    "R_shown": 5 if REAL else 4,
}


def source_binds():
    """(device, mode, label) for every non-empty bind slot, read independently of the tool."""
    out = set()
    for p in sorted(SRC.glob("*.svg")):
        m = md.FILE_RE.match(p.name)
        if not m:
            continue
        dev, mode = m.group("device").strip(), m.group("mode").strip()
        side = dev.split()[-1]
        for x, y, w, h, raw in md.SLOT_RE.findall(p.read_text(encoding="utf-8")):
            key = f"{md.fmt(float(x))},{md.fmt(float(y))}"
            if isinstance(SLOTMAP[side].get(key), str):
                continue
            label = md.clean_label(raw)
            if label:
                out.add((dev, mode, label))
    return out


def hashes(folder: Path):
    """Sal's Joystick Diagrams exports only (*.svg / *.png in the project root). Other root files
    (LICENSE, NOTICE) are ours and aren't what this guard protects."""
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.iterdir()
            if p.is_file() and p.suffix.lower() in (".svg", ".png")}


class MergeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = hashes(SRC)
        cls.tmp = Path(tempfile.mkdtemp(prefix="kbmap-test-"))
        cls.out = cls.tmp / "merged"
        cls.logs = []
        cls.devices = md.run(SRC, cls.out, png=True, log=lambda *a: cls.logs.append(" ".join(map(str, a))))
        cls.after = hashes(SRC)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def svg(self, dev):
        return (self.out / f"{dev} - all modes.svg").read_text(encoding="utf-8")

    # T3 / AC1
    def test_exactly_four_outputs(self):
        names = sorted(p.name for p in self.out.iterdir())
        self.assertEqual(names, sorted(f"VKBsim Gladiator EVO {s} - all modes.{e}" for s in "LR" for e in ("png", "svg")))

    # T2 / AC3
    def test_sources_untouched(self):
        self.assertEqual(self.before, self.after)
        self.assertEqual(len([n for n in self.before if n.endswith(".svg")]), EXPECT["files"] // (2 if REAL else 1))

    def test_refuses_to_write_into_source(self):
        with self.assertRaises(SystemExit):
            md.run(SRC, SRC, png=False, log=lambda *a: None)

    # T1 / AC2
    def test_every_bind_present_once(self):
        expected = source_binds()
        got = set()
        for dev in self.devices.values():
            for s in dev.slots.values():
                for mode, label in s.binds.items():
                    got.add((dev.name, mode, label))
        self.assertEqual(expected, got)
        # ...and each one appears exactly once in the panel text of the SVG, under its mode
        for dev_name, mode, label in expected:
            pat = re.escape(f'data-mode="{html.escape(mode, quote=True)}">{html.escape(label, quote=False)}<tspan')
            n = len(re.findall(pat, self.svg(dev_name)))
            self.assertEqual(n, 1, (dev_name, mode, label))

    def test_modes_detected(self):
        r = self.devices["VKBsim Gladiator EVO R"].modes
        l = self.devices["VKBsim Gladiator EVO L"].modes
        self.assertEqual(sorted(r), sorted(EXPECT["R"]))
        self.assertEqual(sorted(l), sorted(EXPECT["L"]))

    def test_no_unmapped_slots(self):
        self.assertEqual([l for l in self.logs if l.startswith("WARNING")], [])

    # T4 / AC4
    def test_svg_is_plain(self):
        for dev in self.devices:
            raw = (self.out / f"{dev} - all modes.svg").read_bytes()
            self.assertNotIn(b"\r", raw)                 # LF only, same bytes as the site's download
            text = self.svg(dev)
            self.assertNotIn("foreignObject", text)
            ET.fromstring(text.encode("utf-8"))   # well-formed XML

    def test_png_valid_and_2x(self):
        for dev in self.devices:
            text = self.svg(dev)
            w, h = (int(v) for v in re.search(r'viewBox="0 0 (\d+) (\d+)"', text).groups())
            self.assertEqual(md.png_size(self.out / f"{dev} - all modes.png"), (2 * w, 2 * h))

    # T5 / AC5
    def test_single_mode_text_fits(self):
        for dev in self.devices.values():
            for s in dev.slots.values():
                if len(s.binds) == 1:
                    size, lines = md.fit_in_box(next(iter(s.binds.values())), s.w, s.h)
                    self.assertEqual(len(lines), 1, s.name)
                    self.assertGreaterEqual(size, 8, (dev.name, s.name))   # D3: 8px floor
                    for ln in lines:
                        self.assertLessEqual(md.text_width(ln, size), s.w - 4, (dev.name, s.name, ln))

    # AC9: shareable output carries no personal info (paths, user/machine names, LAN IPs)
    def test_no_personal_info(self):
        bad = re.compile(r'[A-Za-z]:[\\/]|\\\\|Users[\\/]|file:/|192\.168\.|@[a-z0-9-]+\.[a-z]', re.I)
        for dev in self.devices:
            text = re.sub(r'<image\b[^>]*/>', '', self.svg(dev))
            text = text.replace("http://www.w3.org/", "")
            self.assertIsNone(bad.search(text), bad.search(text) and text[bad.search(text).start() - 40:][:80])

    # D2: a mode with no real binds (R "Spaceship mining") is hidden from legend + lists, named in the footer
    def test_empty_mode_hidden(self):
        r = self.svg("VKBsim Gladiator EVO R")
        self.assertNotIn('font-weight="bold">Spaceship mining</text>', r)
        self.assertNotIn('data-mode="Spaceship mining"', r)
        self.assertIn(">Modes with no binds: Spaceship mining</text>", r)
        self.assertIn(f">{EXPECT['R_shown']} modes ·", r)
        self.assertNotIn("Modes with no binds", self.svg("VKBsim Gladiator EVO L"))

    # D4: the multi-mode tag never runs past its box
    def test_multi_tag_fits(self):
        for dev in self.devices.values():
            for s in dev.slots.values():
                n = len(s.binds)
                if n > 1:
                    tx = s.x + 6 + (n - 1) * 8 + 3.2 + 3
                    tag = md.multi_tag(n, s.x + s.w - 3 - tx)
                    self.assertLessEqual(md.text_width(tag, 8.5), s.x + s.w - 3 - tx, (dev.name, s.name))
        self.assertEqual(md.multi_tag(3, 1000), "3 modes ▸ list")
        self.assertEqual(md.multi_tag(3, 0), "")

    # T7 / AC6
    def test_mode_colours_consistent(self):
        def colours(dev):
            return dict(re.findall(r'fill="(#[0-9a-f]{6})" font-weight="bold">([^<]+)</text>', self.svg(dev)))
        r = {m: c for c, m in colours("VKBsim Gladiator EVO R").items()}
        l = {m: c for c, m in colours("VKBsim Gladiator EVO L").items()}
        self.assertGreaterEqual(len(set(r) & set(l)), 4)   # Spaceship, salvage, Vehicle, Weapons
        for mode in set(r) & set(l):
            self.assertEqual(r[mode], l[mode], mode)
        self.assertEqual(len(set(md.mode_colours(md.MODE_COLOURS).values())), len(md.MODE_COLOURS))


class NewModeAndSlotTests(unittest.TestCase):
    # T6 / AC7
    def test_new_mode_file_and_unknown_slot(self):
        tmp = Path(tempfile.mkdtemp(prefix="kbmap-test-"))
        try:
            src = tmp / "src"
            src.mkdir()
            base = "02002-VKBsim Gladiator EVO R-Spaceship.svg"
            shutil.copy(SRC / base, src / base)
            text = (SRC / base).read_text(encoding="utf-8")
            # a new mode, plus one slot moved to coordinates the map doesn't know
            text = text.replace('<rect x="555" y="163"', '<rect x="1" y="2"', 1)
            (src / "02002-VKBsim Gladiator EVO R-Mining test.svg").write_text(text, encoding="utf-8")
            logs = []
            devs = md.run(src, tmp / "out", png=False, log=lambda *a: logs.append(" ".join(map(str, a))))
            dev = devs["VKBsim Gladiator EVO R"]
            self.assertIn("Mining test", dev.modes)
            self.assertTrue(any("slot 1,2" in l and l.startswith("WARNING") for l in logs), logs)
            self.assertEqual(dev.slots["1,2"].binds, {"Mining test": "Afterburner"})
            self.assertIn("Mining test", (tmp / "out" / "VKBsim Gladiator EVO R - all modes.svg").read_text(encoding="utf-8"))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_clean_label(self):
        self.assertEqual(md.clean_label("/"), "")
        self.assertEqual(md.clean_label("/ Move"), "– / Move")
        self.assertEqual(md.clean_label("Yaw /&#xa0;Pitch&#xa;"), "Yaw / Pitch")


if __name__ == "__main__":
    unittest.main()
