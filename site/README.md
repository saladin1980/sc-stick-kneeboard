# Stick kneeboard

Static pages, everything in the browser: no server code, no network requests, nothing uploaded.

| Page | Does |
|---|---|
| `index.html` (Stage B, main) | Drop the game's keybind export (actionmaps XML) → one card per stick, the binds written into the **VKB Gladiator template**'s own boxes, every mode per button ("All modes" is the default view and download), a full list below. Grip and view pickers per stick, a "game defaults land on L/R" switch. |
| `jd.html` (Stage A) | Drop Joystick Diagrams' per-mode SVG exports → one merged card per stick. |

```
index.html, jd.html   the pages (CSP: default-src 'none', connect-src 'none', self-only scripts/styles)
css/kneeboard.css     cockpit-panel look; system fonts only (Bahnschrift on Windows)
data/sc-controls.js   game defaults + labels (from tool/build_controls_data.py; Star Citizen game data)
data/vkb-templates.js VKB template field boxes + field map (from tool/extract_vkb_boxes.py)
art/vkb/<KEY>.js      the template page art, loaded on demand. LOCAL ONLY (see .publishignore);
                      without it the cards fall back to the list layout
js/resolve.js         Stage B resolver (port of tool/resolve_binds.py; parity-tested)
js/modes.js           actionmap -> card mode (Flight, Weapons, Mining, …)
js/vkb.js             Stage B card renderer
js/app.js             Stage B page wiring
js/core.js, js/slotmap.js, js/jd-app.js   Stage A (port of tool/merge_diagrams.py; byte-identical output)
tests/                node tests, harness pages, a fixture copy of Sal's export: NOT part of the site
```

**Keyboard card (Stage C):** always added after the stick cards.
- `js/keyboard.js` is our own US ANSI full-size layout (104 keys, game token names).
- `js/kbd.js` renders it: plain binds first, then modifier combos with compact marks (L^/R^ Ctrl, LA/RA Alt, L⇧/R⇧ Shift).
- Mouse and other non-key binds go in the list. Same mode colours, list toggle, print and downloads as the stick cards.

**Tests** (from this folder): `node --test tests/site.test.cjs tests/stageb.test.cjs tests/stagec.test.cjs`
- Stage A: parity with the Python tool (byte-identical, on disk too) and the QA fixes.
- No-network: a scan of the shipped set plus the CSP on both pages. No personal info.
- Stage B:
  - JS resolver == Python resolver on Sal's export;
  - every shown bind is listed exactly once; 4 gameplay defaults shown, 15 menu ones hidden; 0 off the picture;
  - 8 px floor at the default width; a button number on every numbered box;
  - the default-stick switch.

**List toggle:** each card shows the picture; "Every bind, in full" is collapsed under it (`<details>`). "+N more" rows on the picture are buttons that open the list at that input. Print and downloads follow the toggle (collapsed = card only).

**Running headless Edge (screenshots, PDFs, test_merge's PNGs):** use the PowerShell tool. The sandboxed Bash tool makes Edge exit instantly with no output. Add `--force-prefers-reduced-motion` when a check depends on scrolling (smooth scroll doesn't advance under virtual time).

**Print:** "Print cards" (shown once cards exist) calls `window.print()`. The `@media print` sheet prints each stick's template page on its own landscape sheet, then its full list as HTML (3 columns, flowing across sheets), in colour. No page chrome is printed.
- Test with headless Edge `--print-to-pdf` on `/site/tests/print.html`. It loads the real `index.html` (its CSP included) plus the fixture and `tests/print-driver.js`.
- Output: `tests/screens/stageb-print.pdf`.

**Browser check** (local only): `python -m http.server --bind 127.0.0.1 8765` from the Keybinding Mapping folder.
- Stage B: open `/site/tests/harness-b.html?auto`.
- Stage A: open `/site/tests/harness.html?auto`.

**Licence:** GPL-2.0 (`..\LICENSE`), credits in `..\NOTICE`.

**Tip jar:** a plain "Support the tool" link in both footers. No widget and no script: it makes no request until clicked, and a test pins that.

**Build a publishable copy:** `python ..\tool\make_dist.py` writes `..\dist\`.

**Publishing:** not done; that's Sal's call. **What ships = everything here except what `.publishignore` lists** (`tests/`, this README, `art/vkb/`: VKB states no redistribution terms). The no-network test scans exactly that set.
