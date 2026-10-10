# T134 — A try-on that feels real, and feels like the store's own

Asked by Nader on 2026-10-11, with two reference screenshots (a watch on a model's wrist with a natural shadow; a
phone camera page where the watch sits on the shopper's real wrist, full screen, store-first). Six features, built in
phases over several sessions. **This file is the tracker**: each phase's boxes are ticked as it is built, tested,
walked in a browser and deployed. Decisions go to `docs/DECISIONS.md` (T134.x), the log to PROGRESS.md and STATE.md.

Rules that hold for every phase: the studio (`site/components/studio`) is Nader's code — improve it in place, additive,
never rewritten; real photos and real products only; Arabic first; nothing hidden once saved
(memory `never-hide-edit-after-save`); every check seen to fail; walk it in a real browser (desktop and a 390 px phone)
before it counts.

---

## What exists today (read before building)

| Piece | Where | Today |
|---|---|---|
| Drawing the product | `Studio.tsx` `redraw()` | one flat drop shadow (`shadowBlur 6`, offset 3) for every kind |
| Where a product may sit | `lib/demo-product.ts` `constrainToModel()` | hard-coded boxes per demo photo; a merchant cannot set them |
| On-me, watch | `Studio.tsx` photo load | MediaPipe HandLandmarker on the photo: wrist = landmark 0, 22 % back along wrist→middle knuckle; width from palm width; one try, upright photo only |
| On-me, other kinds | `fitRingToHand`, `fitBagToHand`, `fitGlassesToFace` (+ necklace), earring by two taps | hand / face landmarks; manual fallbacks |
| Phone hand-off (QR) | `app/(site)/capture/[token]/capture.tsx`, `/api/pair` | the phone only takes a photo with the native camera and sends it; the result shows on the other screen. Tajribah's logo unless the store is Enterprise (T61) |
| QR codes | studio pairing QR (`QRCode.toDataURL`, level default), dashboard «رموز QR» (`components/pages/Qr.tsx`, level M) | plain codes, no mark |
| Merchant preview | `components/pages/ProductPreview.tsx` «جرّبه كما يراه المتسوّق» | the studio in a frame with the product's draft config; no way to set placement |

---

## Phase 1 — Realistic shadow  ·  status: ✅ live 2026-10-11

The product must look *on* the skin, not pasted. Reference: the watch on the model's wrist.

- [x] `site/lib/shadow.ts` (pure): per kind, the layers to draw under a product — a **contact shadow** (tight, dark,
      just under the edges where it touches skin), an **ambient shadow** (wide, soft, faint), and a light direction
      (top-left by default; per model photo when set). Watch: strong contact under the strap edges; ring: tight
      around the band; glasses: faint on the face, offset down; necklace / earring: small and soft; bag: a floor-ish
      shadow below.
- [x] Draw them in `redraw()` from the product's own silhouette (its alpha), blurred and darkened — so the shadow has
      the product's shape, not a box. Same in on-me and compare modes; none on the flat compare shot's grid if it
      looks wrong there.
- [ ] *(later, if needed)* A subtle **edge blend** (1 px feather of the product's edge against the photo) so a cut-out's hard edge reads as
      real.
- [x] Tests: shadow layers per kind, in proportion to size, each kind as worn (`lib/__tests__/shadow.test.ts`). The silhouette is the canvas's own (a shadow of the drawn alpha) — not unit-testable without a canvas; seen in the walk.
- [x] Walk: the watch on the model, before (live) and after (local) at 3× — a soft contact shadow under the case and strap links; made a little stronger after the first look.

## Phase 2 — A small mark in every QR  ·  status: ✅ live 2026-10-11

- [x] `lib/qr-mark.ts`: draw a QR at error correction **H** (30 % recoverable) and place a small rounded badge with
      the Tajribah mark in the **bottom-right corner area** — the one corner with no finder pattern — sized so the
      code still scans with margin (≤ 12 % of the side). SVG and PNG.
- [x] Use it for the studio's pairing QR and the dashboard «رموز QR» (preview, SVG with the mark embedded, PNG).
      *(Next: a store with its own brand (T61) gets its logo there instead — with Phase 3's store branding.)*
- [x] Tests: decode every marked code with a QR reader (dev dependency `jsqr`) at several sizes — the URL comes back
      exactly; a badge too big is refused.
- [x] Walk: the studio's pairing QR read back from the page with jsQR — the exact capture link; the dashboard's codes all carry the mark. The mark grown to ~13 % of the side (into a 3-module margin) after the first look — still reads at every size.

## Phase 3 — The phone page: full screen, the store's, the product on the real hand  ·  status: ✅ live 2026-10-11

Today the phone sends a photo and the shopper looks back at the computer. In the reference, the phone *is* the
try-on: full screen, the store's feel, nothing that says "you left the shop".

- [x] The pairing carries the product (worn picture, real width, kind) and the store (`site/lib/pair-product.ts`):
      **read on the server**, never taken from the request — a store's product from the config host the frame
      (`/embed/try-on`) or the product page (`/p/{store}/{product}`) names, a demo product from the site's own list by
      SKU; the studio's body (`{kind, demo}`) chooses only the guide. Config host down → no product, the old hand-off.
- [x] `capture` is full screen on black: no Tajribah logo or name anywhere (title, page, theme colour) — the store's
      name on every plan (from its published product page block; logo too under white-label; the demo: «فايلت»),
      or the product's name. The privacy line, small, on the first screen only (photos now stay on the phone unless sent).
- [x] **Live camera** (back camera for hand kinds, front — mirrored — for face kinds; a switch) with the guide and
      live detection; **the product follows the hand or face live** (smoothed). «التقط» keeps the frame and the
      sighting of that moment; the picture fills the screen with the product placed at real size (Phase 5's engine),
      a finger drags it, two size/turn it, «أعد المقاس الحقيقي»; the size line; up to 6 shots as thumbnails (delete
      any); the photo slides up so the buttons never cover the product. No camera (refused / none) → the guide with
      «التقط صورة» (the phone's camera) and «اختر من الصور». An earring: two taps (top of the ear, lobe).
- [x] «أرسل إلى شاشتي» keeps the hand-off: the computer gets the photo and places it with the same engine.
      *(Sending the shopper's own adjusted pose too: later, if wanted.)*
- [x] Tests: `pair-product` (5: config → product + store name, white-label logo, demo only by SKU, the body
      ignored, a forged body cannot add a product, the host down, a stored session re-checked), `capture-view` (5).
- [x] Walk at 390 px with Chrome's camera fed a real photo (the demo's wrist turned upright; the open hand; the
      face): live «تم تحديد المعصم» with the watch on the wrist, capture, drag, two shots, delete, send — the desktop
      studio received it and placed it; the ring from a gallery photo after a refused camera; glasses live on the face;
      an ended session. No «Tajribah» on the page. *(A real phone over the LAN: when Nader tries it.)*

## Phase 4 — Guides on the camera and the hand  ·  status: ✅ live 2026-10-11

- [x] `site/components/studio/guides.tsx`: one outline per kind (a hand drawn as fingers, palm and forearm in one
      piece and outlined by an SVG filter; the product's place dashed) with its sentence. Was: an outline drawn over the live camera (and over an uploaded photo while
      waiting) per kind — **watch**: a hand and forearm outline with the wrist marked; **ring**: an open hand, fingers
      apart, ring finger marked; **bag**: arm down at the side; **glasses / earring**: a face oval (earring: in
      profile); **necklace**: face and chest. Short Arabic/English instructions ("ضع معصمك داخل الإطار").
- [x] Live feedback (`site/lib/live-feedback.ts`, tested): none / «اقترب قليلًا» / show more (the watch's place on
      the arm, the ring finger's joints, the grip, the chin) / «تم تحديد … — التقط الصورة» — the guide turns green and
      fades so the product on the hand shows. **Capture stays possible before «ready»** (a detector that fails to
      load must not lock the shopper out); the shutter's ring turns green when ready.
- [x] The desktop studio's «عليّ» shows the same guide, small, in place of the camera icon (what photo to take).
- [x] Walk: watch (ready on the wrist), ring (the pick screen's open hand), glasses («أظهر وجهك كاملًا» on a
      close-up, ready on a framed face), the studio tile; 23 breakages caught across T134.3/4.

## Phase 5 — Better auto-detect and auto-place  ·  status: ✅ live 2026-10-11

- [x] `site/lib/placement.ts` (pure, tested with hands drawn from measurements): watch and ring placements
      **at true size** (knuckle span 58 mm unisex, palm 100 mm, the larger wins). *(T134.3: the watch's case edge
      10 mm up from the wrist crease — was its centre 0.28 palm up, which ignored the case size; glasses, necklace,
      earring and bag rules moved here too, the studio calls them.)*
      *(Glasses, necklace, earring and bag keep the studio's own T68/T83/T84 maths, already true-size.)* Was: — a watch's case width in millimetres from the hand's own scale (knuckle span ≈ 78 mm adult
      average, wrist width ≈ 0.72 of it), the strap across the forearm, on the wrist crease (not the hand); a ring at
      the ring finger's base between MCP and PIP; glasses from pupils (62 mm); necklace from the jaw and shoulders;
      earring from the ear landmarks; bag from wrist and knuckles (T84).
- [x] Robustness (hands): `site/lib/hand-detect.ts` tries the photo at 0/90/270/180° then a weaker sighting; the confidence drops for a small hand (the studio says «تأكد من الموضع»). Faces too (`site/lib/face-detect.ts`, glasses and necklace, studio and phone): a face turned a quarter counter-clockwise was not found live; with the turns it is (the face model already copes with the other quarter and upside down). Was: try the photo at 0/90/180/270° and with a contrast lift when the first pass finds nothing; prefer
      the hand facing the camera's back; reject a hand too small to place; a confidence score that decides between
      "placed" and "please adjust".
- [x] The studio's watch path uses the engine; ring and bag use the harder detection. *(The phone page: Phase 3.)* Was: The studio and the phone page both use the engine (the studio's inline maths moved behind it, same behaviour or
      better).
- [x] Tests: 7 (scale, true size, any angle, confidence, ring, landmark mapping, quarter-turn round trip); 13 breakages caught across T134. Real photo: the demo's wrist photo as a shopper's photo — found upright and turned sideways (only via the retries), the watch on the wrist across the arm; first look sat it against the hand and a little small → 0.28 palm and 58 mm, seen right on the second look.

## Phase 6 — The store sets where the product sits («جرّبه كما يراه المتسوّق»)  ·  status: ✅ live 2026-10-11

- [x] Per product and per model photo: a **zone** the product's centre stays in and a **starting pose** (centre,
      angle, size as a share of the real size — 1 = true size). `tryon_configs.placement` (migration 0048, ROLLBACK),
      one parser `lib/tryon-placement.ts` (strict on save, lenient on read), in the preview config, published with the
      try-on (the widget ignores it), read by `tryOnProductFrom`; the studio starts there and clamps to the zone,
      the built-in boxes otherwise (`DEFAULT_ZONES` = those boxes as rectangles).
- [x] Editor in the preview (`components/dashboard/placement-editor.tsx`): «اضبط الموضع» — the model photo, drag the
      product (arrows too), size and angle sliders (a note when not 100 %), the zone's frame with **corner** handles
      (edge handles sat under the product on the thin wrist zone and caught it — found in the walk), its middle moves
      it; «احفظ الموضع», «أعد الوضع التلقائي»; «مضبوط» per photo. Saved, it reloads into the editor and stays editable;
      the preview below shows it; a published product is updated in the shop (`keepLive`).
- [x] Shoppers can still move the product, inside the zone only (walked: dragged far left, it stopped at the zone's edge).
- [x] Tests: `tryon-placement` (4: strict save, lenient read + the studio's product, zone maths, every built-in place
      valid), server (2: save → reload → preview → published → reset; refusals save nothing); migration safety; 15
      breakages caught. Walk (local store, a watch): open, drag, corner, 120 %, 10°, save, reload — as saved; the
      shopper's studio starts there and stops at the zone; reset — the built-in place.

---

## Order and sessions

1. Phase 1 (shadow) and Phase 2 (QR mark) — small, visible, independent.
2. Phase 5 (placement engine) — the base for 3 and 4.
3. Phase 4 (guides) and Phase 3 (phone page) — together.
4. Phase 6 (store-set zones).

## Log

| Date | Phase | What happened |
|---|---|---|
| 2026-10-11 | — | Plan written after reading the studio, capture page, pairing API and QR code paths. |
| 2026-10-11 | 5 | Face detection tries the photo turned too (the hand already did): walked live without it — a face turned 90° counter-clockwise not found; locally with it — found, the glasses on the eyes. |
| 2026-10-11 | 6 | Store-set placement: zone + starting pose per model photo, saved with the try-on, in the preview, published; «اضبط الموضع» editor; the studio starts there and keeps the product in the zone. **T134 complete** (left as options: Phase 1's edge blend; face-detection turn retries; the shopper's adjusted pose sent with «أرسل إلى شاشتي»). |
| 2026-10-11 | 3, 4 | Live (prod 84d6c75c, staging fb428b1d): the same walk on tajribah.org — watch, ring (camera refused), glasses, ended session, and a real store's watch (owner-3 / 23446039, 25 mm) from its try-on frame: the store's name and product on the phone, no Tajribah. The store is still named «owner» in its settings (Nader to rename). |
| 2026-10-11 | 3, 4 | The phone page is the try-on: full screen, store-first, live camera with the kind's guide and live feedback, the product following the hand, capture / adjust / shots / send; the pairing carries the product (read on the server). Guide on the studio's «عليّ». Watch rule: case edge 10 mm above the crease (MediaPipe's wrist point checked on the photo: on the crease). Next: Phase 6 (store-set zones). |
| 2026-10-11 | 5 | Placement engine (watch true size, on the wrist, across the arm), harder hand detection (turned photos, weaker sighting), confidence note; walked on the real wrist photo upright and sideways. Next: Phase 4 (guides) with Phase 3 (phone page). |
| 2026-10-11 | 1, 2 | Shadow (contact + ambient, product-shaped, per kind) and the QR corner mark (level H, read back by jsQR) built, walked, deployed. Next: Phase 5, the placement engine. |
