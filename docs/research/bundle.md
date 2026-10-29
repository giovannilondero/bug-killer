# What is in the bundle, and what each cut saves

Research for #50. Measured on `origin/main` at `625cea1` (Vite 8.3.5, `pixi.js` 8.22.0, Ritmo 0.14.0), 2026-10-29.
The production build at that commit has the same hash as the deploy (`index-DBvFB4hc.js`), so the live numbers below are for the same bytes.

## TL;DR

| Rank | Cut | First-load wire (zstd, JS+CSS) | Requests | Menu shown, Slow 4G | Cost |
|---|---|---|---|---|---|
| — | Today | 266.1 KB | 13 (7 static + 6 lazy, 2 waterfalls) | 2050 ms | — |
| 1 | Construct `WebGLRenderer` directly, `skipExtensionImports: true` | **−31.0 KB** | 3 | **1491 ms (−560 ms)** | ~10 lines in `render-pixi.ts` |
| 2 | Only `skipExtensionImports: true` (keep `Application`) | −17.0 KB | 11 | 1795 ms (−255 ms) | 1 line |
| 3 | Lazy-load `render.ts` (or drop it) | −4.8 KB | same | −20 ms | small; keep it lazy, the bench needs it |
| 4 | Lazy-load multiplayer + chat + music | −4.8 KB gzip (all five modules) | same | ≈ −25 ms (estimate) | real refactor of `main.ts` |
| 5 | Split Ritmo into its own chunk | +0.1 KB | +1 | ≈ 0 | config only; pays off on repeat visits after app-only deploys (−39 KB) |
| — | Drop unused Pixi renderers (WebGPU, Canvas) | 0 on WebGL browsers | 0 | 0 | already never fetched; cut 1 drops them from the build as a side effect |

Cut 1 is the only one that matters for first load: it removes the two serial round-trips Pixi adds *after* `index-*.js` has arrived, and stops fetching the event/accessibility/filter extensions the game never uses. Everything in our own source together (render.ts, multiplayer, chat, music) is ~10 KB on the wire. The biggest single block in `index-*.js` is Ritmo (~29 KB brotli), which is not ours to cut here (see "Not in scope but worth knowing").

## How it was measured

