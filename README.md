# Style Extractor

Mobile-first browser tool that turns a folder of reference photos into a **Lightroom Mobile preset (`.xmp`)** and a **3D LUT (`.cube`)** — so you can apply a photographer's signature look to your own photos with one tap.

Built originally to replicate Marian Chytka's (@mchphotocz) motorsport photography style, but works on any reference set.

## Why

If you like a photographer's color grading and want it as a one-tap filter on your iPhone, the cleanest path is a Lightroom preset. This tool measures their look from sample images and emits a real Lightroom preset you import once and use forever.

All the image math runs in your browser. Photos never leave your device.

## How it works

1. Manually save 25–40 reference images from the photographer (long-press → save on Instagram, etc.).
2. Open the deployed site, drop the folder in.
3. Tool measures average tone curve, color grading by luminance band, HSL distribution, grain, vignette, etc.
4. Emits a Lightroom-format `.xmp` and a 33³ `.cube` LUT.
5. Import the `.xmp` into Lightroom Mobile (free) → applies in one tap to any photo.

## Stack

- **Cloudflare Workers** + Hono (serves the static client)
- **Vite + React + TypeScript** (client)
- **Tailwind** (mobile-first dark UI)
- **Web Worker** for image math so the UI stays responsive
- **Vitest** for unit tests

## Develop

```bash
npm install
npm run dev:client     # Vite dev server (fast iteration on UI)
npm run dev            # Wrangler dev (full Worker + assets stack)
npm test               # Vitest
npm run typecheck
npm run build
npm run deploy         # Build and deploy to Cloudflare
```

## Project layout

```
client/         Vite + React app (the actual tool)
  src/
    components/   UI pieces
    lib/          colorspace, histogram, statistics, extract, xmp, cube
    workers/      Web Worker that runs the heavy math
worker/         Cloudflare Worker (Hono) that serves the static client
tests/          Vitest unit tests
public/presets/ Bootstrap presets shipped with the tool (mchphotocz.xmp)
```

## Deploy

Two paths to a live URL:

**Easiest — Cloudflare Pages dashboard (one click, no CLI):**
1. Go to https://dash.cloudflare.com → Workers & Pages → Create application → Pages → Connect to Git.
2. Pick `tomdgchilds-source/style-extractor`.
3. Build command: `npm run build` · Output directory: `dist/client`.
4. Save and Deploy. Get a `*.pages.dev` URL. Future pushes auto-deploy.

**Automated — GitHub Actions:**
1. Create a Cloudflare API token at https://dash.cloudflare.com/profile/api-tokens with the "Edit Cloudflare Workers" template.
2. Add to this repo: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Settings → Secrets and variables → Actions).
3. Push to `main`. The `Deploy` workflow tests, builds, and deploys.

**Local dev:**
```bash
npm install
npm run dev:client      # Vite dev server (fast iteration)
npm run dev             # Wrangler dev (full Worker + Assets stack)
```

## Status

In active development. See `~/.claude/plans/make-a-tool-which-steady-narwhal.md` for the build plan.
