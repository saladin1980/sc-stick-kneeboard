/* Stage C card renderer: keyboard binds written onto our own US ANSI full-size keyboard drawing.
 * Same visual language as the stick cards: white paper, mode colours + dots, † game default, ? guessed name,
 * "+N more" -> the full list (collapsed under the card on the page). Units: points; the card is 792 pt wide,
 * so the 8 px floor at the default card width is the same FLOOR_PT as the stick cards. */
(function (root, factory) {
  const req = (n) => (typeof require === "function" ? require(n) : null);
  const api = factory(root.KBMap || req("./core.js"), root.KBModes || req("./modes.js"),
                      root.KBVkb || req("./vkb.js"), root.KBKeyboard || req("./keyboard.js"));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KBKbd = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (KB, MODES, V, KEYS) {
  "use strict";

  const W = 792, MARGIN = 12, TOP = 58;
  const U = (W - 2 * MARGIN) / KEYS.WIDTH_U;            // ≈ 33.4 pt per key unit
  const GAP = 1.6;                                      // space between keycaps
  const FONT = "Segoe UI, Arial, Helvetica, sans-serif";
  const LINE_FONT = Math.round(V.FLOOR_PT * 1.04 * 100) / 100;   // just above the 8 px floor
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const r2 = (v) => Math.round(v * 100) / 100;

  function modText(mods) {
    return mods.map((m) => KEYS.MOD_NAME[m] || m).join("+");
  }
  /** On the keycap, modifiers are compact marks (a 1-unit key holds ~13 characters a line); the list keeps full names. */
  const MOD_MARK = { lctrl: "L^", rctrl: "R^", lalt: "LA", ralt: "RA", lshift: "L⇧", rshift: "R⇧" };
  function modMark(mods) {
    return mods.map((m) => MOD_MARK[m] || m).join("");
  }
  function entryText(e) {
    let t = (e.modifiers.length ? modMark(e.modifiers) + " " : "") + e.label;
    if (e.guessed) t += " ?";
    if (e.source === "default") t += " †";
    return t;
  }
  function ellipsize(text, size, maxW) {
    if (KB.textWidth(text, size) <= maxW) return text;
    const ch = Array.from(text);
    while (ch.length > 1 && KB.textWidth(ch.join("").trimEnd() + "…", size) > maxW) ch.pop();
    return ch.join("").trimEnd() + "…";
  }

  /** Bind lines for one key: identical texts merge (one dot per mode); up to the lines that fit, else +N. */
  function fitKey(entries, w, h) {
    const groups = [], byText = new Map();
    for (const e of entries) {
      const t = entryText(e);
      if (!byText.has(t)) { byText.set(t, { text: t, modes: [] }); groups.push(byText.get(t)); }
      const g = byText.get(t);
      if (!g.modes.some((m) => m.id === e.mode.id)) g.modes.push(e.mode);
    }
    const font = LINE_FONT, lh = font * 1.08;
    const maxLines = Math.max(1, Math.floor((h - 1) / lh));
    const n = groups.length;
    const shown = n <= maxLines ? groups : groups.slice(0, maxLines - 1);
    const more = n - shown.length;
    const step = font * 0.78;
    const lines = shown.map((g) => {
      const dw = g.modes.length * step + font * 0.25;
      return { text: ellipsize(g.text, font, w - 3 - dw), dots: g.modes.map((m) => m.colour),
               colour: g.modes.length === 1 ? g.modes[0].colour : "#222222" };
    });
    if (more) lines.push({ text: `+${more} more`, colour: "#333333", chip: true, dots: [] });
    return { font, lh, lines, more };
  }

  function groupBinds(binds, view) {
    const by = new Map();
    for (const b of binds) {
      const mode = MODES.modeOf(b.actionmap);
      if (view !== "all" && mode.id !== view) continue;
      if (!by.has(b.input)) by.set(b.input, []);
      by.get(b.input).push({ ...b, mode });
    }
    for (const l of by.values()) {
      // plain binds first (the key's main job), then modifier combos; within each, by mode then label
      l.sort((a, b) => (a.modifiers.length - b.modifiers.length) || MODES.order(a.mode.id) - MODES.order(b.mode.id) ||
        (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    }
    return by;
  }

  /** opts: {binds (keyboard, ui-filtered), view, gameVersion, generated} */
  function renderKeyboard(opts) {
    const view = opts.view || "all";
    const viewName = view === "all" ? "All modes" : (MODES.MODES.find((m) => m.id === view) || {}).name || view;
    const grouped = groupBinds(opts.binds, view);
    const off = [];
    for (const [inp, list] of grouped) if (!KEYS.BY_TOKEN.has(inp)) for (const e of list) off.push(e);

    const page = [];
    const kbH = KEYS.HEIGHT_U * U;
    const H = Math.ceil(TOP + kbH + 46);
    page.push(`<text x="${MARGIN}" y="26" font-family="${FONT}" font-size="17" font-weight="bold" fill="#111111">Keyboard</text>`);
    page.push(`<text x="${MARGIN}" y="42" font-family="${FONT}" font-size="8" fill="#444444">${esc(KEYS.LAYOUT)} · Star Citizen ${esc(opts.gameVersion || "")}</text>`);
    page.push(`<text x="${W - MARGIN}" y="26" font-family="${FONT}" font-size="12" font-weight="bold" fill="#111111" text-anchor="end">${esc(viewName)}</text>`);
    const legendModes = MODES.MODES.filter((m) => Array.from(grouped.values()).some((l) => l.some((e) => e.mode.id === m.id)));
    let lx = W - MARGIN;
    for (const m of legendModes.slice().reverse()) {
      const tw = KB.textWidth(m.name, 6.5) + 14;
      lx -= tw;
      page.push(`<rect x="${r2(lx)}" y="35.5" width="5" height="5" rx="1" fill="${m.colour}"/>`);
      page.push(`<text x="${r2(lx + 7)}" y="40.5" font-family="${FONT}" font-size="6.5" font-weight="bold" fill="${m.colour}">${esc(m.name)}</text>`);
    }

    const links = [];
    let keysWithBinds = 0, overflowKeys = 0;
    for (const [tok, legend, ux, uy, uw, uh] of KEYS.KEYS) {
      const x = MARGIN + ux * U + GAP / 2, y = TOP + uy * U + GAP / 2, w = uw * U - GAP, h = uh * U - GAP;
      const entries = grouped.get(tok);
      page.push(`<g class="key" data-key="${esc(tok)}">`);
      page.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="2.6" fill="${entries ? "#f1f1ee" : "#e2e2df"}" stroke="#9a9a96" stroke-width="0.6"/>`);
      page.push(`<text x="${r2(x + 2.4)}" y="${r2(y + 6.4)}" font-family="${FONT}" font-size="5.4" font-weight="bold" fill="#555555">${esc(legend)}</text>`);
      if (entries) {
        keysWithBinds++;
        const fit = fitKey(entries, w, h - 8);
        if (fit.more) { overflowKeys++; links.push({ input: tok, more: fit.more, head: legend, rect: [x, y, x + w, y + h], page: [W, H] }); }
        fit.lines.forEach((ln, i) => {
          const base = y + 8 + fit.lh * (i + 1) - fit.font * 0.2;
          const step = fit.font * 0.78, rad = fit.font * 0.27;
          ln.dots.forEach((c, k) => page.push(`<circle class="dot" cx="${r2(x + 1.8 + rad + k * step)}" cy="${r2(base - fit.font * 0.33)}" r="${r2(rad)}" fill="${c}"/>`));
          const tx = x + 1.8 + (ln.dots.length ? ln.dots.length * step + fit.font * 0.25 : 0);
          page.push(`<text x="${r2(tx)}" y="${r2(base)}" font-family="${FONT}" font-size="${fit.font}" fill="${ln.colour}"${ln.chip ? ' font-style="italic"' : ""}>${esc(ln.text)}</text>`);
        });
      }
      page.push("</g>");
    }
    const notes = [
      "Hold a modifier with the key: L^/R^ = Left/Right Ctrl, LA/RA = Left/Right Alt, L⇧/R⇧ = Left/Right Shift. † game default (not set by you). ? name guessed (no name in this game version's data).",
      `${off.length ? `${off.length} mouse/other binds aren't keys: they're in the list. ` : ""}Generated ${opts.generated || ""}.`,
    ];
    notes.forEach((t, i) => page.push(`<text x="${MARGIN}" y="${r2(TOP + kbH + 16 + i * 9)}" font-family="${FONT}" font-size="5.8" fill="#666666">${esc(t)}</text>`));

    const head = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${W * 3}" height="${H * 3}" viewBox="0 0 ${W} ${H}">`;
    const pageSvg = [head, `<title>Keyboard — ${esc(viewName)}</title>`, `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`, ...page, "</svg>"].join("\n") + "\n";

    // list data, same shape as the stick cards (the page renders it into the collapsed list)
    const entry = (e) => ({ text: (e.modifiers.length ? modText(e.modifiers) + "+ " : "") + e.label + (e.guessed ? " ?" : ""),
      mode: e.mode.name, colour: e.mode.colour,
      tags: [e.source === "default" ? "game default" : null, e.guessed ? "name guessed" : null,
             e.activation && e.activation !== "press" && e.activation !== "tap" ? e.activation.replace(/_/g, " ") : null].filter(Boolean) });
    const order = new Map(KEYS.KEYS.map((k, i) => [k[0], i]));
    const blocks = Array.from(grouped.keys()).filter((k) => KEYS.BY_TOKEN.has(k))
      .sort((a, b) => order.get(a) - order.get(b))
      .map((k) => ({ input: k, head: KEYS.BY_TOKEN.get(k)[1], entries: grouped.get(k).map(entry) }));
    if (off.length) blocks.push({ input: "off-picture", head: "Not on the keyboard (mouse and others)",
      entries: off.map((e) => ({ ...entry(e), text: `${e.input}: ${entry(e).text}` })) });
    const foot = [notes[0], `Layout: our own ${KEYS.LAYOUT} drawing. Labels: Star Citizen's own control names.`];

    let nb = 0;
    for (const l of grouped.values()) nb += l.length;
    return {
      svg: pageSvg, pageSvg, width: W, height: H, links,
      listData: { blocks, legend: legendModes.map((m) => ({ name: m.name, colour: m.colour })), foot },
      stats: { view, binds: nb, inputs: grouped.size, keysWithBinds, overflowRows: overflowKeys, offPicture: off.length,
               fontPt: LINE_FONT, fontPxAtDefault: r2(LINE_FONT * V.DEFAULT_CARD_PX / W), modes: legendModes.map((m) => m.id) },
    };
  }

  return { renderKeyboard, fitKey, U, W };
});
