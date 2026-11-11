/* TEST ONLY: loads the fixture export into the real page, then marks the page ready to print.
 * print.html?expanded opens every card's "Every bind" list first (to print card + list); without it the
 * lists stay collapsed, the default (card pages only). */
(async () => {
  const file = new File([globalThis.KB_FIXTURE_XML], "layout_exported.xml", { type: "text/xml" });
  await window.KBApp.load([file]);
  if (location.search.includes("expanded")) document.querySelectorAll("details.binds").forEach((d) => { d.open = true; });
  // ?kbmodes: build the keyboard "Print every mode" set (no dialog) so --print-to-pdf prints exactly that
  if (location.search.includes("kbmodes")) document.documentElement.dataset.kbmodes = String(await window.KBApp.printKeyboardModes(true));
  const imgs = Array.from(document.querySelectorAll(".sheet img"));
  await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
  document.documentElement.dataset.printready = String(imgs.filter((i) => i.naturalWidth > 0).length);
  // layout facts for checks: page sideways scroll, keyboard zoom state and frame
  const kb = [...document.querySelectorAll(".card-built")].at(-1);
  const sheet = kb.querySelector(".sheet"), kimg = kb.querySelector(".sheet img");
  document.documentElement.dataset.layout = `vw=${innerWidth} pageScrollW=${document.documentElement.scrollWidth} ` +
    `kbActual=${sheet.classList.contains("is-actual")} kbImg=${Math.round(kimg.getBoundingClientRect().width)} ` +
    `kbFrame=${Math.round(sheet.clientWidth)} kbFrameScrolls=${sheet.scrollWidth > sheet.clientWidth} ` +
    `zoomBtn=${[...kb.querySelectorAll(".actions button")].find((b) => /size|width/i.test(b.textContent)).textContent}`;
  // ?jump: click the left card's "+N more" hotspot for button 22 and record whether its list block lands on screen
  if (location.search.includes("jump")) {
    await new Promise((r) => setTimeout(r, 1500));          // let the load-time scroll finish first
    const L = document.querySelectorAll(".card-built")[1];
    const y0 = scrollY;
    [...L.querySelectorAll(".hotspot")].find((b) => b.getAttribute("aria-label").startsWith("22 ")).click();
    await new Promise((r) => setTimeout(r, 1500));
    const t = L.querySelector(".pl-block.is-target");
    const r = t.getBoundingClientRect();
    document.documentElement.dataset.jump = `${t.dataset.input} top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} vh=${innerHeight} scrollY ${Math.round(y0)}->${Math.round(scrollY)} onscreen=${r.top >= 0 && r.bottom <= innerHeight}`;
  }
})();
