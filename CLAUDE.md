# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An unofficial foldable/responsive adaptation of the game **CAR BOY** (Babylon.js 8 + Havok WASM, minified production Vite bundle). There is no game source code here — only a byte-exact capture of the deployed single-file build plus a runtime compatibility layer that is injected around it.

There is no `package.json`, no npm install, no bundler, and no test runner. Everything is plain Node scripts (`.cjs`/`.mjs`) using only `node:` builtins, plus Playwright resolved from outside the repo.

## Build pipeline (which files are authored vs. generated)

```
foldable-src/{foldable.css,foldable.js}     ← the ONLY hand-edited runtime source
  └─ node tools/build-working-copy.cjs      → foldable-game/  (dev working copy)
       └─ node tools/package-github-pages.cjs → repo root     (deployable Pages site)
```

- **Edit only `foldable-src/`.** `foldable-game/*` and the root `index.html`/`foldable.css`/`foldable.js` are generated; any edit there is lost on the next build.
- **Never modify `deployed-original/`.** `build-working-copy.cjs` re-hashes `deployed-original/index.html` after the build and throws if it changed. Its SHA-256 must stay `8348c073afa5c7782ba3d396d1830183fbf25a61629fd1e35e062038d22a5d2e`.
- `build-working-copy.cjs` does exactly three things to the 16 MB HTML: prepends viewport/charset/theme metadata, injects `<link>`/`<script>` for the foldable layer around the `<div id="stage">` marker, and strips the Cloudflare telemetry helper (matched by the literal string at [tools/build-working-copy.cjs:16](tools/build-working-copy.cjs:16)). If either marker string stops matching, the build throws rather than silently producing a broken site.
- `package-github-pages.cjs` adds `<title>`/description/inline SVG favicon and asserts that no markup reference is non-local (all `src`/`href` must be `./`, `data:`, or `#`) — GitHub Pages project-subpath hosting depends on that.
- `tools/extract-embedded-assets.cjs` decodes the WASM/audio that live as base64 inside the HTML into `deployed-original/assets/` and `deployed-original/audio/`, and rewrites `download-manifest.json`. Those files are archival only; the running game always uses the embedded `globalThis.__CARBOY_WASM__` / `__CARBOY_AUDIO__` / `__CARBOY_MUSIC__` globals. The apparent `/assets/*.wasm` and `/audio/*` URLs 404 in production.
- `tools/audit-deployment.mjs [file]` dumps script/style blocks, markup refs, asset strings, and sourceMappingURL declarations from a captured HTML.

Full rebuild:

```bash
node tools/build-working-copy.cjs && node tools/package-github-pages.cjs
```

## Running

ES modules will not load from `file://`; always serve over HTTP.

```bash
python -m http.server 8000
```

```bash
python -m http.server 8001 --directory deployed-original
```

## Tests

Each test is a standalone script that starts its own ephemeral `http.server`, drives headless Edge through Playwright, asserts with `node:assert/strict`, and writes screenshots/JSON to `test-results/` (gitignored). Run them one at a time; there is no aggregate runner.

```bash
node tests/original-regression.cjs
```

```bash
node tests/foldable-regression.cjs
```

```bash
node tests/vehicles-regression.cjs
```

```bash
node tests/github-pages-regression.cjs
```

- `original-regression.cjs` serves `deployed-original/` and proves the untouched build still boots, renders, and decodes audio — it is the control, and also documents the pre-fix mobile canvas bug.
- `foldable-regression.cjs` serves `foldable-game/` and resizes a single never-reloaded page through six viewports, checking frame/canvas/backing-buffer sync, pointer-coordinate accuracy, 44 px touch targets, and both hinge orientations.
- `vehicles-regression.cjs` serves `foldable-game/` and drives each vehicle's mechanics, the skill economy, and both save formats.
- `github-pages-regression.cjs` serves the repo root under the `/carboy-foldable/` prefix (simulating Pages project-subpath hosting) and covers the sectioned shop, stash deduction, autosave restore-on-refresh, and confirmed New Game.

Three traps make gameplay tests silently wrong, all handled by helpers in `vehicles-regression.cjs`:

- **`CARBOY.step(dt)` does not render**, so scene observables never fire. The layer wraps `step` to tick abilities too, but anything else hooked to a render observable will not run.
- **Dropping a rival off the island counts as a knockout.** Enough of those end the day and open the intermission, which suspends the ability tick. Retire rivals with `combat.unregister` + `dispose` + `releaseBody` + `splice` instead, and park the run on a high day so the quota is unreachable.
- **`world.teleport` needs a physics step to take effect**, and a freshly spawned body needs one before a teleport sticks. Placement helpers verify and retry rather than assume.

Two environment dependencies are hardcoded with env-var overrides — set them if paths differ:

