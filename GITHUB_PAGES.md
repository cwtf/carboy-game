# CAR BOY — GitHub Pages package

The repository root is the complete deployable site. It has no runtime dependency on the development folders.

## Publish from this repository

1. Commit the repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and the `/(root)` folder, then save.

For a repository named `carboy-foldable`, the project site will normally be available at:

```text
https://<username>.github.io/carboy-foldable/
```

All browser references are relative, so project-subpath hosting works without editing `index.html`.

## Test locally

From the repository root:

```powershell
python -m http.server 8000
```

Open `http://127.0.0.1:8000/`.

## Deployable files

- `index.html` — complete production game, including embedded Havok WASM and audio.
- `foldable.css` — safe-area, dynamic viewport, touch-target, and viewport-segment styling.
- `foldable.js` — fullscreen live resizing, hinge placement, canvas synchronization, Escape pause/resume, cursor-directed Shift-to-RAM, the expanded repeat-purchase upgrade shop, browser-local autosaving, confirmed New Game controls, and secondary segment UI.
- `.nojekyll` — tells GitHub Pages to serve the files directly without Jekyll processing.

