// Stage B tests: node --test tests/   (from the site folder)
// Uses Sal's newest export from the game folder (read-only) when present; skips those tests elsewhere.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SITE = path.resolve(__dirname, "..");
const TOOL = path.resolve(SITE, "..", "tool");
require(path.join(SITE, "data", "sc-controls.js"));
require(path.join(SITE, "data", "vkb-templates.js"));
const R = require(path.join(SITE, "js", "resolve.js"));
const V = require(path.join(SITE, "js", "vkb.js"));
const M = require(path.join(SITE, "js", "modes.js"));
const DATA = globalThis.KBMAP_CONTROLS, VKB = globalThis.KBMAP_VKB;

// The sanitised fixture: Sal's real export with the device GUIDs zeroed and the profile name set to
// "example"; every bind identical. Runs anywhere (the repo, CI) without the game installed.
const newest = path.join(SITE, "tests", "fixtures", "example-export.xml");
const onSal = {};
const SAL = { R: { inst: 2, key: "SCG-RH" }, L: { inst: 1, key: "SCG-OTA-LH" } };

function salCards(defaultInst = 1) {
  const exp = R.parseExport(fs.readFileSync(newest, "utf8"));
  const all = R.resolveFull(exp, DATA, defaultInst);
  const out = {};
  for (const [side, s] of Object.entries(SAL)) {
    const binds = all.filter((b) => b.instance === s.inst && b.ui);
    out[side] = { binds, card: V.renderCard({ template: VKB.templates[s.key], fieldmap: VKB.fieldmap, art: "data:image/jpeg;base64,AA==",
      binds, view: "all", device: exp.devices.get(s.inst), gameVersion: DATA.meta.version, generated: "T" }) };
  }
  return { exp, all, out };
}

test("generated site data matches its JSON sources", () => {
  const ctl = fs.readdirSync(path.join(SITE, "data")).find((n) => /^sc-controls-.*\.json$/.test(n));
  assert.deepEqual(DATA, JSON.parse(fs.readFileSync(path.join(SITE, "data", ctl), "utf8")));
  assert.deepEqual(VKB, JSON.parse(fs.readFileSync(path.join(SITE, "data", "vkb-templates.json"), "utf8")));
  const fmap = JSON.parse(fs.readFileSync(path.join(TOOL, "vkb_fieldmap.json"), "utf8")).fields;
  assert.deepEqual(VKB.fieldmap, fmap, "site fieldmap is stale: re-run extract_vkb_boxes.py");
});

test("parser: comments, self-closing tags, entities, keyboard ignored, GUID dropped", () => {
  const e = R.parseExport(`<ActionMaps><!-- <rebind input="js1_button99"/> -->
    <options type="joystick" instance="3" Product=" Thing &amp; Co R   {00000000-0000-0000-0000-000000000000}"/>
    <actionmap name="a"><action name="x"/><action name="y"><rebind input="kb1_f"/><rebind input="js3_button4" activationMode="double_tap"/></action></actionmap>
  </ActionMaps>`);
  assert.deepEqual([...e.devices], [[3, "Thing & Co R"]]);
  assert.deepEqual(e.rebinds, [{ actionmap: "a", action: "y", instance: 3, raw: "button4", activation: "double_tap" }]);
  assert.throws(() => R.parseExport("<notit/>"));
});

test("parity: JS resolver == Python resolve_full on Sal's newest export (defaults on js1, then js2)", onSal, () => {
  const code = [
    "import sys, json", "sys.path.insert(0, sys.argv[1])", "import resolve_binds as rb",
    "e = rb.parse_export(open(sys.argv[2], encoding='utf-8').read())",
    "d = json.load(open(sys.argv[3], encoding='utf-8'))",
    "out = {k: rb.resolve_full(e, d, k) for k in ('1', '2')}",
    "sys.stdout.buffer.write(json.dumps(out).encode('utf-8'))"].join("\n");
  const ctl = fs.readdirSync(path.join(SITE, "data")).find((n) => /^sc-controls-.*\.json$/.test(n));
  const py = JSON.parse(execFileSync("python", ["-I", "-c", code, TOOL, newest, path.join(SITE, "data", ctl)], { maxBuffer: 32 << 20 }).toString("utf8"));
  const exp = R.parseExport(fs.readFileSync(newest, "utf8"));
  const key = (b) => [b.device, b.instance, b.actionmap, b.action, b.input, b.label, b.source, b.modifier, b.activation].join("|");
  for (const k of ["1", "2"]) {
    const js = R.resolveFull(exp, DATA, Number(k)).map(key).sort();
    assert.deepEqual(js, py[k].map(key).sort(), `defaults on js${k}`);
  }
});

