/* Stick kneeboard (Stage B): drop the game's actionmaps export -> one card per stick on the VKB template.
 * Everything local: File.text(), pure renderers, blob URLs. Template art loads as a local <script>
 * (art/vkb/<KEY>.js); when a copy of the site has no art (public build), cards fall back to the list. */
(function () {
  "use strict";
  const R = window.KBResolve, V = window.KBVkb, M = window.KBModes, KK = window.KBKbd;
  const DATA = window.KBMAP_CONTROLS, VKB = window.KBMAP_VKB;

  const $ = (id) => document.getElementById(id);
  const bay = $("bay"), input = $("file"), chooseBtn = $("choose"), clearBtn = $("clear"), printBtn = $("print");
  const statusEl = $("status"), board = $("board"), emptyCard = $("empty"), deck = document.querySelector(".deck");
  const dstick = $("default-stick");

  let state = null;     // {exp, cards: [{inst, device, side, grip, view, el}], defaultSide}
  let urls = [];

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k) n.append(k);
    return n;
  }
  const stamp = () => {
    const d = new Date(), p = (v) => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  function setStatus(msg, isError) {
    statusEl.className = "status" + (isError ? " is-error" : "");
    statusEl.textContent = msg;
  }
  function blobUrl(data, type) {
    const u = URL.createObjectURL(new Blob([data], { type }));
    urls.push(u);
    return u;
  }
  function download(url, name) {
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
  }
  const slug = (s) => s.replace(/[^\w.-]+/g, " ").trim();
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  /** Side of a device from its product name: "... R" / "... L" / RH / LH. */
  function sideOf(name) {
    if (/\b(R|RH|Right)\s*$/i.test(name)) return "R";
    if (/\b(L|LH|Left)\s*$/i.test(name)) return "L";
    return null;
  }
  const isVkb = (name) => /vkb/i.test(name) && /gladiator/i.test(name);

  /** Default grip per side: the pair marked sal_default (R: SCG, L: SCG Omni-Throttle), else the first match. */
  function defaultGrip(side) {
    const t = Object.entries(VKB.templates);
    const pick = t.find(([, v]) => v.side === side && v.sal_default) || t.find(([, v]) => v.side === side);
    return pick ? pick[0] : "list";
  }

  // ---- template art, loaded on demand as a local script
  const artWaiters = {};
  function loadArt(key) {
    if (window.KBMAP_ART && window.KBMAP_ART[key]) return Promise.resolve(window.KBMAP_ART[key]);
    if (!artWaiters[key]) {
      artWaiters[key] = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = `art/vkb/${key}.js`;
        s.onload = () => resolve((window.KBMAP_ART || {})[key] || null);
        s.onerror = () => resolve(null);      // this copy ships without VKB art: list layout instead
        document.head.append(s);
      });
    }
    return artWaiters[key];
  }

  function stickLabel(c) {
    if (c.kind === "kb") return "Keyboard";
    return c.side === "R" ? "Right stick" : c.side === "L" ? "Left stick" : c.device;
  }

  /** Stage C: the keyboard card (our own US ANSI drawing; always shown: the game's keyboard defaults apply to everyone). */
  function keyboardBinds() {
    return R.resolveKeyboard(state.exp, DATA).filter((b) => b.ui);
  }

  async function render(c) {
    if (c.kind === "kb") return show(c, KK.renderKeyboard({ binds: keyboardBinds(), view: c.view,
      gameVersion: DATA.meta.version, generated: stamp() }));
    const defaultInst = (state.cards.find((x) => x.side === state.defaultSide) || {}).inst;
    const binds = R.resolveFull(state.exp, DATA, defaultInst === undefined ? R.DEFAULT_STICK_INSTANCE : defaultInst)
      .filter((b) => b.instance === c.inst && b.ui);
    const common = { binds, view: c.view, device: c.device, gameVersion: DATA.meta.version, generated: stamp(),
                     defaultNote: `set to the ${state.defaultSide === "R" ? "right" : "left"} stick on the page` };
    let result, art = null;
    if (c.grip !== "list") art = await loadArt(c.grip);
    if (art) result = V.renderCard({ ...common, template: VKB.templates[c.grip], fieldmap: VKB.fieldmap, art });
    // noArt: a VKB stick whose picture isn't in this copy (public build without art/vkb/), not "no template exists"
    c.noArt = c.grip !== "list" ? !art : (!state.artAvailable && isVkb(c.device) && !!c.side);
    if (!art) result = V.renderListCard({ ...common, noArt: c.noArt });
    show(c, result);
  }

  function show(c, result) {
    c.result = result;
    // the picture is the product (Sal, UAT 1): the card shows the template page; the full list lives in the toggle
    const img = c.el.querySelector(".sheet img");
    img.src = blobUrl(result.pageSvg || result.svg, "image/svg+xml");
    img.alt = `${stickLabel(c)}: ${result.stats.binds} binds, ${c.view === "all" ? "all modes" : c.view}`;
    const s = result.stats;
    fillList(c, result);
    placeLinks(c, result.links || []);
    c.el.querySelector(".sub").textContent =
      `${c.device}. ${plural(s.binds, "bind")} on ${plural(s.inputs, "input")}` +
      (s.overflowRows ? `, ${plural(s.overflowRows, c.kind === "kb" ? "key" : "row")} ${s.overflowRows === 1 ? "continues" : "continue"} in the list` : "") +
      (c.kind === "kb" ? ". US ANSI full-size layout." :
       c.noArt ? ". No picture in this copy: list only." : c.grip === "list" ? ". No picture for this device yet: list only." : ".");
    const offBtn = c.el.querySelector(".off-note");
    offBtn.hidden = !s.offPicture;
    if (s.offPicture) offBtn.textContent = `${plural(s.offPicture, "bind")} ${s.offPicture === 1 ? "isn't" : "aren't"} on the ${c.kind === "kb" ? "keyboard (mouse and others)" : "picture"}: show ${s.offPicture === 1 ? "it" : "them"}`;
  }

  /** "+N more" rows on the picture become buttons that open the list at that input (positions in page points). */
  function placeLinks(c, links) {
    const layer = c.el.querySelector(".hotspots");
    layer.replaceChildren();
    for (const l of links) {
      const [x0, y0, x1, y1] = l.rect;
      const b = el("button", { type: "button", class: "hotspot",
        "aria-label": `${l.head}: show the ${l.more} more ${l.more === 1 ? "bind" : "binds"} in the list` });
      const [pw, ph] = l.page || [V.PAGE_W, V.PAGE_H];      // keyboard cards carry their own page size
      b.style.left = `${(x0 / pw) * 100}%`;
      b.style.top = `${(y0 / ph) * 100}%`;
      b.style.width = `${((x1 - x0) / pw) * 100}%`;
      b.style.height = `${((y1 - y0) / ph) * 100}%`;
      b.addEventListener("click", (e) => { e.stopPropagation(); openListAt(c, l.input); });
      layer.append(b);
    }
  }

  function openListAt(c, input) {
    const det = c.el.querySelector("details.binds");
    det.open = true;
    const target = c.el.querySelector(`.pl-block[data-input="${CSS.escape(input)}"]`) || det;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    target.classList.remove("is-target");
    void target.offsetWidth;                       // restart the highlight
    target.classList.add("is-target");
    const h = target.querySelector("h4");
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }

  /** "Every bind, in full": HTML inside the card's collapsed <details>; it prints only when open. */
  function fillList(c, result) {
    const det = c.el.querySelector("details.binds");
    const list = c.el.querySelector(".bind-list");
    list.replaceChildren();
    if (!result.listData) { det.hidden = true; return; }      // the list-only card already shows its list
    det.hidden = false;
    const d = result.listData;
    const viewName = c.view === "all" ? "All modes" : (M.MODES.find((m) => m.id === c.view) || {}).name;
    const legend = el("p", { class: "pl-legend" });
    for (const m of d.legend) {
      const dot = el("span", { class: "pl-dot", "aria-hidden": "true" });
      dot.style.background = m.colour;
      const name = el("span", { text: m.name });
      name.style.color = m.colour;
      legend.append(el("span", { class: "pl-mode" }, dot, name));
    }
    const cols = el("div", { class: "pl-cols" });
    for (const b of d.blocks) {
      const ul = el("ul");
      for (const e of b.entries) {
        const dot = el("span", { class: "pl-dot", "aria-hidden": "true" });
        dot.style.background = e.colour;
        const mode = el("span", { class: "pl-tag", text: ` ${e.mode}${e.tags.length ? " · " + e.tags.join(", ") : ""}` });
        mode.style.color = e.colour;
        ul.append(el("li", null, dot, document.createTextNode(e.text), mode));
      }
      cols.append(el("section", { class: "pl-block", "data-input": b.input }, el("h4", { text: b.head }), ul));
    }
    const foot = el("div", { class: "pl-foot" });
    for (const t of d.foot) foot.append(el("p", { text: t }));
    list.append(el("h3", { text: `${stickLabel(c)}: every bind, in full (${viewName})` }),
                el("p", { class: "pl-dev", text: `${c.device} · Star Citizen ${DATA.meta.version}` }), legend, cols, foot);
  }

  const KB_DEFAULT_VIEW = "flight";
  const viewLabel = (v) => (v === "all" ? "all modes" : ((M.MODES.find((m) => m.id === v) || {}).name || v));

  /** Keyboard cheat-sheet set: one keyboard page per mode that has binds (card only), then print.
   *  dryRun = build the set and mark the page for printing, without opening the print dialog (tests). */
  async function printKeyboardModes(c, dryRun) {
    const binds = keyboardBinds();
    const modes = modesFor(c);
    document.querySelectorAll(".kb-print-set").forEach((n) => n.remove());
    const set = el("div", { class: "kb-print-set", "aria-hidden": "true" });
    const loads = [];
    for (const m of modes) {
      const r = KK.renderKeyboard({ binds, view: m.id, gameVersion: DATA.meta.version, generated: stamp() });
      const img = el("img", { alt: `Keyboard: ${m.name}` });
      loads.push(new Promise((ok) => { img.onload = ok; img.onerror = ok; }));
      img.src = blobUrl(r.pageSvg, "image/svg+xml");
      set.append(el("div", { class: "kb-print-page" }, img));
    }
    document.body.append(set);
    document.body.classList.add("print-kb-modes");
    await Promise.all(loads);
    if (dryRun) return modes.length;
    const done = () => { document.body.classList.remove("print-kb-modes"); set.remove(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
    return modes.length;
  }

  function modesFor(c) {
    const binds = c.kind === "kb" ? keyboardBinds()
      : R.resolveFull(state.exp, DATA, "all").filter((b) => b.instance === c.inst && b.ui);
    const ids = new Set(binds.map((b) => M.modeOf(b.actionmap).id));
    return M.MODES.filter((m) => ids.has(m.id));
  }

  function buildCard(c) {
    const gripSel = el("select", { "aria-label": `${stickLabel(c)} grip` });
    // only grips for this stick's side (QA B 2026-11-11); a stick of unknown side gets every grip
    for (const [key, t] of Object.entries(VKB.templates)) {
      if (c.side && t.side !== c.side) continue;
      if (!state.artAvailable) break;                 // no VKB art in this copy: don't offer pictures it can't show
      gripSel.append(el("option", { value: key, text: t.title.replace(/^VKB /, "") }));
    }
    gripSel.append(el("option", { value: "list",
      text: state.artAvailable ? "Other stick: list only" : "List only (pictures not included in this copy)" }));
    gripSel.value = c.grip;

    const viewSel = el("select", { "aria-label": `${stickLabel(c)} view` });
    viewSel.append(el("option", { value: "all", text: "All modes" }));
    const modes = modesFor(c);
    for (const m of modes) viewSel.append(el("option", { value: m.id, text: m.name }));
    // the keyboard opens on one mode (Master 2026-11-11: All modes is too dense to read): Flight, else the first mode
    if (c.kind === "kb" && !c.view) c.view = modes.some((m) => m.id === KB_DEFAULT_VIEW) ? KB_DEFAULT_VIEW : (modes[0] ? modes[0].id : "all");
    viewSel.value = c.view;

    const pngBtn = el("button", { type: "button", class: "btn btn-primary", text: "Download PNG" });
    const svgBtn = el("button", { type: "button", class: "btn", text: "Download SVG" });
    const zoomBtn = el("button", { type: "button", class: "btn", "aria-pressed": "false", text: "Actual size" });
    const shot = el("div", { class: "shot" }, el("img", { alt: "" }), el("div", { class: "hotspots" }));
    const sheet = el("div", { class: "sheet", title: "Click to switch between fit and actual size" }, shot);
    const summary = el("summary", { text: "Show every bind" });
    const details = el("details", { class: "binds" }, summary, el("section", { class: "bind-list" }));
    details.addEventListener("toggle", () => { summary.textContent = details.open ? "Hide the list" : "Show every bind"; });
    const offNote = el("button", { type: "button", class: "btn btn-quiet off-note", hidden: "" });
    offNote.addEventListener("click", () => openListAt(c, "off-picture"));

    // downloads follow the toggle (like print): list closed = the card page only; open = card + full list
    // only cards whose download has a "card + list" version (the stick cards) switch on the list
    const withList = () => details.open && !details.hidden && c.result && c.result.svg !== c.result.pageSvg;
    const downloadSvg = () => (withList() || !c.result.pageSvg ? c.result.svg : c.result.pageSvg);
    const fileBase = () => `${slug(c.device)} - ${viewLabel(c.view)}${withList() ? " + list" : ""}`;
    gripSel.addEventListener("change", () => { c.grip = gripSel.value; render(c); });
    viewSel.addEventListener("change", () => { c.view = viewSel.value; render(c); });
    svgBtn.addEventListener("click", () => download(blobUrl(downloadSvg(), "image/svg+xml"), fileBase() + ".svg"));
    pngBtn.addEventListener("click", async () => {
      pngBtn.disabled = true;
      const label = pngBtn.textContent;
      pngBtn.textContent = "Drawing PNG…";
      try {
        const img = new Image();
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("The browser could not draw the card.")); img.src = blobUrl(downloadSvg(), "image/svg+xml"); });
        const canvas = el("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const g = canvas.getContext("2d");
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0);
        const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
        if (!blob) throw new Error("The browser could not make the PNG.");
        download(blobUrl(blob, "image/png"), fileBase() + ".png");
      } catch (e) {
        setStatus(e.message + " Use Download SVG instead.", true);
      } finally {
        pngBtn.textContent = label;
        pngBtn.disabled = false;
      }
    });
    const toggleZoom = () => {
      const on = sheet.classList.toggle("is-actual");
      zoomBtn.setAttribute("aria-pressed", String(on));
      zoomBtn.textContent = on ? "Fit to width" : "Actual size";
    };
    zoomBtn.addEventListener("click", toggleZoom);
    sheet.addEventListener("click", toggleZoom);
    // QA C D2: on wide screens the keyboard opens at actual size inside its own scrolling frame (the page itself
    // never scrolls sideways); "Fit to width" switches back. Phones keep fit-to-width.
    if (c.kind === "kb" && window.matchMedia("(min-width: 1024px)").matches) toggleZoom();

    const controls = el("div", { class: "controls" },
      c.kind === "kb" ? null : el("label", { class: "pick" }, el("span", { text: "Grip" }), gripSel),
      el("label", { class: "pick" }, el("span", { text: "View" }), viewSel));
    let kbExtras = null;
    if (c.kind === "kb") {
      const allBtn = el("button", { type: "button", class: "btn", text: "Print every mode" });
      allBtn.addEventListener("click", () => printKeyboardModes(c));
      kbExtras = allBtn;
    }
    const bar = el("div", { class: "card-bar" },
      el("h2", { text: stickLabel(c) }),
      el("span", { class: "sub", text: c.device }),
      controls,
      el("div", { class: "actions" }, pngBtn, svgBtn, zoomBtn, kbExtras),
      c.kind === "kb" ? el("p", { class: "view-hint", text: "Pick a mode: the full keyboard has too many binds to show at once." }) : null,
      offNote);
    c.el = el("article", { class: "card card-built", "aria-label": stickLabel(c) }, bar,
      el("div", { class: "clipped" }, el("span", { class: "clip", "aria-hidden": "true" }), el("div", { class: "paper" }, sheet)),
      details);
    return c.el;
  }

  function clearBoard() {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    board.querySelectorAll(".card-built").forEach((n) => n.remove());
    emptyCard.hidden = false;
    clearBtn.hidden = true;
    printBtn.hidden = true;
    dstick.hidden = true;
    bay.classList.remove("is-loaded");
    deck.classList.remove("is-loaded");
    state = null;
  }

  async function load(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const f = files.find((x) => /\.xml$/i.test(x.name));
    if (!f) {
      setStatus("That isn't an XML file. Export your controls in Star Citizen (Options, Keybindings) and drop the .xml it writes.", true);
      return;
    }
    let exp;
    try {
      exp = R.parseExport(await f.text());
    } catch (e) {
      setStatus(`${f.name} isn't a Star Citizen keybind export. Use the .xml from the game's Controls\\Mappings folder.`, true);
      return;
    }
    // no joysticks is fine now: the keyboard card still applies (Stage C)
    clearBoard();
    // is the VKB art in this copy? (public builds leave art/vkb/ out; loading is a local <script>, never a fetch)
    const artAvailable = !!(await loadArt(Object.keys(VKB.templates)[0]));
    const cards = Array.from(exp.devices.entries()).map(([inst, device]) => {
      const side = sideOf(device);
      return { inst, device, side, grip: artAvailable && isVkb(device) && side ? defaultGrip(side) : "list", view: "all" };
    });
    const rank = (c) => (c.side === "R" ? 0 : c.side === "L" ? 1 : 2);
    cards.sort((a, b) => rank(a) - rank(b) || a.inst - b.inst);
    const di = cards.find((c) => c.inst === R.DEFAULT_STICK_INSTANCE);
    cards.push({ kind: "kb", device: "Keyboard" });      // Stage C: always last; its view is picked in buildCard
    state = { exp, cards, defaultSide: (di && di.side) || "L", artAvailable };
    emptyCard.hidden = true;
    for (const c of cards) board.append(buildCard(c));
    for (const r of dstick.querySelectorAll("input")) r.checked = r.value === state.defaultSide;
    dstick.hidden = !cards.some((c) => c.side === "L") || !cards.some((c) => c.side === "R");
    await Promise.all(cards.map(render));
    bay.classList.add("is-loaded");
    deck.classList.add("is-loaded");
    clearBtn.hidden = false;
    printBtn.hidden = false;
    const extra = exp.devices.size > cards.length ? "" : "";
    setStatus(`Built ${cards.length} card${cards.length === 1 ? "" : "s"} from ${f.name}${extra}.`, false);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    board.querySelector(".card-built").scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }

  // ---- wiring
  chooseBtn.addEventListener("click", (e) => { e.stopPropagation(); input.click(); });
  bay.addEventListener("click", (e) => { if (e.target === bay || e.target.closest("p")) input.click(); });
  input.addEventListener("change", () => { load(input.files); input.value = ""; });
  clearBtn.addEventListener("click", () => { clearBoard(); setStatus(""); chooseBtn.focus(); });
  printBtn.addEventListener("click", () => window.print());
  // for the print test harness (and anyone scripting the page): load a File list the same way a drop does
  window.KBApp = { load, printKeyboardModes: (dryRun) => printKeyboardModes(state.cards.find((c) => c.kind === "kb"), dryRun) };
  dstick.addEventListener("change", (e) => {
    if (!state || e.target.name !== "dstick") return;
    state.defaultSide = e.target.value;
    state.cards.forEach(render);
  });
  let depth = 0;
  bay.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; bay.classList.add("is-over"); });
  bay.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  bay.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; bay.classList.remove("is-over"); } });
  bay.addEventListener("drop", (e) => { e.preventDefault(); depth = 0; bay.classList.remove("is-over"); load(e.dataTransfer.files); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => { if (!bay.contains(e.target)) { e.preventDefault(); load(e.dataTransfer.files); } });
  document.documentElement.dataset.ready = R && V && M && DATA && VKB ? "1" : "0";
})();
