// TEST ONLY: writes a small SYNTHETIC set of Joystick Diagrams-style exports into fixtures/jd-sample/.
// Same file names and SVG slot structure as JD 2.3.0's VKB Gladiator NXT exports, real slot geometry from
// tool/slotmap.json, a 1x1 placeholder image instead of JD's art, and made-up-but-realistic labels chosen to
// exercise every merge rule (an empty mode, a long label, a 3-mode slot, "– / Move", shared modes).
// It lets the Stage A tests run anywhere (the repo has no real exports).   node tests/fixtures/make-jd-sample.cjs
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const SLOTMAP = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "tool", "slotmap.json"), "utf8"));
const OUT = path.join(__dirname, "jd-sample");
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// slot sizes as JD's NXT templates have them (per side)
function size(side, key, info) {
  if (info === "#mode" || info === "#title") return [164, 20];
  if (info === "#credit") return [220, 30];
  const name = info.name;
  if (name === "X / Y axis") return side === "R" ? [100, 13] : [96, 13];
  if (name === "Z axis (twist)") return [99, 13];
  if (name.startsWith("Hat") && side === "R") return [81, 12];
  return [80, 13];
}
const AXIS_EMPTY = " /&#xa0;&#xa;";
const FILES = {
  R: { id: "02002", title: "VKB Gladiator NXT - Right", modes: {
    "Spaceship": { "555,163": "Afterburner", "715,95": "Tractor dist +", "393,96": "Pitch up",
                   "715,112": "Light amplification toggle", "575,691": "Yaw /&#xa0;Pitch&#xa;", "716,691": "Roll&#xa;" },
    "Weapons": { "715,95": "Weapon increase max missiles", "895,333": "Weapon toggle launch missile", "575,691": AXIS_EMPTY },
    "Spaceship mining": { "575,691": AXIS_EMPTY },                                     // a mode with no real binds
    "Spaceship salvage": { "715,95": "Beam vehicle increase distance", "895,333": "Salvage toggle fire right", "575,691": AXIS_EMPTY },
    "Vehicle": { "555,163": "Boost", "575,691": "Yaw /&#xa0;Pitch&#xa;" },
  } },
  L: { id: "02012", title: "VKB Gladiator NXT - Left", modes: {
    "Spaceship": { "294,98": "Master mode cycle", "233,370": "View cycle fwd", "495,679": "Strafe lateral /&#xa0;Strafe long.&#xa;" },
    "Fps": { "232,234": "Flashlight", "495,679": AXIS_EMPTY },
    "General": { "232,234": "Lights" },
    "Spaceship salvage": { "554,149": "Salvage increase beam spacing", "214,319": "Salvage toggle fire left" },
    "Vehicle": { "214,319": "Horn", "495,679": "/&#xa0;Move&#xa;" },
    "Weapons": { "193,285": "Weapon preset qid pulse" },
  } },
};

function svg(side, mode, binds) {
  const f = FILES[side];
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- SYNTHETIC test fixture in the shape of a Joystick Diagrams export; not a real export -->',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="1159px" height="807px" viewBox="-0.5 -0.5 1159 807"><defs/><g>',
    `<image x="75.5" y="60" width="1008" height="685" xlink:href="data:image/png;base64,${PNG_1x1}"/>`,
  ];
  for (const [key, info] of Object.entries(SLOTMAP[side])) {
    if (key.startsWith("_")) continue;
    const [x, y] = key.split(",").map(Number);
    const [w, h] = size(side, key, info);
    const label = info === "#mode" ? mode : info === "#title" ? f.title : info === "#credit" ? "github.com/Rexeh/joystick-diagrams" : (binds[key] || "");
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="none"/><g transform="translate(-0.5 -0.5)"><switch>` +
      `<foreignObject pointer-events="none" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${label}</div></foreignObject>` +
      `<text x="${x + w / 2}" y="${y + h / 2 + 4}" fill="rgb(0, 0, 0)" font-family="Helvetica" font-size="12px" text-anchor="middle">${label}</text></switch></g>`);
  }
  parts.push("</g></svg>");
  return parts.join("") + "\n";
}

fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const [side, f] of Object.entries(FILES)) {
  for (const [mode, binds] of Object.entries(f.modes)) {
    fs.writeFileSync(path.join(OUT, `${f.id}-VKBsim Gladiator EVO ${side}-${mode}.svg`), svg(side, mode, binds));
    n++;
  }
}
console.log(`wrote ${n} synthetic JD-style exports to ${OUT}`);
