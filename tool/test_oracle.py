"""Stage B resolver + oracle gate tests.   python -m unittest -v test_oracle

The oracle test reads Sal's newest export from the game folder (read-only) and is skipped when the
game folder or the data file isn't there (e.g. on another machine)."""
import json
import re
import unittest
from pathlib import Path

import oracle_diff
import resolve_binds as rb

HERE = Path(__file__).resolve().parent
MAPPINGS = Path(r"C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\user\client\0\Controls\Mappings")
DATA = sorted((HERE.parent / "site" / "data").glob("sc-controls-*.json"))

EXPORT = """<ActionMaps>
 <options type="joystick" instance="1" Product=" VKBsim Gladiator EVO L    {00000000-0000-0000-0000-000000000000}"/>
 <options type="joystick" instance="2" Product=" VKBsim Gladiator EVO R    {00000000-0000-0000-0000-000000000000}"/>
 <options type="keyboard" instance="1" Product="Keyboard  {00000000-0000-0000-0000-000000000000}"/>
 <actionmap name="spaceship_movement">
  <action name="v_afterburner"><rebind input="js2_button6"/></action>
  <action name="v_pitch"><rebind input="js2_y"/></action>
  <action name="v_strafe_up"><rebind input="js1_ "/></action>
  <action name="v_mod"><rebind input="js2_rctrl+button3" activationMode="double_tap"/><rebind input="kb1_f"/></action>
 </actionmap>
</ActionMaps>"""
DATA_MINI = {"actionmaps": [{"name": "spaceship_movement", "actions": [
    {"name": "v_afterburner", "label": "Boost", "joystick": ["button8"]},
    {"name": "v_pitch", "label": "Pitch", "joystick": ["y"]},
    {"name": "v_strafe_up", "label": "Strafe Up", "joystick": ["button9"]},
    {"name": "v_roll", "label": "Roll", "joystick": ["rotz"]},
    {"name": "v_mod", "label": None},
]}]}


class ResolverRules(unittest.TestCase):
    def setUp(self):
        self.export = rb.parse_export(EXPORT)
        self.full = rb.resolve_full(self.export, DATA_MINI)

    def test_devices_and_privacy(self):
        self.assertEqual(self.export["devices"], {1: "VKBsim Gladiator EVO L", 2: "VKBsim Gladiator EVO R"})
        self.assertIsNone(re.search(r"{[0-9A-Fa-f-]{36}}", json.dumps(self.full)))   # no device GUIDs in the output

    def test_one_joystick_slot_per_action(self):
        got = {(b["action"], b["instance"], b["input"], b["source"]) for b in self.full}
        self.assertIn(("v_afterburner", 2, "button6", "rebind"), got)
        self.assertNotIn(("v_afterburner", 1, "button8", "default"), got)  # moved to js2: default gone
        self.assertNotIn(("v_pitch", 1, "y", "default"), got)
        self.assertNotIn(("v_strafe_up", 1, "button9", "default"), got)    # blank = explicit unbind
        self.assertIn(("v_roll", 1, "rotz", "default"), got)               # untouched: default on js1

    def test_modifier_activation_and_fallback_label(self):
        m = [b for b in self.full if b["action"] == "v_mod"]
        self.assertEqual(len(m), 1)                                         # kb1 rebind ignored
        self.assertEqual((m[0]["modifier"], m[0]["input"], m[0]["activation"], m[0]["label"]),
                         ("rctrl", "button3", "double_tap", "Mod"))

    def test_keyboard_split_is_order_independent(self):
        """QA C D1: the key is the non-modifier token whatever the order (7 game defaults put it first)."""
        self.assertEqual(rb.split_keys("u+lshift"), (["lshift"], "u"))
        self.assertEqual(rb.split_keys("f6+lalt"), (["lalt"], "f6"))
        self.assertEqual(rb.split_keys("rctrl+rshift+1"), (["rctrl", "rshift"], "1"))
        self.assertEqual(rb.split_keys("lalt"), ([], "lalt"))
        self.assertEqual(rb.split_keys("]"), ([], "rbracket"))

    def test_slot_names(self):
        self.assertEqual(rb.slot_name("button23"), "Button 23")
        self.assertEqual(rb.slot_name("hat1_left"), "Hat ←")
        self.assertEqual(rb.slot_name("rotz"), "Z axis (twist)")
        self.assertIsNone(rb.slot_name("slider1"))


REAL_JD = any(HERE.parent.glob("*VKBsim Gladiator EVO*.svg"))


@unittest.skipUnless(MAPPINGS.exists() and DATA and REAL_JD, "needs the game folder, the data file and Sal's real JD exports")
class OracleGate(unittest.TestCase):
    def test_gate_passes_on_newest_export(self):
        import tempfile
        newest = max(MAPPINGS.glob("*.xml"), key=lambda p: p.stat().st_mtime)
        out = Path(tempfile.mkdtemp(prefix="kbmap-oracle-"))     # the report names the export file: never in the tree
        code = oracle_diff.main(["--xml", str(newest), "--data", str(DATA[-1]), "--out", str(out)])
        report = json.loads((out / "oracle-report.json").read_text(encoding="utf-8"))
        self.assertEqual(code, 0, report)
        self.assertTrue(report["stage1"]["pass"])
        self.assertEqual(report["stage1"]["compared"], 62)
        self.assertEqual(report["stage2"]["unexplained"], [])


if __name__ == "__main__":
    unittest.main()
