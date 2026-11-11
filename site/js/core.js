/* Stick kneeboard: merge logic.
 * A line-for-line port of tool/merge_diagrams.py (v1 + QA fixes D2-D4). The test
 * suite checks that both produce byte-identical SVGs from the same exports.
 * Pure functions, no DOM and no network: runs in the browser and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KBMap = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FILE_RE = /^\d+-(.+)-([^-]+)\.svg$/i;
  const SLOT_RE = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none" stroke="none"\/><g[^>]*><switch>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text><\/switch><\/g>/g;
  const IMAGE_RE = /<image\b[^>]*\/>/g;

  const MODE_COLOURS = {
    "Spaceship": "#1f6fb4",
    "Spaceship mining": "#a87900",
    "Spaceship salvage": "#2a8a2a",
    "Spaceship scanning": "#0e8a8a",
    "Turrets": "#c2399b",
    "Vehicle": "#8c564b",
    "Weapons": "#7b4fbf",
    "Fps": "#d9650b",
    "General": "#555555",
  };
  const KNOWN = Object.keys(MODE_COLOURS);
  const FALLBACK = ["#b03030", "#3d5a80", "#6a8d00", "#9c4f96", "#00796b", "#795548"];

  const ART_W = 1159, ART_H = 807, COL_W = 330, PANEL_PAD = 16;
  const FONT = "Segoe UI, Arial, Helvetica, sans-serif";
  const MIN_ART_FONT = 8;

  // ------------------------------------------------------------ python-compatible helpers

  /** Python str(float): integers keep ".0" (79.0), others print shortest repr. */
  function pyFloat(v) {
    return Number.isInteger(v) ? v.toFixed(1) : String(v);
  }
  /** Python f"{v:g}" for the plain numbers in JD slot coordinates. */
  function fmtG(v) {
    return String(Number(Number(v).toPrecision(6)));
  }
  /** Python f"{v:.1f}": round half to even on the exact binary value. */
  function f1(v) {
    return v.toFixed(1);
  }
  /** xml.sax.saxutils.escape: &, <, > only. */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  /** html.unescape for what Joystick Diagrams writes: numeric + the basic named entities. */
  function unescapeHtml(s) {
    return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body) => {
      if (body[0] === "#") {
        const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
      }
      return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
    });
  }

  function cleanLabel(raw) {
    let t = unescapeHtml(raw).replace(/ /g, " ").replace(/\n/g, " ").trim();
    t = t.replace(/\s+/g, " ");
    if (t.replace(/\//g, "").trim() === "") return "";
    if (t.startsWith("/")) t = "– " + t;
    if (t.endsWith("/")) t = t + " –";
    return t;
  }

  function modeSortKey(mode) {
    const i = KNOWN.indexOf(mode);
    return [i >= 0 ? i : KNOWN.length, mode.toLowerCase()];
  }
  function cmpTuple(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }
  function byModeKey(a, b) {
    return cmpTuple(modeSortKey(a), modeSortKey(b));
  }

  function modeColours(modes) {
    const out = {};
    let i = 0;
    for (const m of modes) {
      if (Object.prototype.hasOwnProperty.call(MODE_COLOURS, m)) out[m] = MODE_COLOURS[m];
      else out[m] = FALLBACK[i++ % FALLBACK.length];
    }
    return out;
  }

  // ------------------------------------------------------------ reading

  /**
   * files: [{name, text}] (any order). Returns {devices: [Device...], skipped: [name...]}.
   * Device: {name, side, modes, sources, slots: Map(key -> slot), images, template, warnings}
   */
  function readSources(files, slotmap) {
    const sorted = files.slice().sort((a, b) => {
      const x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    const devices = new Map();
    const skipped = [];
    for (const f of sorted) {
      const m = FILE_RE.exec(f.name);
      if (!m) { skipped.push(f.name); continue; }
      const devName = m[1].trim(), mode = m[2].trim();
      const parts = devName.split(/\s+/);
      const last = parts[parts.length - 1];
      const side = last === "R" || last === "L" ? last : "?";
      if (!devices.has(devName)) {
        devices.set(devName, { name: devName, side, modes: [], sources: [], slots: new Map(),
          images: [], template: "", warnings: [] });
      }
      const dev = devices.get(devName);
      const text = f.text;
      if (dev.images.length === 0) dev.images = text.match(IMAGE_RE) || [];
      dev.modes.push(mode);
      dev.sources.push(f.name);
      const smap = (slotmap && slotmap[side]) || {};
      SLOT_RE.lastIndex = 0;
      let s;
      while ((s = SLOT_RE.exec(text)) !== null) {
        const [, x, y, w, h, raw] = s;
        const key = fmtG(parseFloat(x)) + "," + fmtG(parseFloat(y));
        const info = Object.prototype.hasOwnProperty.call(smap, key) ? smap[key] : undefined;
        const label = cleanLabel(raw);
        if (typeof info === "string") {
          if (info === "#title" && label) dev.template = label;
          continue;
        }
        let name, order;
        if (info === undefined) {
          name = "slot " + key; order = 900;
          if (label) {
            const msg = `${f.name}: slot ${key} is not in the slot map (label "${label}")`;
            if (!dev.warnings.includes(msg)) dev.warnings.push(msg);
          }
        } else {
          name = info.name; order = info.order;
        }
        if (!dev.slots.has(key)) {
          dev.slots.set(key, { key, x: parseFloat(x), y: parseFloat(y), w: parseFloat(w), h: parseFloat(h),
            name, order, binds: new Map() });
        }
        if (label) dev.slots.get(key).binds.set(mode, label);
      }
    }
    for (const dev of devices.values()) {
      dev.modes = Array.from(new Set(dev.modes)).sort(byModeKey);
    }
    return { devices: Array.from(devices.values()), skipped };
  }

  // ------------------------------------------------------------ text sizing

  const NARROW = new Set("iljtfr.,:;'!|() []-");
  const WIDE = new Set("mwMW@%");
  const UPPER_OR_DIGIT = /^[\p{Lu}\p{Nd}]$/u;

  function textWidth(s, size) {
    let w = 0;
    for (const ch of s) {
      if (NARROW.has(ch)) w += 0.32;
      else if (WIDE.has(ch)) w += 0.86;
      else if (UPPER_OR_DIGIT.test(ch)) w += 0.64;
      else w += 0.54;
    }
    return w * size;
  }

  function fitInBox(label, w, h) {
    const maxW = w - 4;
    for (const size of [9, 8.5, MIN_ART_FONT]) {
      if (textWidth(label, size) <= maxW) return [size, [label]];
    }
    const chars = Array.from(label);
    let cut = chars.slice();
    while (cut.length > 1 && textWidth(cut.join("").trimEnd() + "…", MIN_ART_FONT) > maxW) cut.pop();
    let cutStr = cut.join("");
    const next = chars[cut.length];
    const nextIsSpace = next !== undefined && /^\s$/.test(next);
    if (!nextIsSpace && cutStr.trim().includes(" ")) {
      const trimmed = cutStr.trimEnd();
      const wordCut = trimmed.slice(0, trimmed.lastIndexOf(" "));
      if (Array.from(wordCut).length >= 0.6 * cut.length) cutStr = wordCut;
    }
    return [MIN_ART_FONT, [cutStr.trimEnd() + "…"]];
  }

  function multiTag(n, room) {
    for (const tag of [`${n} modes ▸ list`, `${n} modes`, `${n}▸`]) {
      if (textWidth(tag, 8.5) <= room) return tag;
    }
    return "";
  }

  // ------------------------------------------------------------ rendering

  function renderSvg(dev, generated) {
    const colours = modeColours(dev.modes);
    const bound = Array.from(dev.slots.values()).filter((s) => s.binds.size > 0)
      .sort((a, b) => cmpTuple([a.order, a.key], [b.order, b.key]));
    const used = new Set();
    for (const s of bound) for (const m of s.binds.keys()) used.add(m);
    const shown = dev.modes.filter((m) => used.has(m));
    const emptyModes = dev.modes.filter((m) => !used.has(m));

    const lineH = 14, headH = 16, gap = 7;
    const top = 92 + 18 * Math.floor((shown.length + 1) / 2);
    const usable = ART_H - top - (emptyModes.length ? 44 : 30);
    const columns = [];
    let col = [], usedH = 0;
    for (const s of bound) {
      const block = headH + lineH * s.binds.size + gap;
      if (col.length && usedH + block > usable) { columns.push(col); col = []; usedH = 0; }
      col.push(s);
      usedH += block;
    }
    if (col.length) columns.push(col);
    const nCols = Math.max(1, columns.length);
    const W = ART_W + PANEL_PAD * 2 + COL_W * nCols, H = ART_H;

    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
           `version="1.1" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
    o.push(`<title>${esc(dev.name)} — all modes</title>`);
    o.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
    o.push('<g transform="translate(-0.5 -0.5)">');
    for (const img of dev.images) o.push(img);
    o.push("</g>");

    for (const s of bound) {
      o.push(`<g class="slot" data-button="${esc(s.name)}">`);
      o.push(`<rect x="${pyFloat(s.x + 0.5)}" y="${pyFloat(s.y + 0.5)}" width="${pyFloat(s.w - 1)}" ` +
             `height="${pyFloat(s.h - 1)}" fill="#ffffff"/>`);
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      if (s.binds.size === 1) {
        const [mode, label] = s.binds.entries().next().value;
        const [size, lines] = fitInBox(label, s.w, s.h);
        const lh = size * 1.05;
        const y0 = cy - lh * (lines.length - 1) / 2 + size * 0.35;
        lines.forEach((ln, i) => {
          o.push(`<text x="${f1(cx)}" y="${f1(y0 + i * lh)}" font-family="${FONT}" font-size="${size}" ` +
                 `fill="${colours[mode]}" text-anchor="middle">${esc(ln)}</text>`);
        });
      } else {
        const n = s.binds.size, r = 3.2, step = 8, start = s.x + 6;
        Array.from(s.binds.keys()).sort(byModeKey).forEach((mode, i) => {
          o.push(`<circle cx="${f1(start + i * step)}" cy="${f1(cy)}" r="${r}" fill="${colours[mode]}"/>`);
        });
        const tx = start + (n - 1) * step + r + 3;
        const tag = multiTag(n, s.x + s.w - 3 - tx);
        if (tag) {
          o.push(`<text x="${f1(tx)}" y="${f1(cy + 3)}" font-family="${FONT}" font-size="8.5" ` +
                 `fill="#333333">${esc(tag)}</text>`);
        }
      }
      o.push("</g>");
    }

    const px = ART_W + PANEL_PAD;
    o.push(`<line x1="${ART_W}" y1="20" x2="${ART_W}" y2="${H - 20}" stroke="#d0d0d0" stroke-width="1"/>`);
    o.push(`<text x="${px}" y="40" font-family="${FONT}" font-size="20" font-weight="bold" fill="#111111">` +
           `${esc(dev.name + " — all modes")}</text>`);
    let nb = 0;
    for (const s of bound) nb += s.binds.size;
    const sub = `${shown.length} modes · ${nb} binds on ${bound.length} inputs · generated ${generated}`;
    o.push(`<text x="${px}" y="60" font-family="${FONT}" font-size="10.5" fill="#555555">${esc(sub)}</text>`);
    shown.forEach((mode, i) => {
      const lx = px + (i % 2) * 170, ly = 84 + 18 * Math.floor(i / 2);
      o.push(`<rect x="${lx}" y="${ly - 9}" width="11" height="11" rx="2" fill="${colours[mode]}"/>`);
      o.push(`<text x="${lx + 16}" y="${ly}" font-family="${FONT}" font-size="11.5" fill="${colours[mode]}" ` +
             `font-weight="bold">${esc(mode)}</text>`);
    });
    columns.forEach((column, ci) => {
      const x = px + ci * COL_W;
      let y = top + 12;
      for (const s of column) {
        o.push(`<g class="entry" data-button="${esc(s.name)}">`);
        o.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="11.5" font-weight="bold" ` +
               `fill="#111111">${esc(s.name)}</text>`);
        y += lineH + 1;
        for (const mode of Array.from(s.binds.keys()).sort(byModeKey)) {
          const label = s.binds.get(mode);
          o.push(`<rect x="${x + 2}" y="${y - 8}" width="8" height="8" rx="1.5" fill="${colours[mode]}"/>`);
          o.push(`<text x="${x + 15}" y="${y}" font-family="${FONT}" font-size="10.5" fill="#222222" ` +
                 `data-mode="${esc(mode)}">${esc(label)}` +
                 `<tspan fill="${colours[mode]}" font-size="9.5">  ${esc(mode)}</tspan></text>`);
          y += lineH;
        }
        y += gap;
        o.push("</g>");
      }
    });

    if (emptyModes.length) {
      o.push(`<text x="${px}" y="${H - 38}" font-family="${FONT}" font-size="9" fill="#777777">` +
             `Modes with no binds: ${esc(emptyModes.join(", "))}</text>`);
    }
    o.push(`<text x="${px}" y="${H - 24}" font-family="${FONT}" font-size="9" fill="#777777">` +
           `Template: ${esc(dev.template || "unknown")}. Art and labels from Joystick Diagrams exports ` +
           `(github.com/Rexeh/joystick-diagrams, GPL-2.0).</text>`);
    o.push(`<text x="${px}" y="${H - 12}" font-family="${FONT}" font-size="9" fill="#777777">` +
           `Sources: ${dev.sources.length} files, ${esc(dev.sources[0].split("-")[0])}-…-&lt;mode&gt;.svg</text>`);
    o.push("</svg>");
    return { svg: o.join("\n") + "\n", width: W, height: H,
             stats: { modes: shown.length, emptyModes, binds: nb, inputs: bound.length } };
  }

  return { readSources, renderSvg, cleanLabel, textWidth, fitInBox, multiTag, modeColours,
           MODE_COLOURS, unescapeHtml };
});
