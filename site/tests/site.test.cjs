// Stick kneeboard tests. Run from the site folder:  node --test tests/
// Reads the real exports in the parent folder (read-only) and the Python tool next door.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const SITE = path.resolve(__dirname, "..");
const ROOT = path.resolve(SITE, "..");             // Keybinding Mapping\ (Sal's exports)
const TOOL = path.join(ROOT, "tool");
const KB = require(path.join(SITE, "js", "core.js"));
require(path.join(SITE, "js", "slotmap.js"));
const SLOTMAP = globalThis.KBMAP_SLOTMAP;
const GENERATED = "TEST-STAMP";
const TIP_LINK = '<a href="https://www.buymeacoffee.com/mbtech" target="_blank" rel="noopener noreferrer">';

test("tip jar: a plain footer link on both pages, no widget, no script, nothing that loads it", () => {
  for (const page of ["index.html", "jd.html"]) {
    const html = fs.readFileSync(path.join(SITE, page), "utf8");
    const foot = html.slice(html.indexOf('<footer class="foot">'), html.indexOf("</footer>"));
    assert.equal(foot.split(TIP_LINK).length - 1, 1, `${page}: one tip link in the footer`);
    assert.equal(html.split("buymeacoffee").length - 1, 1, `${page}: the address appears only in that link`);
    assert.ok(!/BMC-Widget|cdnjs\.buymeacoffee|data-name="BMC/i.test(html), `${page}: no BMC widget`);
  }
  for (const f of shippedFiles().filter((f) => /\.(js|css|json)$/.test(f))) {
    assert.ok(!fs.readFileSync(f, "utf8").includes("buymeacoffee"), path.relative(SITE, f));
  }
});

// Sal's own JD exports when present (his machine); otherwise the SYNTHETIC sample (fixtures/jd-sample)
const REAL = fs.readdirSync(ROOT).some((n) => /VKBsim Gladiator EVO.*\.svg$/.test(n));
const EXPORTS = REAL ? ROOT : path.join(SITE, "tests", "fixtures", "jd-sample");
const onReal = { skip: REAL ? false : "needs Sal's real Joystick Diagrams exports (not in the repo)" };
function exportFiles(dir = EXPORTS) {
  return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".svg"))
    .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") }));
}
/** The shipped set: every file in site/ except what .publishignore lists (the one definition). */
function publishIgnore() {
  return fs.readFileSync(path.join(SITE, ".publishignore"), "utf8").split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}
function shippedFiles(dir = SITE, ignore = publishIgnore()) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(SITE, p).split(path.sep).join("/") + (e.isDirectory() ? "/" : "");
    if (ignore.includes(rel)) continue;
    if (e.isDirectory()) out.push(...shippedFiles(p, ignore));
    else out.push(p);
  }
  return out;
}

/** Python renders every device with the same fixed stamp; returns {device: svg}. */
function pythonSvgs(src = EXPORTS) {
  const code = [
    "import sys, json, pathlib",
    "sys.path.insert(0, sys.argv[1])",
    "import merge_diagrams as m",
    "devs = m.read_sources(pathlib.Path(sys.argv[2]), m.load_slotmap(pathlib.Path(sys.argv[1]) / 'slotmap.json'))",
    "out = {n: m.render_svg(d, sys.argv[3])[0] for n, d in devs.items()}",
    "sys.stdout.buffer.write(json.dumps(out).encode('utf-8'))",
  ].join("\n");
  const raw = execFileSync("python", ["-I", "-c", code, TOOL, src, GENERATED], { maxBuffer: 64 << 20 });
  return JSON.parse(raw.toString("utf8"));
}

test("slotmap.js matches tool/slotmap.json", () => {
  const json = JSON.parse(fs.readFileSync(path.join(TOOL, "slotmap.json"), "utf8"));
  assert.deepEqual(SLOTMAP, json);
});

