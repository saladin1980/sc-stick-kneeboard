# Keybinding Mapping — tools

| Script | Does | Needs |
|---|---|---|
| `merge_diagrams.py` | v1: merges Joystick Diagrams' per-mode SVGs in `..\` into `..\merged\<device> - all modes.svg/.png` | Python 3.10+, stdlib (PNG via headless Edge) |
| `build_controls_data.py` | Stage B: reads `defaultProfile.xml` + `global.ini` from the game's `Data.p4k` **read-only**, writes `..\site\data\sc-controls-<version>.json` | `.venv` below |
| `resolve_binds.py` | Stage B reference resolver: export XML + data → effective joystick binds (the site's JS ports it) | stdlib |
| `oracle_diff.py` | Stage B gate: (1) reproduces JD's 13 diagrams exactly, (2) explains every difference of the full result, (3) checks the VKB numbering against the templates + slotmap | stdlib |
| `fetch_vkb_templates.py` | downloads VKB's Gladiator fillable PDFs into `..\Templates\vkb\` (skips existing files, records SHA-256 in `templates.json`). Never touches Sal's own files in `Templates\` | stdlib |
| `extract_vkb_boxes.py` | reads the PDFs' form fields → `..\site\data\vkb-templates.json`; renders page art → `..\site\art\vkb\` (local only, see `.publishignore`) | `.venv` + `pip install pymupdf` (build-time only) |
| `oracle\decode_default_profile.py` | regenerates the keyboard oracle's reference `oracle\defaultProfile-<version>.decoded.xml` from the game (read-only). Run after each patch, with `build_controls_data.py`. Shares scdatatools' decoder with the build, not its parsing | `.venv` |
| `make_dist.py` | builds the publishable copy into `..\dist\`: exactly `site\` minus `.publishignore`, plus LICENSE, NOTICE and a Cloudflare Pages `_headers` (the CSP from index.html + `frame-ancestors 'none'`, nosniff, no-referrer). `--with-vkb-art` = Sal's local copy only. Build only, never deploys | stdlib |
| `vkb_fieldmap.json` | VKB form field → Star Citizen input (button numbers from Sal's numbered VKB JPGs) | — |

```
python merge_diagrams.py
.venv\Scripts\python -B build_controls_data.py
python oracle_diff.py --xml "<newest actionmaps export>" --data ..\site\data\sc-controls-<version>.json
python -m unittest -v test_merge test_oracle test_dist      # run from PowerShell: test_merge's PNG step needs Edge
```

## The data-build venv (`.venv`, this project's own)
`scdatatools` 1.0.4 from PyPI can read `Data.p4k` and decode CryXmlB, with two caveats:
- **Its metadata pins old packages** (numpy ~1.21, rich ~12.4) that don't install on Python 3.12. So install with `--no-deps` from our pinned list.
- **It needs a 2-line fix** to open current p4k files (longer ZIP64 extra fields). Without it you get `BadZipFile: Corrupt extra field 0001 (size=18)`.

Rebuild from scratch (Python 3.12):
```
python -m venv .venv
.venv\Scripts\python -m pip install --no-deps -r requirements-data.txt
.venv\Scripts\python patch_scdatatools.py
```
Verified 2026-11-11: this venv builds JSON identical (apart from the timestamp) to a build made with another, independently set-up scdatatools environment.

**Use this project's own venv.** Don't borrow or repair another project's environment for the data build.

## Safety
- The game folder is read-only. `build_controls_data.py` fingerprints `Data.p4k` (size + mtime) and `build_manifest.id` (SHA-256) before and after, and aborts if anything changed. It refuses an output folder inside the game folder.
- `merge_diagrams.py` refuses to write into the export folder. Sal's exports are only read.

## Licences
`oracle\jd_star_citizen_plugin.json` is data copied from Joystick Diagrams' Star Citizen plugin (GPL-2.0), used only by the oracle. `scdatatools` is MIT. The JSON in `..\site\data\` is derived from Star Citizen game data (Cloud Imperium Games). Publishing it is Sal's call.