test("Sal's cards: every shown bind listed once, 4 gameplay defaults, 15 menu defaults hidden, 0 off the picture", onSal, () => {
  const { all, out } = salCards(1);
  const hidden = all.filter((b) => !b.ui);
  assert.equal(hidden.length, 15);
  assert.ok(hidden.every((b) => b.source === "default"));
  const defaults = all.filter((b) => b.ui && b.source === "default").map((b) => b.action).sort();
  assert.deepEqual(defaults, ["v_autoland", "v_toggle_mining_laser_fire", "v_weapon_preset_attack", "weapon_change_mining_throttle"]);
  for (const [side, { binds, card }] of Object.entries(out)) {
    assert.equal(card.stats.offPicture, 0, side);
    assert.equal(card.stats.view, "all");
    for (const b of binds) {
      const tag = `data-mode="${M.modeOf(b.actionmap).name}" data-map="${b.actionmap}" data-action="${b.action}"`;
      const n = card.svg.split(tag).length - 1;
      assert.ok(n >= 1, `${side}: ${b.action} on ${b.input} missing from the list`);
    }
    // each (input, actionmap, action) appears exactly once in the list; the same action id can live in
    // two actionmaps (v_pitch in Flight and Ground vehicle), and those are two binds
    const listed = [...card.svg.matchAll(/<g class="entry" data-input="([^"]+)">([\s\S]*?)<\/g>/g)]
      .flatMap((m) => [...m[2].matchAll(/data-map="([^"]+)" data-action="([^"]+)"/g)].map((a) => `${m[1]}|${a[1]}|${a[2]}`));
    assert.equal(new Set(listed).size, listed.length, `${side}: duplicate list entries`);
    assert.equal(listed.length, binds.length, side);
  }
  assert.equal(out.R.card.stats.binds + out.L.card.stats.binds, 86);
});

test("rows: 8px floor at the default card width, button number on every numbered field, no foreignObject", onSal, () => {
  const { out } = salCards(1);
  for (const [side, { card }] of Object.entries(out)) {
    assert.ok(card.stats.minRowFontPxAtDefault >= 8, `${side}: ${card.stats.minRowFontPxAtDefault}px`);
    assert.ok(!card.svg.includes("foreignObject"));
    for (const [name, f] of Object.entries(VKB.fieldmap)) {
      const box = VKB.templates[SAL[side].key].fields[name];
      if (!box || !box.num || !f.input) continue;
      const num = /^button(\d+)$/.test(f.input) ? f.input.slice(6) : "POV";
      const cx = Math.round((box.num[0] + box.num[2]) / 2 * 100) / 100;
      assert.ok(card.svg.includes(`<text x="${cx}"`) && card.svg.includes(`>${num}</text>`), `${side} ${name}: number ${num}`);
    }
  }
});

test("fitRow: up to 3 stacked lines, then +N; never below the floor; text + dots fit the box", () => {
  const TW = require(path.join(SITE, "js", "core.js")).textWidth;
  const e = (label, i) => ({ label, source: "rebind", mode: M.MODES[i % M.MODES.length] });
  const w = 176.6, h = 15.7;
  for (let n = 1; n <= 6; n++) {
    const fit = V.fitRow(Array.from({ length: n }, (_, i) => e(`Weapon Presets - Set Quantum Snares / Pulse (long range) ${i}`, i)), w, h);
    assert.ok(fit.font >= V.FLOOR_PT - 1e-9, `n=${n}: ${fit.font}pt`);
    assert.ok(fit.lines.length <= 3);
    if (n <= 3) assert.equal(fit.more, 0); else assert.equal(fit.more, n - 2);
    for (const ln of fit.lines) {
      const dots = ln.dots.length ? ln.dots.length * fit.font * 0.78 + fit.font * 0.25 : 0;
      assert.ok(TW(ln.text, fit.font) + dots <= w - 3.5 + 1e-9, ln.text);
    }
  }
});