test("parity: JS port renders byte-identical SVGs to the Python tool", () => {
  const py = pythonSvgs();
  const { devices, skipped } = KB.readSources(exportFiles(), SLOTMAP);
  assert.deepEqual(skipped, []);
  assert.deepEqual(devices.map((d) => d.name).sort(), Object.keys(py).sort());
  for (const dev of devices) {
    const js = KB.renderSvg(dev, GENERATED).svg;
    if (js !== py[dev.name]) {
      const a = js.split("\n"), b = py[dev.name].split("\n");
      const i = a.findIndex((l, k) => l !== b[k]);
      assert.fail(`${dev.name}: first difference at line ${i}\n JS: ${a[i]}\n PY: ${b[i]}`);
    }
  }
});

test("parity on disk: merged\\*.svg are byte-identical to the page's download for the same timestamp", onReal, () => {
  const { devices } = KB.readSources(exportFiles(), SLOTMAP);
  for (const dev of devices) {
    const file = path.join(ROOT, "merged", `${dev.name} - all modes.svg`);
    const disk = fs.readFileSync(file);
    const stamp = disk.toString("utf8").match(/ · generated ([^<]+)<\/text>/)[1];
    const js = Buffer.from(KB.renderSvg(dev, stamp).svg, "utf8");
    assert.ok(!disk.includes(0x0d), `${dev.name}: CR in merged file`);
    assert.ok(disk.equals(js), `${dev.name}: merged file differs from the page's output`);
  }
});

test("counts match QA's independent check (R 5 shown modes/38 binds/28 inputs, L 7/24/21)", onReal, () => {
  const { devices } = KB.readSources(exportFiles(), SLOTMAP);
  const by = Object.fromEntries(devices.map((d) => [d.side, KB.renderSvg(d, GENERATED).stats]));
  assert.deepEqual(by.R, { modes: 5, emptyModes: ["Spaceship mining"], binds: 38, inputs: 28 });
  assert.deepEqual(by.L, { modes: 7, emptyModes: [], binds: 24, inputs: 21 });
});

test("file order doesn't matter, non-JD files are skipped, unknown slots warn", () => {
  const files = exportFiles().reverse();
  files.push({ name: "notes.svg", text: "<svg/>" });
  const base = files.find((f) => f.name.includes("EVO R-Spaceship.svg"));
  files.push({ name: "02002-VKBsim Gladiator EVO R-Mining test.svg",
    text: base.text.replace('<rect x="555" y="163"', '<rect x="1" y="2"') });
  const { devices, skipped } = KB.readSources(files, SLOTMAP);
  assert.deepEqual(skipped, ["notes.svg"]);
  const r = devices.find((d) => d.side === "R");
  assert.ok(r.modes.includes("Mining test"));
  assert.ok(r.warnings.some((w) => w.includes("slot 1,2")));
  assert.equal(r.slots.get("1,2").binds.get("Mining test"), "Afterburner");
});

test("QA fixes carried over: 8px floor, tag fits, empty modes hidden", () => {
  assert.deepEqual(KB.fitInBox("Salvage increase beam spacing", 80, 13), [8, ["Salvage increase…"]]);
  assert.equal(KB.multiTag(3, 0), "");
  const { devices } = KB.readSources(exportFiles(), SLOTMAP);
  const r = KB.renderSvg(devices.find((d) => d.side === "R"), GENERATED).svg;
  assert.ok(r.includes(">Modes with no binds: Spaceship mining</text>"));
  assert.ok(!r.includes('data-mode="Spaceship mining"'));
});

test("cleanLabel / entities", () => {
  assert.equal(KB.cleanLabel("/"), "");
  assert.equal(KB.cleanLabel("/ Move"), "– / Move");
  assert.equal(KB.cleanLabel("Yaw /&#xa0;Pitch&#xa;"), "Yaw / Pitch");
  assert.equal(KB.cleanLabel("A &amp; B"), "A & B");
});

// ---------------------------------------------------------------- no network (Master condition 1)