- `vite build --sourcemap`, then bytes attributed to source modules by decoding each chunk's source map (a throwaway script outside the repo; no dependency added).
- Compressed sizes: `node:zlib` locally (gzip 6/9, brotli 4/11) and, for what users actually get, `curl` against `https://bug-killer.giovannilondero.dev` with each `Accept-Encoding`.
- Which files load and when: headless Chromium (the repo's `playwright-core`, SwiftShader WebGL) recording network + Resource Timing, against the live site and against a local static server that compresses with zstd like Cloudflare does.
- "Menu shown" = the moment `#overlay` gets its content, which happens right after `main.ts` passes `await createRenderer(...)` (`src/main.ts:46`). The menu draws nothing on the canvas (the loop only draws a `view`), so this is the first thing a player sees. Slow 4G = Lighthouse's profile via CDP: 150 ms RTT, 1.6 Mbit/s down. Median of 3 warm runs; each variant's first run carries a ~700 ms SwiftShader cold-start and was discarded.
- Each Pixi variant was checked with the repo's screenshot bench (`bench/shots.ts`, 17 scenes × desktop/phone, run headless): **0.00 % of pixels differ** from today's Pixi output for both variants.
- Lazy-load candidates were measured by building with those modules replaced by stubs (a throwaway Vite config), so the delta includes everything only they pulled in.

## What Cloudflare serves

`wrangler.jsonc` serves `dist/` as Workers static assets. Live responses (2026-10-29):

- Chrome sends `Accept-Encoding: gzip, deflate, br, zstd` and gets **zstd**. Without zstd it gets brotli, then gzip. Cloudflare's docs: "Free Plan: Content is compressed by default using Zstandard"; it also depends on what the browser's `accept-encoding` allows ([Cloudflare, Content compression](https://developers.cloudflare.com/speed/optimization/content/compression/)).
- The brotli Cloudflare serves is a fast level, not q11: `index-*.js` is 115.6 KB `br` on the wire vs 98.1 KB at q11 locally. zstd is 119.0 KB, gzip 114.0 KB. So for Chrome users, zstd is the *largest* of the three; the encoding is chosen by Cloudflare, not by us. Unknown: whether a Compression Rule could pick a higher level on the Free plan; the docs page does not mention levels.
- Every asset, hashed or not, gets `Cache-Control: public, max-age=0, must-revalidate` plus an `ETag`. That is the documented default, and a `_headers` file in the asset directory can override it ([Cloudflare, Workers static assets headers](https://developers.cloudflare.com/workers/static-assets/headers/)). Consequence: every repeat visit sends one conditional request per asset (304 if unchanged). Not a first-load cost, but it is why chunk count matters on repeat visits; `/assets/*` is content-hashed and could be `immutable`.

## Per-chunk sizes today

Wire columns are what the live site sends; `br11` is the best brotli could do, for reference.

| Chunk | What it really holds | Raw | gzip (wire) | br (wire) | **zstd (wire, Chrome)** | br11 | Loaded |
|---|---|---|---|---|---|---|---|
| `index-*.js` | our code + Ritmo | 355,992 | 114,014 | 115,572 | **118,992** | 98,069 | static (entry) |
| `CanvasPool-*.js` | Pixi core: renderer shared systems, Container, Color/colord, maths, Ticker | 112,895 | 33,977 | 34,916 | **35,788** | 29,651 | static (modulepreload) |
| `CanvasRenderer-CBo*.js` | **Pixi Graphics** (+ earcut), *not* the Canvas renderer; Rolldown named it after one module in it | 88,495 | 27,528 | 28,425 | **28,965** | 24,400 | static (modulepreload) |
| `RenderTargetSystem-*.js` | Pixi shared systems, batcher, masks | 78,130 | 21,884 | 22,785 | **23,464** | 19,660 | static (modulepreload) |
| `init-DCs*.js` | Pixi `rendering/init` + `spritesheet/init` (Assets resolver, Spritesheet) | 24,716 | 8,387 | 8,706 | **8,915** | 7,578 | static (modulepreload) |
| `canvasUtils-*.js` | Pixi | 6,062 | 2,044 | 2,081 | **2,128** | 1,874 | static (modulepreload) |
| `getTextureBatchBindGroup-*.js` | Pixi | 406 | 268 | 249 | **268** | 289 | static (modulepreload) |
| `index-*.css` | styles | 20,562 | 5,338 | 5,658 | **5,875** | 4,716 | static |
| `WebGLRenderer-Bj3*.js` (+ 60 B stub) | Pixi WebGL renderer | 72,808 | 19,675 | 20,259 | **20,949** | 17,426 | lazy, 1st waterfall |
| `getTexelRangeRects-*.js` | Pixi (WebGL/WebGPU shared) | 11,369 | 2,961 | 3,073 | **3,176** | 2,704 | lazy, 1st waterfall |
| `browserAll-*.js` | Pixi **events, accessibility, DOM** extensions | 43,529 | 11,156 | 11,616 | **12,000** | 9,893 | lazy, 2nd waterfall |
| `init-CWe*.js` | Pixi **filters** (FilterSystem, CanvasFilterSystem) | 15,222 | 4,761 | 4,948 | **4,993** | 4,345 | lazy, 2nd waterfall |
| `WebGPURenderer-B_3*.js` (+ stub) | Pixi WebGPU renderer | 55,167 | 15,587 | 16,285 | 16,715 | 14,019 | never (WebGL browsers) |
| `CanvasRenderer-BJ7*.js` | 62-byte stub re-exporting Pixi's Canvas renderer from the Graphics chunk | 62 | 70 | 57 | 65 | 60 | never |
| `webworkerAll-*.js` | stub | 54 | 60 | 49 | 56 | 58 | never |

**First load on a WebGL browser: 265.6 KB zstd** (224.4 KB static + 41.2 KB lazy), 13 requests.

### The load waterfall

From Resource Timing on the live site (fast connection, one warm run):

```
  0–360 ms   HTML
360–750 ms   index + 6 modulepreloaded Pixi chunks + CSS, in parallel
  ~813 ms    main.ts reaches createRenderer → app.init → autoDetectRenderer
             → import('WebGLRenderer') + getTexelRangeRects          (waterfall 1, done ~925 ms)
  ~929 ms    renderer.init → loadEnvironmentExtensions
             → import('browserAll') → init (filters)                   (waterfall 2, done ~1031 ms)
 after that  WebGL context, then the menu
```

On Slow 4G the static set lands at ~1.46 s and the two waterfalls add ~590 ms before the menu (2.05 s). Why there are two:

1. `Application.init` calls `autoDetectRenderer`, which `await import('./gl/WebGLRenderer.mjs')` (also WebGPU and Canvas, behind their checks) ([`rendering/renderers/autoDetectRenderer.mjs`](https://github.com/pixijs/pixijs/blob/v8.22.0/src/rendering/renderers/autoDetectRenderer.ts)).
2. `AbstractRenderer.init` then awaits `loadEnvironmentExtensions`, which dynamically imports `browserAll` (accessibility, dom, events, spritesheet, rendering, filters) unless `skipExtensionImports` is true ([`AbstractRenderer.ts`](https://github.com/pixijs/pixijs/blob/v8.22.0/src/rendering/renderers/shared/system/AbstractRenderer.ts), [`autoDetectEnvironment.ts`](https://github.com/pixijs/pixijs/blob/v8.22.0/src/environment/autoDetectEnvironment.ts), [`environment-browser/browserAll.ts`](https://github.com/pixijs/pixijs/blob/v8.22.0/src/environment-browser/browserAll.ts)).

Vite only modulepreloads the entry's static imports and the static deps of a dynamic chunk at the moment that dynamic import runs ([Vite, Async chunk loading optimization](https://vite.dev/guide/features#async-chunk-loading-optimization)); it cannot know these two imports will happen on boot.

### What dominates `index-*.js` (356 KB raw)

From the source map; raw bytes of minified output per source.

| Module(s) | Raw | Share |
|---|---|---|
| `@typeonce/ritmo` (Runtime 34.2 K, internal/debug 16.9 K, internal/world 15.6 K, queries 6.6 K, cells 5.4 K, …) | 103,471 | 29 % |
| `src/host/render-pixi.ts` | 28,679 | 8 % |
| `src/content/backlog.ts` | 25,330 | 7 % |
| `src/host/render.ts` (Canvas 2D fallback) | 24,775 | 7 % |
| `src/main.ts` | 20,549 | 6 % |
| `src/content/text/it.ts` + `en.ts` | 27,072 | 8 % |
| `src/host/paint.ts` (shared by both renderers) | 12,521 | 4 % |
| `@typeonce/ritmo-browser` + `ritmo-math` | 16,479 | 5 % |
| `src/sim/**` (systems, bosses, simulation, …) | ~45,000 | 13 % |
| `music.ts` 4.1 K, `audio.ts` 4.0 K, `chat.ts` 3.4 K, `net.ts` 2.0 K, `predict.ts` 1.7 K, `own-shots.ts` 1.3 K | 16,476 | 5 % |
| Pixi glue that landed in index (Application, Resize/Ticker plugins, env ext.) | 4,416 | 1 % |

Pixi itself is almost entirely outside `index-*.js`: ~509 KB raw / ~158 KB zstd across the Pixi chunks above, of which ~454 KB raw / ~141 KB zstd loads on a WebGL first visit (100 KB static + 41 KB lazy). So on the wire Pixi is slightly more than everything in `index-*.js` (119 KB).

## The cuts

### 1. Construct `WebGLRenderer` directly with `skipExtensionImports: true` — −31 KB, −560 ms on Slow 4G

`render-pixi.ts` uses `Application` only for `init`, `renderer`, `stage` and `render()`, all with `autoStart: false` (`src/host/render-pixi.ts:223-236`, `:1047`). The variant measured:

```ts
import { CanvasSource, Container, Graphics, Sprite, Texture, WebGLRenderer } from "pixi.js"
// …
const glRenderer = new WebGLRenderer()
const glStage = new Container()
const app = { renderer: glRenderer, stage: glStage, render: () => glRenderer.render(glStage) }
await glRenderer.init({ canvas, width, height, resolution: dpr, autoDensity: false, antialias: true,
  background: "#05060a", skipExtensionImports: true })
```

Effect, measured:

- WebGL renderer code becomes a static import, so it arrives with the first parallel batch: no waterfall 1.
- `skipExtensionImports: true` skips `loadEnvironmentExtensions`, so `browserAll` (events, accessibility, DOM) and the filters `init` are never fetched: no waterfall 2. Pixi's own doc for the option: "Whether to stop PixiJS from dynamically importing default extensions for the renderer… If you set this to true, then you will need to manually import the systems and extensions you need. Renderer loader extensions (`WebGLLoader`, `WebGPULoader`, `CanvasLoader`) are skipped too." (`SharedRendererOptions.skipExtensionImports`, [`SharedSystems.ts`](https://github.com/pixijs/pixijs/blob/v8.22.0/src/rendering/renderers/shared/system/SharedSystems.ts)). The game needs none of them: input is Ritmo's/our own, not Pixi's federated events; no filters (glow is baked by `paint.ts`); the only blend mode is `"add"` (`render-pixi.ts:141`), which is not an advanced blend mode. No `WebGLLoader` is registered anywhere in Pixi 8.22, so nothing else is skipped.
- `autoDetectRenderer` is no longer reachable, so the WebGPU and Canvas renderer chunks disappear from the build entirely.
- Output: 3 files (`index` 583 KB raw / 185 KB zstd, one Pixi chunk 138 KB / 44 KB, CSS), **235.1 KB** zstd vs 266.1 KB. The `browserAll`/`webworkerAll` chunks are still emitted (Pixi's `index` keeps the environment extensions registered) but never requested.
- Screenshot bench: 0.00 % pixel difference on all 34 shots.
- Slow 4G menu: **2050 → 1491 ms**. Unthrottled locally: ~310 → ~300 ms, i.e. noise; the gain is round-trips, so it grows with latency.

Trade-offs: a non-WebGL browser that falls back to `render.ts` now also downloads the WebGL renderer (it is static); `renderer.ts` already gates Pixi on a WebGL probe, so that population is small. Pixi's automatic fallback to its WebGPU/Canvas renderers is gone, but it was unreachable in practice: `renderer.ts` only calls Pixi when WebGL exists, and Pixi's own check uses `failIfMajorPerformanceCaveat: false` by default, so it would pick WebGL too.

### 2. Only `skipExtensionImports: true` — −17 KB, −255 ms

The one-line version (add the option to `app.init`) removes waterfall 2 and the 17 KB of events/accessibility/filters, but keeps `Application` → `autoDetectRenderer` → `import('WebGLRenderer')`, so waterfall 1 stays. 11 requests, 249.1 KB, menu at 1795 ms. Also 0.00 % pixel difference. `Application` relies on its plugins (`ResizePlugin`, `TickerPlugin`) which come from `app/init`, a static side-effect import of `pixi.js`, so they are unaffected.

### 3. `render.ts` — −4.8 KB zstd (−24.8 KB raw), −20 ms

Measured on top of cut 1, removing `render.ts` from the bundle (`renderer.ts` falling back to an error): `index` 583.3 → 558.5 KB raw, 185.5 → 180.7 KB zstd; menu 1491 → 1471 ms. The compressed saving is about two-thirds of what `render.ts` compresses to alone (7.9 KB gzip) because it shares much vocabulary with `render-pixi.ts`/`paint.ts`. `paint.ts` stays: Pixi bakes its sprites with it.

Recommendation: don't drop it, `import()` it in `renderer.ts`'s fallback branch instead. Same first-load saving for WebGL users, and it keeps `?renderer=canvas`, the no-WebGL fallback, and `bench/shots.ts`, which compares Pixi against the Canvas renderer.

### 4. Lazy-load multiplayer, chat, music — −4.8 KB gzip for all of them

Measured by stubbing the modules out of the baseline build (gzip 6 of `index-*.js`; br11 in brackets):

| Stubbed | Raw saved | gzip saved | (br11) |
|---|---|---|---|
| `net.ts` + `predict.ts` + `own-shots.ts` | 4,967 | 2,106 | (1,697) |
| `chat.ts` | 3,425 | 1,132 | (906) |
| `music.ts` | 4,038 | 1,516 | (1,302) |
| all five | 12,425 | 4,791 | (4,020) |

At 1.6 Mbit/s, 4.8 KB is ≈ 25 ms; on a fast connection it is nothing. Each becomes one more request the first time a player opens multiplayer/chat or music starts. The cost is not small: `main.ts` calls `makeChat` at module top level (`src/main.ts:216`) and builds `connect`/`makeFrames`/`makePrediction`/`makeOwnShots` synchronously when a remote run starts (`:442-463`); `audio.ts` imports `makeMusic` statically. Not measured: the extra latency when entering multiplayer if the chunk is not prefetched.

### 5. Chunking

- **Pixi renderers/extensions**: on WebGL browsers the WebGPU and Canvas renderers are already never fetched (lazy, 0 bytes of first-load cost). Cut 1 removes them from the build anyway.
- **Ritmo in its own chunk** (`build.rolldownOptions.output.codeSplitting` groups, [Vite, Chunking strategy](https://vite.dev/guide/build#chunking-strategy)), measured: `index` 236.1 KB raw / 75.6 KB gzip + `ritmo` 119.8 KB / 39.2 KB gzip, i.e. +0.1 KB on first load and one more request (preloaded, parallel). The benefit is repeat visits after a deploy that touches only our code: the browser revalidates `ritmo-*.js` (304) instead of downloading ~39 KB again. Pixi already lives in separate chunks, so the same holds for it today.
- More chunks are not free with today's headers: each one is a conditional request on every repeat visit (`max-age=0, must-revalidate`, see above). A `_headers` rule making `/assets/*` `immutable` would remove those and make vendor splitting strictly better. That is a separate decision, not measured here.
- Merging the six modulepreloaded Pixi chunks into one changes nothing measurable on HTTP/2 (they already download in parallel); cut 1 does it as a by-product.

## Not in scope but worth knowing

- **Ritmo is the largest block** (~120 KB raw, ~34 KB br11 for ritmo + ritmo-browser + ritmo-math). Of that, `internal/debug.js` is 16.9 KB raw / 4.8 KB br11 and is gated at runtime (`options.debug !== undefined` in `Runtime.js`), so a production build cannot tree-shake it. Shipping it behind a separate entry or a build-time flag would be a Ritmo change.
- **The Italian text** (`src/content/text/it.ts`, 13.9 KB raw, ~6 KB br11) is imported statically by `src/content/i18n.ts` and downloaded by every English player. Lazy-loading the non-default locale is a similar order of saving to cut 3 or 4.
- `init-DCs*.js` (spritesheet + Assets resolver, ~9 KB zstd) stays in every variant: `pixi.js`'s root `index` imports `spritesheet/init` and `rendering/init` for their side effects, and the package's `sideEffects` list keeps them ([`package.json`](https://github.com/pixijs/pixijs/blob/v8.22.0/package.json)). Removing it would need importing Pixi classes from internal paths, which Pixi does not export; not attempted.

## Unknowns and caveats

- Timings are from headless Chromium with SwiftShader (software WebGL) on an Apple-silicon Mac, not a phone. The network-bound deltas (cuts 1–2) should carry over; CPU-bound ones were too small to see here and may be larger on a slow phone (parse/compile of ~10 KB less JS for cuts 3–4).
- Local zstd (Node's default level) is within ~0.5 % of Cloudflare's for these files, so variant wire sizes measured locally are comparable to the live column.
- Pixi's site guides (Environments, Quick start) do not document `skipExtensionImports` or custom builds; the source JSDoc cited above is the primary source.
- Cut 1 was verified with the screenshot bench, which renders fixed scenes. It was not play-tested end to end (resize, DPR change, long sessions).
