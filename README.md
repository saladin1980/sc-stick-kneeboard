# Stick kneeboard

Your Star Citizen keybinds written onto your stick and keyboard: one card per stick (VKB Gladiator templates)
and a full keyboard, with every mode on each button. Drop the controls file the game exports; nothing leaves your
browser.

- **`site/index.html`**: drop your Star Citizen keybind export (the XML the game writes when you export your
  controls, in `StarCitizen\LIVE\user\client\0\Controls\Mappings\`). You get:
  - one card per stick on the VKB Gladiator template (SCG / SCG Omni-Throttle, left and right), every bind
    written into the template's own boxes;
  - a full US ANSI keyboard card;
  - a mode picker, SVG/PNG download and print ("Print every mode" gives a keyboard cheat-sheet set).
- **`site/jd.html`**: if you use [Joystick Diagrams](https://joystick-diagrams.com/), drop its per-mode SVG
  exports and get one merged card per stick.
- **Private by design:** a static page with a strict Content Security Policy (`connect-src 'none'`). Your file
  is read in the browser and never uploaded; the page makes no network requests.

## Repository layout
| Folder | What |
|---|---|
| `site/` | the static site. What ships = `site/` minus `site/.publishignore` |
| `tool/` | build tools: game data (`build_controls_data.py`), VKB templates (`fetch_vkb_templates.py`, `extract_vkb_boxes.py`), the publishable copy (`make_dist.py`), the Joystick Diagrams merge (`merge_diagrams.py`), the oracle checks |
| `site/tests/` | node tests plus fixtures: a sanitised example export and a small synthetic Joystick Diagrams sample |

## Tests
```
cd site && node --test tests/site.test.cjs tests/stageb.test.cjs tests/stagec.test.cjs
cd tool && python -m unittest test_merge test_oracle test_dist
```
Some checks need local files that are not in this repo (a real game install, the decoded game data, real
Joystick Diagrams exports); they skip with a reason. `test_merge` renders PNGs with Microsoft Edge.

## Updating the game data after a patch
Needs a local Star Citizen install. See `tool/README.md` (its own venv with a pinned `scdatatools`):
`build_controls_data.py` → `site/data/`, and `oracle/decode_default_profile.py` for the oracle check.

## Deploy (Cloudflare Pages, connected to this repo)
In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git →** pick this repository, then:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `python tool/make_dist.py` |
| Build output directory | `dist` |
| Root directory | *(leave empty: repository root)* |
| Environment variable | `PYTHON_VERSION` = `3.12` |

`make_dist.py` (standard library only) copies exactly the shipped set into `dist/`, adds `LICENSE`, `NOTICE`
and a `_headers` file (the page's CSP as an HTTP header plus `frame-ancestors 'none'`, `nosniff`,
`no-referrer`). No other build step.

## Licence and credits
GPL-2.0, see `LICENSE`. Credits (Joystick Diagrams, VKB / UntoldForce templates, Star Citizen data) are in
`NOTICE`. An unofficial fan tool, not affiliated with Cloud Imperium Games or VKB.

If it helps you: [support the tool](https://www.buymeacoffee.com/mbtech).