test("no-network: the page ships no external URL, network API or remote font", () => {
  const banned = [
    [/\b(https?|wss?|ftp):\/\//i, "external URL"],
    [/(^|[^\w.])\/\/[a-z0-9-]+\.[a-z]/i, "protocol-relative URL"],
    [/\bfetch\s*\(/, "fetch()"],
    [/XMLHttpRequest/, "XMLHttpRequest"],
    [/WebSocket|EventSource|RTCPeerConnection/, "socket API"],
    [/sendBeacon/, "navigator.sendBeacon"],
    [/\bimport\s*\(/, "dynamic import"],
    [/importScripts|new\s+Worker|serviceWorker/, "worker"],
    [/@import|@font-face/, "CSS import / web font"],
    [/url\(\s*['"]?(?!data:)[^)'"]+/, "CSS url()"],
    [/<(iframe|object|embed|link\s+rel="(pre|dns-)?(connect|fetch|load)|base)\b/i, "remote-capable tag"],
    [/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/, "storage"],
  ];
  const problems = [];
  const files = shippedFiles();
  const rels = files.map((f) => path.relative(SITE, f).split(path.sep).join("/")).sort();
  // the scan covers exactly the shipped set, and that set is what we expect to publish
  assert.ok(rels.includes("index.html") && rels.some((r) => r.startsWith("css/")) &&
            rels.some((r) => r.startsWith("js/")) && rels.some((r) => r.startsWith("data/")), rels.join(", "));
  assert.ok(!rels.some((r) => r.startsWith("tests/") || r === "README.md"), "docs/tests must not ship");
  for (const f of files) {
    const rel = path.relative(SITE, f);
    const text = fs.readFileSync(f, "utf8");
    // strip /* */ and // comments in JS/CSS so prose in comments can't hide or fake a hit
    let code = /\.(js|css)$/.test(f) ? text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1") : text;
    // XML namespace identifiers (xmlns) are names, never fetched: the only allowed URL-shaped strings
    code = code.split('"http://www.w3.org/2000/svg"').join('""').split('"http://www.w3.org/1999/xlink"').join('""');
    // the tip-jar link (Master 2026-11-11: plain link, not the widget): a navigation the visitor clicks, never a
    // request. Allowed ONLY as this exact <a href>, in the pages' footers.
    code = code.split(TIP_LINK).join('<a href="" target="_blank" rel="noopener noreferrer">');
    for (const [re, what] of banned) if (re.test(code)) problems.push(`${rel}: ${what} (${code.match(re)[0]})`);
  }
  assert.deepEqual(problems, []);
});

for (const page of ["index.html", "jd.html"])
test(`no-network: ${page}'s CSP blocks every request type the page doesn't need`, () => {
  const html = fs.readFileSync(path.join(SITE, page), "utf8");
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, "CSP meta missing");
  const csp = Object.fromEntries(m[1].split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]));
  assert.equal(csp["default-src"], "'none'");
  assert.equal(csp["connect-src"], "'none'");
  assert.equal(csp["script-src"], "'self'");
  assert.equal(csp["style-src"], "'self'");
  assert.equal(csp["font-src"], "'self'");
  assert.equal(csp["img-src"], "'self' blob: data:");
  assert.equal(csp["form-action"], "'none'");
  // every script/stylesheet is a relative local file
  for (const [, src] of html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)) {
    assert.ok(!/^[a-z]+:|^\/\//i.test(src), src);
    assert.ok(fs.existsSync(path.join(SITE, src)), src);
  }
  assert.ok(!/<script>(?!<\/script>)|<style>|\son[a-z]+="/i.test(html), "inline script/style/handler");
});

test("shareable output carries no personal info (AC9)", () => {
  const bad = /[A-Za-z]:[\\/]|\\\\|Users[\\/]|file:\/|192\.168\.|@[a-z0-9-]+\.[a-z]/i;
  const { devices } = KB.readSources(exportFiles(), SLOTMAP);
  for (const d of devices) {
    const s = KB.renderSvg(d, GENERATED).svg.replace(/<image\b[^>]*\/>/g, "").split("http://www.w3.org/").join("");
    assert.equal(bad.exec(s), null, d.name);
  }
});

test("the test run itself left the exports untouched", () => {
  // the suite only reads; prove nothing in the export folder is newer than the start of this run
  const start = Date.now() - process.uptime() * 1000;
  for (const n of fs.readdirSync(ROOT)) {
    const st = fs.statSync(path.join(ROOT, n));
    if (st.isFile()) assert.ok(st.mtimeMs < start, n);
  }
});