- `PLAYWRIGHT_MODULE` — defaults to an absolute path under `~/.cache/codex-runtimes/...`; the repo has no local Playwright install.
- `EDGE_PATH` — defaults to `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. Launched with `--enable-unsafe-swiftshader` and `--autoplay-policy=no-user-gesture-required`.

Tests wait on `globalThis.CARBOY && globalThis.CARBOY_FOLDABLE` before doing anything, and drive real UI (`.carboyStartButton`, `button[aria-label="Pause game"]`) rather than calling internals.

## Architecture of the compatibility layer

`foldable-src/foldable.js` is one IIFE loaded *after* the game bundle. It owns three concerns and exposes `globalThis.CARBOY_FOLDABLE` (`version`, `layout`, `getState`, `upgrades`, `save`) purely so tests can observe it.

**1. Layout / segments.** `layout()` computes safe-area insets via `env(safe-area-inset-*)`, then places `#frame` inside the largest viewport segment and never across a hinge; `#foldable-secondary` gets the next-best segment. Segments come from, in priority order: dev-only URL hooks (`?foldable=vertical&hinge=32`), `env(viewport-segment-*)` read through hidden measurement probes, legacy `window.getWindowSegments()`, then a single-viewport fallback. `scheduleLayout` is rAF-coalesced and fires on resize, `visualViewport` resize/scroll, `ResizeObserver`, viewport-segment media queries, and `orientationchange` (with 80/320/750 ms follow-ups, because mobile chrome settles asynchronously). After CSS sizes change, `syncBackingBuffer()` calls the production Babylon engine's own `resize(true)` — never set canvas dimensions directly, that is what keeps pointer coordinates exact.

**2. Feature installation by monkey-patching.** `updateSecondary()` runs on a 250 ms interval and repeatedly calls `installAutoSave()` / `installExpandedUpgradeShop()`, each guarded by an `installed` flag — this is how the layer attaches to production objects that do not exist at script-eval time. It wraps `progress.take` and replaces `upgradeScreen.show` to render all seven upgrades with repeat purchases at `10 × (level + 1)` coins, and restores a save by writing `progress.{day,stash,carried,taken}` then calling `progress.apply()` plus the mass/scale re-application at [foldable-src/foldable.js:425](foldable-src/foldable.js:425).

**3. Input.** Shift-hold drives the action button with cursor-directed aim for the car only (rAF loop writing `CARBOY.controls.{charging,aiming,aimDir}`), Escape clicks the existing pause button. Original touch/pointer/Space controls are untouched.

**4. Vehicles.** Four are defined (car, vacuum, helicopter, toaster); **the toaster currently carries `enabled: false`**, so `AVAILABLE_VEHICLES` filters it out of the garage, the shop, `garage.list()`, and `setActiveVehicle`, and a save naming it falls back to the car. Its skill levels are still serialised, so re-enabling restores them. `controls.charging` and `controls.released` are redefined as accessors: the getters return the real value only while the car is active, so the stock charge-and-ram path never sees the other vehicles' button, while the raw state plus latched press/release edges feed the ability tick. Edges must be latched because the production frame clears `released` before the post-update hook runs. Abilities run from `scene.onBeforeRenderObservable` (which fires after `Nr(dt)` and before the render) and from a wrapper around `CARBOY.step`.

Ability effects generally **set** a rival's velocity rather than applying an impulse — the rival AI drives back at 44 m/s², which out-muscles any affordable impulse. Anything captured, swallowed, or launched is routed through the production fall handler (drop it below `TUNING.world.knockoutY`) so coins, knockout counting, and cleanup are the game's own. Held cars ride a velocity spring, never a per-frame `world.teleport`: teleporting hands the body to the physics pre-step and strands it once released.

The only DOM contract with the production build is `#stage`, `#frame`, `#render`, `#chargeBtn > .core`, `.carboyStartButton`, and the `aria-label` pause/resume buttons. Everything else the layer creates itself (`[data-fold-stat]`, `[data-new-game-location]`, `.carboy-upgrade-*`, `.carboy-vehicle-*`, `.carboy-shop-section`).

## Hard constraints

- No game logic, physics, scoring, tuning, or audio code may be edited — the bundle is minified with no source maps, and the adaptation's whole premise is that it is an isolated runtime layer. Changes belong in `foldable-src/`.
- Save state lives in `localStorage` under `carboy-progress-v2`, with `carboy-progress-v1` migrated on read, and is origin-scoped (a `127.0.0.1` save is separate from the Pages save). Refresh mid-day restarts the current day; refreshing from an intermission checkpoints the *next* day so a cleared day cannot be farmed twice.
- `progress.apply`, `take`, `bankCarried`, `magnetRadius`, and `visualScale` are all overridden by the layer. Skill levels live in the layer's own state; `progress.taken` is rewritten from it on every apply, so writing `taken` directly no longer changes anything.
- Keep root `index.html` references relative so project-subpath Pages hosting keeps working.
