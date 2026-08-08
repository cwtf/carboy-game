# CAR BOY foldable frontend

An unofficial responsive and foldable-device adaptation of CAR BOY, built as an isolated runtime layer around an unchanged capture of the deployed game.

**Play the adaptation: <https://cwtf.github.io/carboy-game/>**

## Attribution

CAR BOY was created by [u/QuipPro](https://www.reddit.com/user/QuipPro/), who shared it in [the original CAR BOY Reddit post](https://www.reddit.com/r/vibecoding/comments/1vhcbr2/i_vibe_coded_a_game_called_car_boy_about_a_little/).

This repository is an unofficial modification. Credit for the original game, concept, artwork, gameplay, and production build belongs to u/QuipPro. The adaptation adds foldable-device support, responsive presentation, keyboard controls, vehicles, a skill economy, and local progress saving.

## Current adaptation

- Full-safe-viewport rendering on phones, tablets, desktops, and foldables.
- Live resize and orientation changes without reloading the current run.
- Hinge-aware placement using CSS viewport segments, the legacy Window Segments API, or a normal single-viewport fallback.
- Original touch and pointer controls, plus keyboard shortcuts.
- Three currently playable vehicles: CAR BOY, VACUUM, and HELICOPTER.
- A garage and repeat-purchase skill shop between days.
- Shared skills and separate skill levels for each vehicle.
- Browser-local autosave, legacy-save migration, continue support, and confirmed New Game controls.
- A self-contained GitHub Pages build with no runtime CDN or package dependency.

## Controls

- Drag on the game screen to steer.
- Hold the on-screen action button to use the active vehicle's ability.
- Hold either Shift key to use that ability from a keyboard.
- While driving CAR BOY, move the mouse while holding Shift to aim, then release Shift to ram.
- Press Escape to open or close the existing pause menu when pausing is available.
- The original touch, pointer, and Space-bar controls remain available.

## Vehicles

Vehicle unlocks are based on the current day. Once unlocked, an enabled vehicle remains available and can be selected for free from the garage at any intermission.

| Vehicle | Unlock | Action | Current behavior |
| --- | ---: | --- | --- |
| CAR BOY | Day 1 | `RAM` | The original charge, aim, and ram path. |
| VACUUM | Day 5 | `SUCK` | Still rams on contact. Suction pulls every rival in range toward the intake; rivals that reach it are swallowed. The tank drains while held and recharges after release. |
| HELICOPTER | Day 10 | `BLOW` | Hovers above collisions, so it cannot hit or be hit. Downwash pushes every rival in range radially outward. The burst has a limited duration and recharge. |
| TOASTER | Day 15 | `LAUNCH` | **Disabled.** Its implemented mechanic captures rivals in bread slots and launches them toward the nearest usable cliff. |

The toaster is retained behind `enabled: false` in `foldable-src/foldable.js`. It is hidden from the garage and shop, cannot be selected, and a save that names it falls back to CAR BOY. Its skill levels are still read and written, so re-enabling it restores previously saved levels. Its dormant mechanics test is skipped while the flag is off.

The helicopter and vacuum abilities are radial rather than directional. They take authority over the relevant part of a rival's velocity because the production AI accelerates strongly enough to cancel a normal impulse. Swallowed rivals use the production fall handler, preserving normal coins, knockout counting, and cleanup.

The toaster's nearest-cliff implementation sweeps headings around the vehicle and looks for a clear run of open air. That matters because the arena contains several islands joined by bridges; simply firing away from an island center can land a rival on a bridge.

## Skills and shop

The intermission screen presents the garage, shared skills, the active vehicle's individual skills, and an explicit button to start the next day. Switching vehicles is free. Purchases immediately deduct from the coin stash and may be repeated while affordable.

The next level costs `10 × (current level + 1)` coins: Level 1 costs 10, Level 2 costs 20, and so on. Most percentage-based gameplay effects compound once per level; the coin multiplier adds 10 percentage points per level.

Shared skills apply to every vehicle:

- `COIN MAGNET`: 35% more magnet range per level.
- `COIN MULTIPLIER`: 10% more value from banked coins per level.

Individual skills are stored separately for each vehicle:

| Vehicle | Skills |
| --- | --- |
| CAR BOY | Speed +18%, push +22%, mass +16% and knockback taken −18%, ram force +25%, grip +30%, charge time −18% |
| VACUUM | Speed +18%, suction power +10%, range +10%, duration +25%, recharge time −25% |
| HELICOPTER | Speed +18%, downwash range +5%, power +10%, duration +25%, recharge time −25% |
| TOASTER (disabled) | Speed +18%, capacity +1 rival, launch range +25%, recharge time −30% |

## Autosave and New Game

Durable progress is stored in browser `localStorage` under `carboy-progress-v2`. The checkpoint contains:

- current day;
- banked coin stash;
- selected vehicle;
- shared skill levels; and
- every vehicle's individual skill levels, including the disabled toaster.

A `carboy-progress-v1` save is migrated when read: magnet levels become the shared magnet skill, remaining upgrades become CAR BOY skills, and the run resumes in CAR BOY.

Saving begins after a run starts and updates as progress changes, after purchases or vehicle changes, when the page becomes hidden, and when it closes. Refreshing during a fight restarts that day while preserving durable progress. Refreshing from an intermission checkpoints the following day, preventing a cleared day from being replayed for duplicate coins.

When a save exists, the title screen shows `CONTINUE DAY N` with a save summary. `NEW GAME` is available on the title screen, pause menu, and shop. It requires a second confirmation within 3.5 seconds, then clears both supported save keys and reloads a clean Day 1 game.

Saves are origin-specific. Progress on `127.0.0.1` is separate from progress on GitHub Pages, and clearing browser site data removes it.

## Foldable and responsive behavior

On an ordinary screen, the canvas fills the complete safe viewport. Babylon renders at the current screen aspect ratio and updates the camera projection instead of stretching a fixed 9:16 frame. The layout uses `100dvh` when available and falls back to `100vh`.

Safe-area insets are read from `env(safe-area-inset-*)`. Layout is recomputed after window, visual viewport, element-size, orientation, or viewport-segment changes. Follow-up orientation measurements account for mobile browser chrome and segment metrics that settle asynchronously.

After a CSS size change, the compatibility layer calls the existing Babylon engine's `resize(true)`. It does not set canvas buffer dimensions directly. This preserves the production game's device-pixel-ratio cap and keeps pointer coordinates aligned with the backing buffer.

Segment information is resolved from these sources, in order:

1. Development-only URL simulation hooks.
2. The legacy `window.getWindowSegments()` API.
3. CSS `env(viewport-segment-*)` values.
4. A normal single-viewport fallback.

When multiple segments exist, gameplay occupies the largest segment and never crosses the hinge. A read-only day, coins, combo, speed, vehicle, ability, controls, and status panel uses the best remaining segment.

The development hooks `?foldable=vertical&hinge=32` and `?foldable=horizontal&hinge=36` reproduce segmented geometry in a desktop browser. They are inactive on ordinary URLs.

## Source of truth and generated files

The original unminified game source and source maps are not available. The production Vite-style bundle is minified and concatenated, so this project keeps all modifications in a separate compatibility layer.

```text
foldable-src/{foldable.css,foldable.js}       authored runtime source
  └─ tools/build-working-copy.cjs            generates foldable-game/
       └─ tools/package-github-pages.cjs      generates the deployable root files
```

Edit only `foldable-src/foldable.css` and `foldable-src/foldable.js` for runtime changes. Do not directly edit:

- `foldable-game/`, which is a generated development build;
- the root `index.html`, `foldable.css`, or `foldable.js`, which are generated deployment files; or
- `deployed-original/`, which is the preserved capture.

The build verifies that `deployed-original/index.html` still has this SHA-256:

```text
8348c073afa5c7782ba3d396d1830183fbf25a61629fd1e35e062038d22a5d2e
```

The generated game adds viewport metadata and local references to `foldable.css` and `foldable.js`. It removes only the captured Cloudflare telemetry helper. The package step adds page metadata, an inline favicon, `.nojekyll`, and a check that all markup references remain local for GitHub Pages project-subpath hosting.

## Repository layout

- `foldable-src/`: authored compatibility-layer CSS and JavaScript.
- `foldable-game/`: generated development build and build manifest.
- `index.html`, `foldable.css`, `foldable.js`, `.nojekyll`: generated, self-contained GitHub Pages site.
- `deployed-original/`: unchanged deployed HTML response, headers, Cloudflare helper response, and decoded archival copies of embedded assets.
- `tools/`: build, packaging, embedded-asset extraction, and deployment-audit scripts.
- `tests/`: standalone browser regression scripts.
- `test-results/`: screenshots and machine-readable reports from the latest checked-in run.
- `GITHUB_PAGES.md`: deployment notes.

## Prerequisites

There is no `package.json`, local npm dependency, bundler, or aggregate test runner. Build tools use Node.js built-ins only.

For building and local play:

- Node.js;
- Python 3, or another static HTTP server.

For browser regression tests:

- Microsoft Edge;
- Playwright resolvable from outside this repository.

The tests recognize these optional environment variables when the defaults do not match your machine:

- `PLAYWRIGHT_MODULE`: absolute path to Playwright's module entry point.
- `EDGE_PATH`: absolute path to the Edge executable. The default is `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.

## Build and run locally

Generate the development build after changing the authored compatibility layer:

```powershell
node tools\build-working-copy.cjs
```

Serve it over HTTP because the ES module bundle does not run from a `file://` URL:

```powershell
python -m http.server 8000 --directory foldable-game
```

Open <http://127.0.0.1:8000/>.

Generate the deployable GitHub Pages files at the repository root:

```powershell
node tools\package-github-pages.cjs
```

To test that packaged root instead, run `python -m http.server 8000` from the repository root.

Serve the unchanged capture independently with:

```powershell
python -m http.server 8001 --directory deployed-original
```

## Tests

Each test is a standalone Node script. It starts an ephemeral Python HTTP server, drives headless Edge through Playwright, and writes screenshots or JSON to `test-results/`. Run the scripts one at a time:

```powershell
node tests\original-regression.cjs
node tests\foldable-regression.cjs
node tests\vehicles-regression.cjs
node tests\github-pages-regression.cjs
```

- `original-regression.cjs` verifies that the untouched captured build boots, renders, accepts controls, and decodes audio.
- `foldable-regression.cjs` resizes one never-reloaded game through six viewports and two simulated hinge layouts, checking the frame, canvas, backing buffer, input coordinates, touch targets, keyboard shortcuts, and runtime requests.
- `vehicles-regression.cjs` checks CAR BOY, VACUUM, HELICOPTER, unlock gating, skills, coin multiplication, both save formats, and disabled-toaster safeguards. The toaster mechanics block remains dormant while the vehicle is disabled.
- `github-pages-regression.cjs` serves the packaged site under a project subpath and checks the shop, purchases, explicit continuation, save restoration, and confirmed New Game reset.

The latest recorded foldable run covered 360×800, 412×915, 717×512, 768×1024, 884×1104, and 1768×2208 without a page reload. It also covered a 32 px vertical hinge and a 36 px horizontal hinge. The recorded run reported exact pointer alignment and no console errors, uncaught page errors, or failed runtime requests. See `test-results/foldable-regression.json` for the complete measurements.

## Captured production build

The downloaded frontend is recorded in `deployed-original/download-manifest.json`, including source, capture time, byte sizes, and SHA-256 hashes.

The build contains:

- a 16,945,347-byte HTML response;
- Babylon.js 8.56.2, verified at runtime;
- Havok physics compiled to WebAssembly;
- programmatic DOM overlays and one WebGL canvas;
- embedded Havok WASM, three sound effects, and seven music tracks;
- shaders and blob-generated Babylon worker code inside the bundle; and
- no source-map declaration or dynamic game chunks.

The apparent `/assets/...wasm` and `/audio/...` paths in the production module were fallback names and returned HTTP 404 at capture time. The browser-ready bytes are assigned to globals inside the HTML before the module starts. `tools/extract-embedded-assets.cjs` materializes archival copies without changing the captured HTML. The running adaptation continues to use the embedded bytes.

No separate game images or web fonts are requested. The world and vehicles are constructed in Babylon.js, shaders are bundled, overlays use DOM and CSS, and the interface uses system font fallbacks.

## GitHub Pages

The repository root is the deployable site. Publish it from the `main` branch and `/(root)` folder in GitHub Pages settings. All runtime references are relative, so the site works under any repository project subpath without editing `index.html`.

See `GITHUB_PAGES.md` for the short deployment checklist.

## Limitations

- This is a runtime adaptation over a minified production bundle, not a source-level rebuild.
- The vehicle abilities, day-based unlocks, shared and individual skill split, and linear price curve are adaptation-specific balance decisions rather than original game features.
- New vehicle models use Babylon primitives and the production build's materials, so they are simpler than the original CAR BOY rig.
- Some abilities set velocity rather than applying force so their effect is not immediately canceled by the production AI.
- No physical foldable device was attached for the recorded tests; hinge layouts were tested with deterministic viewport-segment emulation, while production uses browser-provided segment geometry.
- The decoded asset files are archival copies. The game still uses the byte-identical embedded globals.
- Live physics state, enemies, and partially collected coins are not serialized. Refreshing during combat restarts the current day.