test("fitRow: identical labels merge into one line with one dot per mode (QA B: 'Boost | Boost')", () => {
  const fl = M.MODES.find((m) => m.id === "flight"), gv = M.MODES.find((m) => m.id === "ground");
  const fit = V.fitRow([{ label: "Boost", source: "rebind", mode: fl }, { label: "Boost", source: "rebind", mode: gv },
                        { label: "Spacebrake", source: "rebind", mode: fl }], 176.6, 15.7);
  assert.equal(fit.lines.length, 2);
  assert.deepEqual(fit.lines[0].dots, [fl.colour, gv.colour]);
  assert.equal(fit.lines[0].colour, "#222222");                  // several modes: neutral text, the dots carry colour
  assert.deepEqual(fit.lines[1].dots, [fl.colour]);
  assert.equal(fit.lines[1].colour, fl.colour);                  // one mode: its colour + its dot
});

test("guessed names are flagged with ? in rows and list, with a footnote; nothing dropped (QA B)", onSal, () => {
  const { all, out } = salCards(1);
  const guessed = all.filter((b) => b.ui && b.guessed).map((b) => b.action).sort();
  assert.deepEqual(guessed, ["v_invoke_docking", "v_toggle_docking_mode", "weapon_change_mining_throttle"]);
  assert.match(out.R.card.svg, />Invoke docking \?</);
  assert.match(out.R.card.svg, /\? name guessed: this game version's data has no name for these actions \(v_invoke_docking, v_toggle_docking_mode\)/);
  assert.match(out.L.card.svg, /Weapon change mining throttle \? †/);
  assert.ok(out.R.card.listData.blocks.some((b) => b.entries.some((e) => e.tags.includes("name guessed"))));
});

test("axis list titles are one clean title (QA B)", onSal, () => {
  const { out } = salCards(1);
  const heads = out.R.card.listData.blocks.map((b) => b.head).filter((h) => /axis/i.test(h));
  assert.deepEqual(heads, ["Stick X axis", "Stick Y axis", "Twist axis", "Throttle axis", "Ministick X axis (analog)", "Ministick Y axis (analog)"]);
  assert.ok(!out.R.card.svg.includes("· Axes"));
});

test("card vs list: page-only SVG per card, list data keyed by input, '+N more' rows located (UAT 1)", onSal, () => {
  const { out } = salCards(1);
  for (const [side, { card }] of Object.entries(out)) {
    assert.match(card.pageSvg, /viewBox="0 0 792 612"/, side);
    assert.ok(!card.pageSvg.includes("Every bind, in full"), side);
    assert.equal(card.listData.blocks.length, card.stats.inputs, side);
    assert.ok(card.listData.blocks.every((b) => b.input), side);
    assert.equal(card.links.length, card.stats.overflowRows, side);
    for (const l of card.links) {
      assert.ok(card.listData.blocks.some((b) => b.input === l.input), `${side}: link ${l.input} has a list block`);
      assert.ok(l.rect[2] > l.rect[0] && l.rect[3] > l.rect[1] && l.more > 0);
    }
  }
  assert.deepEqual(out.L.card.links.map((l) => l.input).sort(), ["button1", "button22"]);
});

test("print + downloads follow the list toggle; list collapsed by default; chrome hidden (UAT 1)", () => {
  const css = fs.readFileSync(path.join(SITE, "css", "kneeboard.css"), "utf8");
  const print = css.slice(css.indexOf("@media print"));
  for (const sel of [".placard", ".bay-col", ".card-bar", ".foot", "details.binds > summary", ".hotspots"]) assert.ok(print.includes(sel), sel);
  assert.match(print, /@page \{ size: letter landscape/);
  assert.match(print, /\.card-built \+ \.card-built \{ break-before: page/);
  assert.match(print, /details\.binds\[open\] \{ break-before: page/);
  const app = fs.readFileSync(path.join(SITE, "js", "app.js"), "utf8");
  assert.match(app, /printBtn\.addEventListener\("click", \(\) => window\.print\(\)\)/);
  assert.match(app, /el\("details", \{ class: "binds" \}/);                 // collapsed: no "open" attribute set
  assert.ok(!/details[^\n]*open: ""/.test(app));
  assert.match(app, /const downloadSvg = \(\) => \(withList\(\) \|\| !c\.result\.pageSvg \? c\.result\.svg : c\.result\.pageSvg\);/);
  assert.match(app, /img\.src = blobUrl\(result\.pageSvg \|\| result\.svg/);  // the card shows the picture only
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  assert.match(html, /connected first \(js1\)/);
});

test("downloads carry no source filename, profile name, GUID or path (Master 2026-11-11)", onSal, () => {
  const xml = fs.readFileSync(newest, "utf8");
  const profile = (xml.match(/profileName="([^"]+)"/) || [])[1];
  const guids = [...xml.matchAll(/\{([0-9A-F-]{36})\}/gi)].map((m) => m[1]);
  assert.ok(profile && guids.length, "fixture has a profile name and GUIDs to look for");
  const banned = [path.basename(newest), path.basename(newest, ".xml"), profile, ...guids, "layout_", "_exported", "Mappings", "LIVE\\user"];
  const { out } = salCards(1);
  for (const [side, { card }] of Object.entries(out)) {
    for (const b of banned) assert.ok(!card.svg.includes(b), `${side}: ${b} leaked into the card`);
    const text = card.svg.replace(/href="data:[^"]+"/g, "").split("http://www.w3.org/").join("");
    assert.equal(/[A-Za-z]:[\\/]|Users[\\/]|file:\/|192\.168\./i.exec(text), null, side);
  }
  // the page names downloads after the device + view only
  const app = fs.readFileSync(path.join(SITE, "js", "app.js"), "utf8");
  assert.match(app, /const fileBase = \(\) => `\$\{slug\(c\.device\)\} - \$\{viewLabel\(c\.view\)\}\$\{withList\(\) \? " \+ list" : ""\}`;/);
  assert.match(app, /const viewLabel = \(v\) => \(v === "all" \? "all modes" : \(\(M\.MODES\.find\(\(m\) => m\.id === v\) \|\| \{\}\)\.name \|\| v\)\);/);
});

test("no-art copy: list card says 'No picture in this copy'; the grip picker offers no VKB grips (Master 2026-11-11)", () => {
  const common = { binds: [], view: "all", device: "VKBsim Gladiator EVO R", gameVersion: "x", generated: "T" };
  assert.match(V.renderListCard({ ...common, noArt: true }).svg, />No picture in this copy: every bind is listed below\./);
  assert.match(V.renderListCard({ ...common, noArt: false }).svg, />No picture for this device yet: every bind is listed below\./);
  const app = fs.readFileSync(path.join(SITE, "js", "app.js"), "utf8");
  assert.match(app, /const artAvailable = !!\(await loadArt\(Object\.keys\(VKB\.templates\)\[0\]\)\);/);
  assert.match(app, /if \(!state\.artAvailable\) break;/);
  assert.match(app, /grip: artAvailable && isVkb\(device\) && side \? defaultGrip\(side\) : "list"/);
  assert.match(app, /"List only \(pictures not included in this copy\)"/);
  assert.match(app, /c\.noArt = c\.grip !== "list" \? !art : \(!state\.artAvailable && isVkb\(c\.device\) && !!c\.side\);/);
});

test("default-stick toggle moves the game defaults to the other stick", onSal, () => {
  const a = salCards(1).all.filter((b) => b.source === "default" && b.ui);
  const b = salCards(2).all.filter((b) => b.source === "default" && b.ui);
  assert.ok(a.every((x) => x.instance === 1) && b.every((x) => x.instance === 2));
  assert.equal(a.length, b.length);
});

test("modes: every actionmap in the game data has a mode; colours unique", () => {
  for (const am of DATA.actionmaps) assert.ok(M.modeOf(am.name), am.name);
  assert.equal(new Set(M.MODES.map((m) => m.colour)).size, M.MODES.length);
});
