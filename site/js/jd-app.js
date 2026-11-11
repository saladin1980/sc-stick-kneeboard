/* Stick kneeboard: page wiring. Reads dropped files locally (File.text()),
 * merges with KBMap (core.js), shows one card per stick, and builds downloads
 * as blob URLs. No network APIs anywhere; the page's CSP also blocks them. */
(function () {
  "use strict";
  const KB = window.KBMap;
  const SLOTMAP = window.KBMAP_SLOTMAP;

  const bay = document.getElementById("bay");
  const input = document.getElementById("file");
  const chooseBtn = document.getElementById("choose");
  const clearBtn = document.getElementById("clear");
  const statusEl = document.getElementById("status");
  const manifestEl = document.getElementById("manifest");
  const board = document.getElementById("board");
  const emptyCard = document.getElementById("empty");
  const deck = document.querySelector(".deck");

  let urls = [];   // blob URLs to revoke on the next load

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

  function stamp() {
    const d = new Date(), p = (v) => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function stickName(dev) {
    if (dev.side === "R") return "Right stick";
    if (dev.side === "L") return "Left stick";
    return dev.name;
  }

  function setStatus(msg, isError, list) {
    statusEl.className = "status" + (isError ? " is-error" : "");
    statusEl.textContent = msg;
    if (list && list.length) {
      const ul = el("ul");
      for (const item of list) ul.append(el("li", { text: item }));
      statusEl.append(ul);
    }
  }

  function svgUrl(svg) {
    const u = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    urls.push(u);
    return u;
  }

  function download(url, name) {
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
  }

  async function pngUrl(svgBlobUrl, w, h, scale) {
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("The browser could not draw the SVG."));
      img.src = svgBlobUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The browser could not make the PNG.");
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  }

  function renderManifest(devices) {
    manifestEl.replaceChildren();
    for (const dev of devices) {
      const colours = KB.modeColours(dev.modes);
      const used = new Set();
      for (const s of dev.slots.values()) for (const m of s.binds.keys()) used.add(m);
      const ul = el("ul");
      for (const m of dev.modes) {
        const sw = el("span", { class: "swatch", "aria-hidden": "true" });
        sw.style.background = colours[m];
        const li = el("li", { class: used.has(m) ? "" : "is-empty" }, sw,
          document.createTextNode(used.has(m) ? m : `${m} (no binds, left off the card)`));
        ul.append(li);
      }
      manifestEl.append(el("div", null, el("h3", { text: `${stickName(dev)}: ${dev.modes.length} mode files` }), ul));
    }
  }

  function buildCard(dev, generated) {
    const { svg, width, height, stats } = KB.renderSvg(dev, generated);
    const base = `${dev.name} - all modes`;
    const sUrl = svgUrl(svg);

    const pngBtn = el("button", { type: "button", class: "btn btn-primary", text: "Download PNG" });
    const svgBtn = el("button", { type: "button", class: "btn", text: "Download SVG" });
    const zoomBtn = el("button", { type: "button", class: "btn", "aria-pressed": "false", text: "Actual size" });

    const img = el("img", { src: sUrl, width: String(width), height: String(height),
      alt: `${stickName(dev)}: ${stats.binds} binds across ${stats.modes} modes on the ${dev.template || dev.name} diagram` });
    const sheet = el("div", { class: "sheet" }, img);

    svgBtn.addEventListener("click", () => download(sUrl, base + ".svg"));
    pngBtn.addEventListener("click", async () => {
      pngBtn.disabled = true;
      const label = pngBtn.textContent;
      pngBtn.textContent = "Drawing PNG…";
      try {
        download(await pngUrl(sUrl, width, height, 2), base + ".png");
      } catch (e) {
        setStatus(e.message + " Use Download SVG instead.", true);
      } finally {
        pngBtn.textContent = label;
        pngBtn.disabled = false;
      }
    });
    zoomBtn.addEventListener("click", () => {
      const on = sheet.classList.toggle("is-actual");
      zoomBtn.setAttribute("aria-pressed", String(on));
      zoomBtn.textContent = on ? "Fit to width" : "Actual size";
    });

    const sub = `${dev.name}, ${stats.modes} modes, ${stats.binds} binds on ${stats.inputs} inputs`;
    const bar = el("div", { class: "card-bar" },
      el("h2", { text: stickName(dev) }),
      el("span", { class: "sub", text: sub }),
      el("div", { class: "actions" }, pngBtn, svgBtn, zoomBtn));
    const clipped = el("div", { class: "clipped" },
      el("span", { class: "clip", "aria-hidden": "true" }),
      el("div", { class: "paper" }, sheet));
    return el("article", { class: "card card-built", "aria-label": stickName(dev) }, bar, clipped);
  }

  function clearBoard() {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    board.querySelectorAll(".card-built").forEach((n) => n.remove());
    manifestEl.replaceChildren();
    emptyCard.hidden = false;
    clearBtn.hidden = true;
    bay.classList.remove("is-loaded");
    deck.classList.remove("is-loaded");
  }

  async function load(fileList) {
    const all = Array.from(fileList || []);
    if (!all.length) return;
    const svgs = all.filter((f) => /\.svg$/i.test(f.name));
    const others = all.length - svgs.length;
    if (!svgs.length) {
      setStatus("No SVG files in that drop. Joystick Diagrams writes an SVG next to each PNG: use those.", true);
      return;
    }
    const files = await Promise.all(svgs.map(async (f) => ({ name: f.name, text: await f.text() })));
    const { devices, skipped } = KB.readSources(files, SLOTMAP);
    if (!devices.length) {
      setStatus("These SVGs don't look like Joystick Diagrams exports. Expected names like " +
        "02002-VKBsim Gladiator EVO R-Spaceship.svg.", true, skipped);
      return;
    }
    clearBoard();
    // right stick first, then left, then anything else
    const rank = (d) => (d.side === "R" ? 0 : d.side === "L" ? 1 : 2);
    devices.sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : 1));
    const generated = stamp();
    emptyCard.hidden = true;
    for (const dev of devices) board.append(buildCard(dev, generated));
    renderManifest(devices);
    bay.classList.add("is-loaded");
    deck.classList.add("is-loaded");
    clearBtn.hidden = false;

    const notes = [];
    if (others) notes.push(`${others} non-SVG file${others === 1 ? "" : "s"} skipped.`);
    if (skipped.length) notes.push(`${skipped.length} SVG${skipped.length === 1 ? " doesn't" : "s don't"} match the Joystick Diagrams naming and ${skipped.length === 1 ? "was" : "were"} skipped: ${skipped.join(", ")}`);
    for (const d of devices) for (const w of d.warnings) notes.push(w);
    const n = devices.length;
    setStatus(`Built ${n} card${n === 1 ? "" : "s"} from ${files.length - skipped.length} exports.`, false, notes);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    board.querySelector(".card-built").scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }

  // ---- wiring
  chooseBtn.addEventListener("click", (e) => { e.stopPropagation(); input.click(); });
  bay.addEventListener("click", (e) => { if (e.target === bay || e.target.closest("p")) input.click(); });
  input.addEventListener("change", () => { load(input.files); input.value = ""; });
  clearBtn.addEventListener("click", () => { clearBoard(); setStatus(""); chooseBtn.focus(); });

  let depth = 0;
  bay.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; bay.classList.add("is-over"); });
  bay.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  bay.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; bay.classList.remove("is-over"); } });
  bay.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    bay.classList.remove("is-over");
    load(e.dataTransfer.files);
  });
  // a drop anywhere else on the page shouldn't navigate away from it
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => { if (!bay.contains(e.target)) { e.preventDefault(); load(e.dataTransfer.files); } });
  document.documentElement.dataset.ready = KB && SLOTMAP ? "1" : "0";   // lets checks see the scripts ran
})();
