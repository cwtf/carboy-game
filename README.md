# Car Boy foldable frontend

This workspace contains an unchanged capture of the deployed frontend and a separate, locally runnable foldable-phone adaptation.

## Attribution

CAR BOY was created by the original author featured in [the original CAR BOY Reddit post](https://www.reddit.com/r/vibecoding/comments/1vhcbr2/i_vibe_coded_a_game_called_car_boy_about_a_little/).

This repository is an unofficial modification built on top of that original game. Its changes focus on foldable-device support, responsive presentation, controls, upgrade flow, and local progress saving; credit for the original game, concept, artwork, gameplay, and production build belongs to the original author.

## Directory layout

- `index.html`, `foldable.css`, `foldable.js`, and `.nojekyll` — the self-contained GitHub Pages site at the repository root.
- `deployed-original/` — exact main HTML response, response headers, the Cloudflare-injected JavaScript response, and decoded copies of the assets embedded in the HTML.
- `foldable-src/` — the authored foldable compatibility layer.
- `foldable-game/` — generated working copy. This is the version to run and modify.
- `tools/` — deployment audit, embedded-asset extraction, and working-copy build scripts.
- `tests/` — intact-original and foldable browser regression tests.
- `test-results/` — screenshots and the machine-readable responsive test report.

The downloaded `deployed-original/index.html` is unchanged. Its SHA-256 is:

```text
8348c073afa5c7782ba3d396d1830183fbf25a61629fd1e35e062038d22a5d2e
```

## What was downloaded

The browser-facing capture is recorded in `deployed-original/download-manifest.json`, including byte sizes and SHA-256 hashes.

| File | Bytes | Origin |
| --- | ---: | --- |
| `index.html` | 16,945,347 | Unmodified main HTTP response |
| `response-headers.txt` | 569 | Main response headers |
| `cdn-cgi/challenge-platform/scripts/jsd/main.js` | 20,510 | Cloudflare-injected referenced script |
| `cdn-cgi/challenge-platform/scripts/jsd/main.headers.txt` | 1,349 | Redirect and final response headers |
| `assets/HavokPhysics-BqNY-4N9.wasm` | 2,094,563 | Decoded from the HTML's `__CARBOY_WASM__` payload |
| `audio/coin-drop.ogg` | 26,049 | Decoded from embedded data URI |
| `audio/metal-impact.ogg` | 153,266 | Decoded from embedded data URI |
| `audio/engine-loop.ogg` | 161,185 | Decoded from embedded data URI |
| `audio/music/intro-1.mp3` | 1,425,619 | Decoded from embedded data URI |
| `audio/music/intro-2.mp3` | 1,423,733 | Decoded from embedded data URI |
| `audio/music/day-1.mp3` | 1,038,951 | Decoded from embedded data URI |
| `audio/music/day-2.mp3` | 776,290 | Decoded from embedded data URI |
| `audio/music/day-3.mp3` | 1,034,236 | Decoded from embedded data URI |
| `audio/music/day-4.mp3` | 1,542,913 | Decoded from embedded data URI |
| `audio/music/day-5.mp3` | 1,501,994 | Decoded from embedded data URI |

The apparent `/assets/...wasm` and `/audio/...` deployment URLs currently return HTTP 404. They are fallback names inside the production module, not live dependencies: the main HTML assigns the complete WASM and audio bytes to globals before the module starts. The decoded files above materialize those already-downloaded bytes at their practical directory structure; `index.html` itself was not changed.

No separate game images or web fonts are requested. The world and vehicles are procedurally built in Babylon.js, shaders are in the bundle, DOM/CSS draws the overlays, and the UI uses system fonts (`Arial Black`, Impact, and fallbacks).

## Build structure discovered

- Production Vite-style ES module bundle, identified by the module-preload polyfill and hashed asset fallback path.
- Babylon.js 8.56.2, verified at runtime.
- Havok physics compiled to WebAssembly.
- Programmatic DOM overlays plus one WebGL canvas.
- First inline script: 14,906,001 bytes, primarily the Havok binary and audio data.
- Inline module bundle: 2,036,887 bytes.
- No dynamic game chunks were found. Worker code used by Babylon is blob-generated from the bundle.
- The bundle is minified/concatenated production code. Some application class/property names remain readable, but original modules, comments, TypeScript, and project structure are not present.
- No `sourceMappingURL` directive is present. Explicit checks for `/index.html.map`, `/assets/HavokPhysics-BqNY-4N9.wasm.map`, and the Cloudflare helper's `.map` all returned HTTP 404.

## Files changed or added

- `foldable-src/foldable.css` — dynamic viewport, safe-area, touch-target, frame sizing, secondary-panel, and CSS viewport-segment support.
- `foldable-src/foldable.js` — segment detection, fullscreen safe-viewport layout, live resize/orientation handling, Babylon backing-buffer synchronization, keyboard shortcuts, expanded upgrade-shop mechanics, local autosaving/New Game controls, and secondary status updates.
- `tools/build-working-copy.cjs` — regenerates `foldable-game/` from the unchanged capture and verifies the original hash.
- `tools/extract-embedded-assets.cjs` — decodes and checksums the embedded WASM/audio without changing the HTML.
- `tools/audit-deployment.mjs` — reports scripts, styles, references, asset strings, and map declarations.
- `tests/original-regression.cjs` — proves the untouched local game starts and runs.
- `tests/foldable-regression.cjs` — responsive, hinge, backing-buffer, input-coordinate, audio, and no-reload state-preservation checks. The GitHub Pages regression also verifies all seven upgrades, level/cost updates, repeat purchases, stash deduction, explicit continuation, refresh restoration, and confirmed New Game reset.

The generated `foldable-game/index.html` adds viewport metadata and references `foldable.css` and `foldable.js`. It removes only the Cloudflare deployment telemetry helper; the original copy retains that helper and its downloaded response. No game bundle, physics, scoring, controls, audio, tuning, or state code was edited.

## How foldable handling works

The game canvas now fills the complete safe viewport on ordinary screens. Babylon renders the 3D scene at the live screen aspect ratio and updates its camera projection, rather than scaling a fixed 9:16 image, so the view is wider or taller without geometric distortion. The layer uses `100dvh` when supported and falls back to `100vh`.

Safe-area insets are read from `env(safe-area-inset-*)`. The frame is always placed inside those bounds. On every window resize, `visualViewport` change, `ResizeObserver` callback, or orientation change, the layer recomputes the frame without reloading the page. Orientation changes receive delayed follow-up measurements because mobile browser chrome and segment metrics can settle asynchronously.

After the CSS size changes, the layer calls the existing Babylon engine's `resize(true)`. Babylon retains the game's original touch-device DPR cap (1.25 in this build), updates both canvas backing dimensions, and keeps the canvas CSS dimensions and buffer aspect aligned. The game controls already use `PointerEvent.clientX/clientY`; tests confirm those coordinates remain exact after each resize.

Keyboard additions reuse the production game's own state and pause UI:

- Hold either Shift key to charge RAM. The direction continuously follows the mouse cursor; release Shift to strike.
- Press Escape to open or close the existing pause menu when pausing is available.
- The original touch, pointer, and Space-bar controls remain unchanged.

The intermission upgrade shop now lists all seven production upgrades instead of three random choices. Every card shows its current level and next price. Level 1 costs 10 coins, with each subsequent level costing 10 more coins (`10 × next level`). Purchases deduct from the existing stash immediately and can be repeated for any upgrade while affordable. A separate Start Next Day button ends shopping; it does not grant an extra upgrade.


Progressive foldable support uses:

- CSS `horizontal-viewport-segments` / `vertical-viewport-segments` media queries.
- `env(viewport-segment-*)` values, read through hidden measurement probes.
- The older `window.getWindowSegments()` API when a browser still exposes it.
- A normal one-viewport responsive fallback everywhere else.

When two or more segments exist, the script chooses the largest segment for gameplay and fills that segment without crossing the hinge. The whole game, HUD, touch controls, title screen, and upgrade UI stay inside it. A read-only day/coins/combo/speed and controls summary uses the best remaining segment. Neither region crosses the hinge.

The development-only URL hooks `?foldable=vertical&hinge=32` and `?foldable=horizontal&hinge=36` reproduce segmented geometry in a desktop browser for regression testing. They are inactive in ordinary URLs.

## Autosave and New Game

Progress is stored automatically in browser `localStorage` under `carboy-progress-v1`. The checkpoint contains the current day, banked coin stash, selected upgrades, and every upgrade's level. On refresh, those values and their gameplay effects are restored before the title screen changes to `CONTINUE DAY N`.

Saving begins once a run starts and updates when progress changes, when upgrades are purchased, when the page is hidden, and when it closes. Refreshing during a fight restarts the current day from its beginning while preserving durable progress. Refreshing from an intermission checkpoints the following day so a cleared day cannot be replayed for duplicate coins.

A `NEW GAME` option is available on the continue screen, pause menu, and upgrade shop. It requires a second confirmation click, then clears the local save and reloads a clean Day 1 game.

## Running locally

Rebuild the working copy after changing the compatibility layer:

```powershell
node tools\build-working-copy.cjs
node tools\package-github-pages.cjs
```

Serve it over HTTP (ES modules should not be opened as a `file://` URL):

```powershell
python -m http.server 8000
```

Then open `http://127.0.0.1:8000/`.

The unchanged snapshot can be served independently:

```powershell
python -m http.server 8001 --directory deployed-original
```

## Verification results

The intact snapshot test starts Day 1, renders at about 60 FPS, runs its audio context, decodes all three SFX samples, and accepts controls. It also exposes the original mobile bug clearly: without viewport metadata a nominal 412×915 device receives a roughly 981×2177 CSS canvas.

The modified game was started once at 360×800, then resized through every requested size without reloading. The `CARBOY`, engine, and player object references remained identical throughout.

| Viewport | Game frame | Canvas buffer | Pointer error | Result |
| --- | --- | --- | ---: | --- |
| 360×800 | 360×800 | 450×1000 | 0 px | Pass |
| 412×915 | 412×915 | 515×1143 | 0 px | Pass |
| 717×512 | 717×512 | 896×640 | 0 px | Pass |
| 768×1024 | 768×1024 | 960×1280 | 0 px | Pass |
| 884×1104 | 884×1104 | 1105×1380 | 0 px | Pass |
| 1768×2208 | 1768×2208 | 2210×2760 | 0 px | Pass |

The sequence includes portrait-to-landscape and folded-to-unfolded changes. At every point, the game remained started, the canvas filled the safe viewport, buttons stayed within the frame and at least 44 px tall/wide, and the canvas backing buffer was updated in place. Automated gameplay checks also verified cursor-directed Shift-to-RAM in both directions and Escape pause/resume.

Two-segment tests also passed:

- Vertical hinge at 884×1104: gameplay in the first 426 px segment; secondary UI in the other segment; 32 px hinge untouched.
- Horizontal hinge at 1768×2208: gameplay in the upper segment; secondary UI in the lower segment; 36 px hinge untouched.

The final run produced no console errors, uncaught page errors, or failed runtime requests. The modified game requested only `/index.html`, `/foldable.css`, and `/foldable.js`; WASM and audio continued to use the production build's embedded copies. Full measurements are in `test-results/foldable-regression.json`, with screenshots beside it.

Run the verification again with:

```powershell
node tests\original-regression.cjs
node tests\foldable-regression.cjs
```

## Limitations

- The original source repository and source maps are not exposed, so the adaptation is a carefully isolated runtime layer over a minified production bundle rather than a source-level rebuild.
- The deployed game had no upgrade pricing logic; it granted one free random upgrade. The new 10-coins-per-next-level price curve is therefore an explicit balance rule added by this adaptation.
- Application names are partly readable, but reconstructing original modules or safely changing core physics/game logic would require source access.
- No physical foldable device was attached. Both hinge orientations were tested with deterministic viewport-segment emulation, while the production path uses the browser's real CSS segment environment values or legacy segment rectangles when available.
- The decoded asset files are archival/convenience copies. The production module still prefers the byte-identical embedded globals, preserving its deployed loading behavior.
- Saves are browser-local and origin-specific. A save made on `127.0.0.1` is separate from the GitHub Pages save, and clearing browser site data removes it.
- The deployed bundle does not expose a safe serialization format for live physics, enemies, or partially collected day coins. Refresh therefore restarts the current day rather than resuming the exact frame.

