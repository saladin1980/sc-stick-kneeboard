/* Stage B card renderer: binds written INTO the VKB fillable template's own boxes, plus a full list below.
 * Units are PDF points (the template page is 792 x 612 pt). Pure string building: browser + Node.
 *
 * Rules (Master 2026-11-11): "All modes" is the default view; up to 3 entries stack inside a row; past that
 * (or below the 8 px floor at the default card width) the row shows what fits plus "+N"; every row shows its
 * button number; the list below always has every action in full.
 */
(function (root, factory) {
  const api = factory(root.KBMap || (typeof require === "function" ? require("./core.js") : null),
                      root.KBModes || (typeof require === "function" ? require("./modes.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KBVkb = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (KB, MODES) {
  "use strict";

  const PAGE_W = 792, PAGE_H = 612;
  const DEFAULT_CARD_PX = 1345;                        // card width at the 1440 px desktop layout
  const FLOOR_PX = 8;
  const FLOOR_PT = FLOOR_PX / (DEFAULT_CARD_PX / PAGE_W);   // ≈ 4.71 pt
  const FONT = "Segoe UI, Arial, Helvetica, sans-serif";
  const DIR = { up: "↑", down: "↓", left: "←", right: "→", push: "push" };
  const AXIS_NAME = { x: "Stick X axis", y: "Stick Y axis", rotz: "Twist axis", z: "Throttle axis",
                      rotx: "Ministick X axis (analog)", roty: "Ministick Y axis (analog)" };

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const r2 = (v) => Math.round(v * 100) / 100;
  const tw = (s, size) => KB.textWidth(s, size);

  function ellipsize(text, size, maxW) {
    if (tw(text, size) <= maxW) return text;
    const ch = Array.from(text);
    while (ch.length > 1 && tw(ch.join("").trimEnd() + "…", size) > maxW) ch.pop();
    return ch.join("").trimEnd() + "…";
  }

  /** Sort key for inputs: buttons by number, then hat, then axes. */
  function inputOrder(inp) {
    let m = /^button(\d+)$/.exec(inp);
    if (m) return [0, Number(m[1])];
    m = /^hat(\d+)_(up|down|left|right)$/.exec(inp);
    if (m) return [1, Number(m[1]) * 10 + ["up", "down", "left", "right"].indexOf(m[2])];
    const ax = ["x", "y", "rotz", "z", "rotx", "roty"].indexOf(inp);
    return [2, ax < 0 ? 99 : ax, inp];
  }
  function cmp(a, b) {
    const x = inputOrder(a), y = inputOrder(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      return x[i] < y[i] ? -1 : 1;
    }
    return 0;
  }

  /** What to print in the narrow number box, and the list header for an input. */
  function inputTitle(inp, field) {
    let m = /^button(\d+)$/.exec(inp);
    const where = field ? `${field.control}${field.dir ? " " + (DIR[field.dir] || field.dir) : ""}` : "";
    if (m) return { num: m[1], head: `${m[1]}${where ? " · " + where : ""}` };
    m = /^hat(\d+)_(up|down|left|right)$/.exec(inp);
    if (m) return { num: "POV", head: `POV ${DIR[m[2]]}${where ? " · " + where : ""}` };
    // axes: one clean title (QA B: no "Stick X axis · Axes x")
    return { num: "", head: AXIS_NAME[inp] || `${inp} axis` };
  }

  /** Row/list text for one bind: modifier, label, "?" when the name is guessed, "†" for a game default. */
  function entryText(e) {
    let t = (e.modifier ? e.modifier + "+" : "") + e.label;
    if (e.guessed) t += " ?";
    if (e.source === "default") t += " †";
    return t;
  }

  /** Merge entries whose text is identical ("Boost" in Flight and Ground vehicle) into one line with a dot per mode. */
  function mergeEntries(entries) {
    const out = [], byText = new Map();
    for (const e of entries) {
      const t = entryText(e);
      if (!byText.has(t)) { byText.set(t, { text: t, modes: [] }); out.push(byText.get(t)); }
      const g = byText.get(t);
      if (!g.modes.some((m) => m.id === e.mode.id)) g.modes.push(e.mode);
    }
    return out;
  }

  /** Group binds by input, filtered to the view, entries ordered by mode then label. */
  function groupBinds(binds, view) {
    const by = new Map();
    for (const b of binds) {
      const mode = MODES.modeOf(b.actionmap);
      if (view !== "all" && mode.id !== view) continue;
      if (!by.has(b.input)) by.set(b.input, []);
      by.get(b.input).push({ ...b, mode });
    }
    for (const list of by.values()) {
      list.sort((a, b) => MODES.order(a.mode.id) - MODES.order(b.mode.id) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    }
    return by;
  }

  /** Dot geometry for a line at a given font size (mode dots sit before the text). */
  const dotStep = (font) => font * 0.78;
  const dotsWidth = (n, font) => (n ? n * dotStep(font) + font * 0.25 : 0);

  /**
   * Lay out entries inside one text field. Identical texts merge into one line with a dot per mode.
   * Returns {font, lines:[{text, colour, dots:[colour], chip}], more}. "more" counts merged lines.
   */
  function fitRow(entries, w, h) {
    const avail = w - 3.5;
    const groups = mergeEntries(entries);
    const n = groups.length;
    const maxLines = Math.max(1, Math.floor((h - 0.8) / (FLOOR_PT * 1.02)));
    const stackable = n <= Math.min(3, maxLines);
    const lineCount = stackable ? n : maxLines;
    const font = Math.min(7.5, (h - 0.8) / (lineCount * 1.02));
    let shown, more = 0;
    if (stackable) shown = groups;
    else { shown = groups.slice(0, lineCount - 1); more = n - shown.length; }
    const lines = shown.map((g) => {
      const dots = g.modes.map((m) => m.colour);
      return { text: ellipsize(g.text, font, avail - dotsWidth(dots.length, font)), dots,
               colour: g.modes.length === 1 ? g.modes[0].colour : "#222222" };
    });
    if (more) lines.push({ text: `+${more} more in the list below`, colour: "#333333", chip: true, dots: [] });
    return { font: r2(font), lines, more };
  }

  /** The full list (below the page): columns of input blocks. Returns {svg parts, height}. */
  function renderList(x0, y0, width, grouped, fieldsByInput, opts) {
    const o = [];
    const colW = 254, gap = 14, cols = Math.max(1, Math.floor((width + gap) / (colW + gap)));
    const head = 7, line = 6.2, lh = 8.4;
    const blocks = Array.from(grouped.keys()).sort(cmp).map((inp) => ({ inp, entries: grouped.get(inp) }));
    if (opts.offPicture && opts.offPicture.length) blocks.push({ heading: "Not on the picture", entries: opts.offPicture });
    // balance columns by height
    const blockH = (b) => (b.heading ? 11 + b.entries.length * lh : 10 + b.entries.length * lh) + 6;
    const total = blocks.reduce((s, b) => s + blockH(b), 0);
    const target = total / cols;
    const columns = [[]];
    let acc = 0;
    for (const b of blocks) {
      if (acc > 0 && acc + blockH(b) > target + 12 && columns.length < cols) { columns.push([]); acc = 0; }
      columns[columns.length - 1].push(b);
      acc += blockH(b);
    }
    let maxY = y0;
    columns.forEach((col, ci) => {
      const x = x0 + ci * (colW + gap);
      let y = y0;
      for (const b of col) {
        if (b.heading) {
          o.push(`<text x="${x}" y="${r2(y + 7)}" font-family="${FONT}" font-size="${head}" font-weight="bold" fill="#111111">${esc(b.heading)}</text>`);
          y += 11;
          for (const e of b.entries) {
            o.push(`<text x="${x + 6}" y="${r2(y + 6)}" font-family="${FONT}" font-size="${line}" fill="#222222">` +
                   `${esc(e.where)}: ${esc(e.label)}<tspan fill="${e.mode.colour}">  ${esc(e.mode.name)}</tspan></text>`);
            y += lh;
          }
        } else {
          const t = inputTitle(b.inp, fieldsByInput.get(b.inp));
          o.push(`<g class="entry" data-input="${esc(b.inp)}">`);
          o.push(`<text x="${x}" y="${r2(y + 7)}" font-family="${FONT}" font-size="${head}" font-weight="bold" fill="#111111">${esc(t.head)}</text>`);
          y += 10;
          for (const e of b.entries) {
            const tags = [];
            if (e.source === "default") tags.push("game default");
            if (e.guessed) tags.push("name guessed");
            if (e.activation && e.activation !== "press" && e.activation !== "tap") tags.push(e.activation.replace(/_/g, " "));
            o.push(`<rect x="${x + 1}" y="${r2(y + 1.2)}" width="4.6" height="4.6" rx="0.8" fill="${e.mode.colour}"/>`);
            o.push(`<text x="${x + 8}" y="${r2(y + 6)}" font-family="${FONT}" font-size="${line}" fill="#222222" ` +
                   `data-mode="${esc(e.mode.name)}" data-map="${esc(e.actionmap)}" data-action="${esc(e.action)}">${esc((e.modifier ? e.modifier + "+" : "") + e.label + (e.guessed ? " ?" : ""))}` +
                   `<tspan fill="${e.mode.colour}" font-size="5.4">  ${esc(e.mode.name)}${tags.length ? " · " + esc(tags.join(", ")) : ""}</tspan></text>`);
            y += lh;
          }
          o.push("</g>");
        }
        y += 6;
      }
      maxY = Math.max(maxY, y);
    });
    return { parts: o, height: maxY - y0 };
  }

  /** The full list as plain data, for the print view (HTML that can flow across pages). */
  function listData(grouped, fieldsByInput, off, legendModes, foot) {
    const entry = (e) => ({ text: (e.modifier ? e.modifier + "+" : "") + e.label + (e.guessed ? " ?" : ""), mode: e.mode.name,
      colour: e.mode.colour, tags: [e.source === "default" ? "game default" : null, e.guessed ? "name guessed" : null,
      e.activation && e.activation !== "press" && e.activation !== "tap" ? e.activation.replace(/_/g, " ") : null].filter(Boolean) });
    const blocks = Array.from(grouped.keys()).sort(cmp).map((inp) => ({
      input: inp, head: inputTitle(inp, fieldsByInput.get(inp)).head, entries: grouped.get(inp).map(entry) }));
    if (off && off.length) blocks.push({ input: "off-picture", head: "Not on the picture", entries: off.map((e) => ({ ...entry(e), text: `${e.where}: ${entry(e).text}` })) });
    return { blocks, legend: legendModes.map((m) => ({ name: m.name, colour: m.colour })), foot };
  }

  /**
   * opts: {template, fieldmap, art (data URI or null), binds (one device, already ui-filtered),
   *        view: "all" | mode id, device, gameVersion, generated, defaultNote}
   */
  function renderCard(opts) {
    const { template, fieldmap, binds, view } = opts;
    const viewName = view === "all" ? "All modes" : (MODES.MODES.find((m) => m.id === view) || {}).name || view;
    const grouped = groupBinds(binds, view);
    const fieldByInput = new Map();
    for (const [name, f] of Object.entries(fieldmap)) if (f.input) fieldByInput.set(f.input, { ...f, name });

    const onPicture = new Map(), off = [];
    for (const [inp, list] of grouped) {
      if (fieldByInput.has(inp) && template.fields[fieldByInput.get(inp).name]) onPicture.set(inp, list);
      else for (const e of list) off.push({ ...e, where: inputTitle(inp, null).head });
    }

    const o = [];
    const page = [];
    // the template page
    if (opts.art) page.push(`<image x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" preserveAspectRatio="none" href="${opts.art}"/>`);
    // header fields USER1/USER2 are not in the field map; draw over the known top-right area of the form
    page.push(`<text x="516" y="57" font-family="${FONT}" font-size="11" font-weight="bold" fill="#111111">${esc(viewName)}</text>`);
    page.push(`<text x="516" y="93" font-family="${FONT}" font-size="7.5" fill="#333333">${esc(opts.device)} · Star Citizen ${esc(opts.gameVersion || "")}</text>`);

    let rowsFilled = 0, overflowRows = 0, minFont = Infinity;
    const links = [];
    for (const [fname, f] of Object.entries(fieldmap)) {
      const box = template.fields[fname];
      if (!box) continue;
      // the button number, always (the PDF leaves this column blank)
      if (box.num && f.input) {
        const t = inputTitle(f.input, f);
        const [x0, y0, x1, y1] = box.num;
        const size = t.num.length > 2 ? 5.2 : 7.5;
        page.push(`<text x="${r2((x0 + x1) / 2)}" y="${r2((y0 + y1) / 2 + size * 0.36)}" font-family="${FONT}" font-size="${size}" ` +
                  `font-weight="bold" fill="#111111" text-anchor="middle">${esc(t.num)}</text>`);
      }
      const entries = f.input ? onPicture.get(f.input) : null;
      if (!entries || !box.text) continue;
      const [x0, y0, x1, y1] = box.text;
      const fit = fitRow(entries, x1 - x0, y1 - y0);
      rowsFilled++;
      if (fit.more) {
        overflowRows++;
        // where the "+N more" row sits (page points), so the page can make it open the list at this input
        links.push({ input: f.input, more: fit.more, head: inputTitle(f.input, f).head, rect: box.text });
      }
      minFont = Math.min(minFont, fit.font);
      const lh = fit.font * 1.02;
      const top = y0 + ((y1 - y0) - lh * fit.lines.length) / 2;
      page.push(`<g class="row" data-field="${fname}" data-input="${esc(f.input)}">`);
      fit.lines.forEach((ln, i) => {
        const base = top + lh * (i + 1) - fit.font * 0.22;
        const step = fit.font * 0.78, rad = fit.font * 0.27;
        ln.dots.forEach((c, k) => page.push(`<circle class="dot" cx="${r2(x0 + 2 + rad + k * step)}" cy="${r2(base - fit.font * 0.33)}" r="${r2(rad)}" fill="${c}"/>`));
        const tx = x0 + 2 + (ln.dots.length ? ln.dots.length * step + fit.font * 0.25 : 0);
        page.push(`<text x="${r2(tx)}" y="${r2(base)}" font-family="${FONT}" ` +
                  `font-size="${fit.font}" fill="${ln.colour}"${ln.chip ? ' font-style="italic"' : ""}>${esc(ln.text)}</text>`);
      });
      page.push("</g>");
    }

    // list below
    const listTop = PAGE_H + 30;
    const legendModes = MODES.MODES.filter((m) => Array.from(grouped.values()).some((l) => l.some((e) => e.mode.id === m.id)));
    const list = renderList(24, listTop + 14, PAGE_W - 48, onPicture, fieldByInput, { offPicture: off });
    const foot = [
      "† game default: not set by you; the game's own bind, shown on the stick set as \"default stick\"" + (opts.defaultNote ? ` (${opts.defaultNote})` : "") + ".",
      "Names follow this VKB template (En1 = base right wheel = buttons 23/24, Sw1 = base left = 25/26); Joystick Diagrams' art names those wheels differently. Button numbers are the same everywhere.",
      "Template: " + (template.title || "") + ", fillable design by UntoldForce v1.0. Labels: Star Citizen's own control names. Generated " + (opts.generated || "") + ".",
    ];
    const guessed = binds.filter((b) => b.guessed && (view === "all" || MODES.modeOf(b.actionmap).id === view));
    if (guessed.length) foot.splice(1, 0, `? name guessed: this game version's data has no name for ${guessed.length === 1 ? "this action" : "these actions"} (${guessed.map((b) => b.action).filter((v, i, a) => a.indexOf(v) === i).join(", ")}), so it was made from the action id. The bind itself is real.`);
    const footTop = listTop + 14 + list.height + 8;
    const H = Math.ceil(footTop + foot.length * 9 + 14);

    o.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ` +
           `width="${PAGE_W * 3}" height="${H * 3}" viewBox="0 0 ${PAGE_W} ${H}">`);
    o.push(`<title>${esc(opts.device)} — ${esc(viewName)}</title>`);
    o.push(`<rect x="0" y="0" width="${PAGE_W}" height="${H}" fill="#ffffff"/>`);
    o.push(...page);
    o.push(`<line x1="24" y1="${PAGE_H + 8}" x2="${PAGE_W - 24}" y2="${PAGE_H + 8}" stroke="#c8c8c8" stroke-width="0.6"/>`);
    o.push(`<text x="24" y="${listTop}" font-family="${FONT}" font-size="9" font-weight="bold" fill="#111111">Every bind, in full</text>`);
    legendModes.forEach((m, i) => {
      const lx = 140 + i * 74;
      o.push(`<rect x="${lx}" y="${listTop - 6}" width="6" height="6" rx="1" fill="${m.colour}"/>`);
      o.push(`<text x="${lx + 9}" y="${listTop}" font-family="${FONT}" font-size="7" font-weight="bold" fill="${m.colour}">${esc(m.name)}</text>`);
    });
    o.push(...list.parts);
    foot.forEach((t, i) => o.push(`<text x="24" y="${r2(footTop + i * 9)}" font-family="${FONT}" font-size="5.6" fill="#666666">${esc(t)}</text>`));
    o.push("</svg>");

    const pageSvg = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ` +
      `width="${PAGE_W * 3}" height="${PAGE_H * 3}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">`,
      `<title>${esc(opts.device)} — ${esc(viewName)}</title>`, `<rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>`,
      ...page, "</svg>"].join("\n") + "\n";

    let nb = 0;
    for (const l of grouped.values()) nb += l.length;
    return {
      svg: o.join("\n") + "\n", width: PAGE_W, height: H, pageSvg, links,
      listData: listData(onPicture, fieldByInput, off, legendModes, foot),
      stats: { view, binds: nb, inputs: grouped.size, rowsFilled, overflowRows, offPicture: off.length,
               minRowFontPt: minFont === Infinity ? null : minFont,
               minRowFontPxAtDefault: minFont === Infinity ? null : r2(minFont * DEFAULT_CARD_PX / PAGE_W),
               modes: legendModes.map((m) => m.id) },
    };
  }

  /** No picture for this device: the full list only, with a clear note. */
  function renderListCard(opts) {
    const grouped = groupBinds(opts.binds, opts.view);
    const viewName = opts.view === "all" ? "All modes" : (MODES.MODES.find((m) => m.id === opts.view) || {}).name;
    const list = renderList(24, 70, PAGE_W - 48, grouped, new Map(), {});
    const H = Math.ceil(70 + list.height + 30);
    const o = [`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${PAGE_W * 3}" height="${H * 3}" viewBox="0 0 ${PAGE_W} ${H}">`,
      `<title>${esc(opts.device)} — ${esc(viewName)}</title>`,
      `<rect x="0" y="0" width="${PAGE_W}" height="${H}" fill="#ffffff"/>`,
      `<text x="24" y="34" font-family="${FONT}" font-size="16" font-weight="bold" fill="#111111">${esc(opts.device)} — ${esc(viewName)}</text>`,
      `<text x="24" y="52" font-family="${FONT}" font-size="8" fill="#555555">${opts.noArt ? "No picture in this copy" : "No picture for this device yet"}: every bind is listed below. Star Citizen ${esc(opts.gameVersion || "")}.</text>`,
      ...list.parts, "</svg>"];
    let nb = 0;
    for (const l of grouped.values()) nb += l.length;
    return { svg: o.join("\n") + "\n", width: PAGE_W, height: H, stats: { view: opts.view, binds: nb, inputs: grouped.size, list: true } };
  }

  return { renderCard, renderListCard, fitRow, mergeEntries, FLOOR_PT, DEFAULT_CARD_PX, PAGE_W, PAGE_H, inputOrder };
});
