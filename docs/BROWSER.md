# BROWSER.md

Everything needed to run the game reliably in a browser: targets, features and fallbacks, build, hosting, storage, lifecycle, input, errors and testing.

## 1. Targets

* Desktop browsers: Chrome and Edge 120 or newer, Firefox 120 or newer, Safari 17 or newer.
* Minimum viewport 1280 by 720. Mouse and keyboard. Trackpads supported for pan and pinch zoom.
* Mobile and touch are out of scope. On small screens show a polite message with a link to continue anyway.

## 2. Platform features

| Feature | Use | Fallback |
| --- | --- | --- |
| Module Web Workers | Sim worker, bake worker | Required. Show an unsupported browser message without them |
| Transferable `ArrayBuffer` | Snapshots | Required |
| `OffscreenCanvas` 2D | Baking in the bake worker | Bake on the main thread in idle slices with `requestIdleCallback` or a 4 ms budget per frame |
| `createImageBitmap` | Sprite caches | Use canvases as images |
| `CompressionStream` | Save compression | Store uncompressed and mark the save |
| IndexedDB | Saves, settings, crash logs | Required. If blocked (private mode), warn and offer file export only |
| `navigator.storage.persist` and `estimate` | Keep saves, show quota | Skip silently |
| Pointer Events, `ResizeObserver` | Input, resize | Required |

`SharedArrayBuffer` is not used, so no cross origin isolation headers are needed. WebGL is not used. Canvas 2D is enough for this art style and keeps compatibility simple.

## 3. Project setup

* Vite with TypeScript strict. Workers are created with `new Worker(new URL('./worker/sim.ts', import.meta.url), { type: 'module' })`, the same for the bake worker.
* Runtime dependencies: `preact`, `zustand`, `zod`. Ask before adding more.
* Dev dependencies: `vitest`, `playwright`, `eslint`, `typescript`, `@preact/preset-vite`.
* Path aliases: `@sim`, `@render`, `@ui`, `@data`, `@shared`.
* Builds output hashed file names. `index.html` is tiny and loads the boot chunk.
* Source maps are generated for production but uploaded only to the host as private files, or omitted.

## 4. Hosting

Static hosting only (for example Cloudflare Pages, Netlify, GitHub Pages or Vercel). No server code.

Headers:

* Hashed assets: `Cache-Control: public, max-age=31536000, immutable`.
* `index.html` and the service worker: `Cache-Control: no-cache`.
* Content Security Policy: `default-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'`.
* Serve `.json` and `.wasm` (if ever used) with correct MIME types and gzip or brotli compression.

## 5. Offline and updates

* Release 1.0 adds a small hand written service worker that precaches the app shell and content data for the installed version, so the game runs offline after the first visit.
* When a new version is deployed, the game shows "Update available, restart to update". It never reloads by itself during play.
* Saves record the game version. Older saves migrate on load. Newer saves opened in an older version are refused with a clear message.

## 6. Storage and saves

* IndexedDB database `airfield-tycoon` with stores: `saves` (header and blob), `settings`, `crashLogs`.
* Call `navigator.storage.persist()` after the first manual save and show the storage used in the Load screen.
* Autosave every game day in 3 rotating slots per career, plus on exit to menu and on page hide.
* Export a save as a `.airfield` file (gzip of header and blobs) and import it by drag and drop or file picker.
* If a write fails because of quota, show a dialog to delete old autosaves or export.

## 7. Page lifecycle

* `visibilitychange` to hidden: pause the sim by default (setting "Keep running in background" is off by default) and autosave if more than 5 game minutes passed since the last save.
* `pagehide`: autosave synchronously enough to finish, by keeping the last autosave fresh during play.
* `beforeunload`: warn only if there are unsaved changes since the last autosave.
* Returning to the tab resumes the previous speed after a short "Resume" toast.

## 8. Input and display

* The map canvas takes wheel events with `passive: false` to stop page scroll while zooming. Panels keep normal scrolling.
* Context menu is suppressed on the canvas only.
* Pointer capture during drags so a drag outside the window still ends properly.
* Keyboard shortcuts ignore input fields and respect rebinding.
* `ResizeObserver` resizes canvases. A `matchMedia` listener on resolution reacts when the window moves between screens with a different pixel ratio.
* Canvas backing size is capped at 4096 by 4096 per canvas. Larger screens render at a lower ratio.

## 9. Errors and crash recovery

* A global error boundary in the UI catches render errors and shows a panel with Restart, Load last autosave and Copy report.
* Worker errors are forwarded to the main thread with the tick, seed and the last 500 commands, stored in `crashLogs`.
* Copy report puts the version, browser, seed and command log on the clipboard so a bug can be replayed with `replay.ts`.
* No external error tracking or analytics in v1. Nothing leaves the player's machine.

## 10. Testing in browsers

* Vitest for logic, in Node.
* Playwright smoke tests in Chromium, Firefox and WebKit: boot to menu, start a new game, build a runway and a stand, run 2 game hours at 8x, save, reload, load.
* Playwright visual tests for reference scenes (aircraft lineup, stand templates, people atlas) with a pixel tolerance.
* Performance smoke in Chromium: the medium scenario must hold under 16 ms average frame time on the CI machine profile.

## 11. Internationalization and legal

* All UI text in `src/ui/strings/en.json` from day one. Numbers, dates and money formatted with `Intl`.
* Units: metric by default, imperial optional for display only. The sim stays in SI.
* Keep license files for the font and any icon set in `public/licenses/`.
* Real aircraft names and manufacturer names are used descriptively. Do not use manufacturer or airline logos. Generated airlines have invented names and liveries.
