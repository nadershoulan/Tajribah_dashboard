> **Moved (2026-10-04).** This website now lives in the platform: `tajribah-platform/site/` (code, with these rules in `site/CLAUDE.md`) and `tajribah-platform/app/(site)/` (pages), served by the platform's Worker. This folder is the old copy, frozen until it is deleted — **do not edit it**; change the platform's copy.

# Tajribah — working rules for this repo

Read this before touching anything. Rules 1 and 2 are the ones that were broken
before; treat them as hard limits, not preferences.

## 1. The try-on studio is the owner's code. Do not rewrite it.

`components/studio/Studio.tsx`, `lib/demo-product.ts` and `public/assets/*` are
the original implementation. They are the product. Never replace them with a
different approach, a "cleaner" rewrite, or a version you find easier to build.

Do not change without being asked, explicitly, for that change:

- the three modes (`model` / `me` / `compare`) and how each one behaves;
- `PX_PER_MM = 4.3` and `STAGE = { W: 1200, H: 1050 }`;
- the model poses — wrist `{x:350,y:553,width:139,angle:0}`, lifestyle
  `{x:607,y:492,width:112,angle:-34}` — and `constrainToModel()`;
- the two-tap calibration math (`width = distance / (h/w)`,
  `angle = atan2(...) * 180/PI - 90`);
- the MediaPipe hand-detection sizing (`clamp(palm * 0.9 / (h/w), 45, 240)`);
- the compare-mode background grid (43 px = 10 mm), zoom range `0.65–2.5`,
  arrow-key nudging;
- QR pairing (`/api/pair*`, `app/capture/[token]`) or `saveImage()`;
- the WebMCP tools `configure_try_on` and `get_try_on_state`.

"Improve it" means small, additive, reversible: a default, a label, spacing, a
copy fix. If an improvement needs one of the items above to move, ask first.

## 2. Real photography only. Never draw a substitute.

The studio runs on real photos: `model-wrist.webp`, `model-lifestyle.webp`, the
Failet watch cut-outs (`watch-layer-*.png`, `watch-flat.png`) and the real
reference objects (`iphone.png`, `airpods.webp`, `riyal.webp`). Provenance is in
[ASSETS.md](ASSETS.md).

Never substitute drawn, illustrated, SVG or canvas-rendered artwork for a
product, a hand, a model or a reference object — not in the studio, not in the
landing hero, not as a placeholder. If an asset is missing, say it is missing
and ask for it. A drawing of a watch is not a demo of a try-on.

The landing hero (`LiveScene` in `components/site/ui.tsx`) composites the same
real photo and the same real watch as the studio. Keep it that way.

## 3. Tajribah is the company. Failet is only an example.

Tajribah sells the try-on; Failet is one demo store used to show it. Every place
Failet appears must stay labelled as an illustrative demo, with no implied
partnership or endorsement, and the site chrome must never carry Failet
branding. Product copy describes Tajribah's product, never Failet's.

## 4. Arabic first.

- `DEFAULT_LANG = 'ar'` in `lib/lang.ts`; English is opt-in via the
  `tajribah-lang` cookie plus localStorage.
- Every user-facing string is bilingual: `t('عربي', 'English')` from `useLang()`,
  or a `Bi` object in the `lib/*` and `content/*` data files. No untranslated
  string ships.
- The layout is RTL by default. Check both directions after any layout change —
  logical properties (`inset-inline-*`, `margin-inline-*`) flip, and a
  `direction: ltr` override on a container flips them back and has broken this
  before. Canvas text needs `ctx.direction` set, or `29.3 مم` renders as
  `مم 29.3`.
- Shared language primitives live in `lib/lang.ts`, which has **no**
  `'use client'`. Server files must import constants from there — importing a
  constant from a client module on the server yields a client reference, not
  the value.

## 5. Invent nothing.

No fabricated CR or VAT numbers, addresses, legal names, testimonials, client
logos, case studies, percentages or customer counts. The placeholders in
`lib/site.ts` are empty on purpose and render conditionally; leave them empty
until the owner supplies the real values. The contact form composes a real
`mailto:` — it never pretends to have sent anything. The policy texts in
`content/legal.ts` are drafts pending review by Saudi-licensed counsel, and the
in-file note saying so stays.

## 6. One set of page components, two shells.

`components/pages/*` render both in the Next app and in the static preview.
Pages must never branch on which shell they are in. Everything environmental
goes through `SiteEnv` (`lib/site-env.tsx`):

- `toHref(path)` — real routes vs `#/hash` routes;
- `asset(path)` — public files vs preview-relative files;
- `features.pairing` / `features.download` — off in the static preview, because
  both need the server.

Adding a page means: a component in `components/pages/`, a thin route file in
`app/`, a title in `lib/site.ts`, and a route in `preview/main.tsx`.

## 7. Local build reality

This machine has **Node 20.15 and no pnpm**, but the project requires Node
>= 22.13 and there is no `node_modules`. `npm run dev` / `next build` cannot run
here — do not claim they were run.

What does work, with the throwaway toolkit installed in the session scratchpad
(`tk/`: react, react-dom, next, typescript, esbuild, @tailwindcss/cli,
tailwindcss, radix-ui, lucide-react, qrcode, @mediapipe/tasks-vision, the
matching `@types/*`, `@cloudflare/workers-types`):

- **Type-check:** a `tsconfig.used.json` limited to the files this site actually
  uses. Checking everything fails on unused shadcn components whose deps are not
  installed (react-day-picker, recharts, cmdk, vaul). In `paths`, `@types/*`
  must come **before** `node_modules/*` or `react` resolves to JS and TS7016
  fires.
- **Preview:** `node preview/build.mjs --modules <tk>/node_modules` → esbuild
  IIFE bundle + Tailwind CLI + asset copy into `dist-preview/`.

The scratchpad is session-scoped, so the toolkit disappears between sessions and
has to be reinstalled — **but usually it need not be.** The sibling
`../tajribah-platform/node_modules` (a real pnpm install) has every package this
site's preview and typecheck need, so both run against it directly:

```
node preview/build.mjs --modules ../tajribah-platform/node_modules
```

It has `@tailwindcss/postcss` rather than `@tailwindcss/cli`; the builder falls
back to it — the same compiler the Next build uses (2026-09-27).

To look at the result, serve `dist-preview/` over HTTP rather than opening it as
a file: the preview is a script bundle, and `file://` renders a blank page. Serve
it with no-store headers **and** a version stamp on `app.js` / `site.css` — a
browser that has seen the page once will otherwise keep showing you the previous
build, which reads exactly like a change that did not work.

## 8. Tooling gotchas that cost time before

- Long inline heredocs through the Bash tool fail on this machine ("unexpected
  EOF"). Write the script to a file, then run it.
- Artifact hosting will not serve `.task`; the MediaPipe model ships as
  `assets/hand-landmarker.task.wasm` and is mapped back in `preview/main.tsx`
  (`RENAMED`). Page-initiated downloads are blocked there too — hence
  `features.download`.
- Verify rendering with a screenshot before saying it works. Every render bug so
  far (mirrored canvas text, overlapping RTL controls, phone-width overflow) was
  invisible in the code and obvious in the picture.

## 9. Brand

`public/brand/*` is generated from `logo.png` by `scratchpad/brand.py` (PIL):
wordmark, mark, light variants, favicons, app icons, and a 1200×630 OG image.
Reference brand files by their stable paths (`/brand/tajribah-wordmark.png`).
Regenerate from `logo.png` rather than hand-editing the outputs.
