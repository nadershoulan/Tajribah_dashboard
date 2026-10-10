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

## Phase 3 — The phone page: full screen, the store's, the product on the real hand  ·  status: ☐

Today the phone sends a photo and the shopper looks back at the computer. In the reference, the phone *is* the
try-on: full screen, the store's feel, nothing that says "you left the shop".

- [ ] The pairing carries the product (worn picture URL, size, kind, the store's brand) so the phone can render the
      try-on itself (`/api/pair` stores it; the studio passes it when it makes the QR).
- [ ] `capture` becomes a full-screen experience: no Tajribah logo, no site chrome — the store's name/logo only,
      small (every plan; T61's Enterprise-only branding is widened to the phone page — Nader's call). The privacy
      line stays, small, on the first screen only.
- [ ] **Live camera** (getUserMedia, back camera) with a **guide overlay** (Phase 4) and live detection; "التقط"
      captures; the picture is shown full screen with the product placed (Phase 5's engine), pinch / drag to adjust,
      a size note ("يظهر على 50mm"), retake; several shots kept as thumbnails (delete any); the native-camera input
      stays as the fallback (iOS without permission, desktop).
- [ ] "Send to my screen" keeps the current hand-off (the computer gets the photo and pose).
- [ ] Tests: pairing payload contract; the page renders store-first; fallback path.
- [ ] Walk on a 390 px phone emulation with a real hand photo; on a real phone over the LAN (`start-dashboard.sh lan`).

## Phase 4 — Guides on the camera and the hand  ·  status: ☐

- [ ] `site/components/studio/guides.tsx`: an outline drawn over the live camera (and over an uploaded photo while
      waiting) per kind — **watch**: a hand and forearm outline with the wrist marked; **ring**: an open hand, fingers
      apart, ring finger marked; **bag**: arm down at the side; **glasses / earring**: a face oval (earring: in
      profile); **necklace**: face and chest. Short Arabic/English instructions ("ضع معصمك داخل الإطار").
- [ ] Live feedback from detection: "اقترب قليلًا", "أظهر أصابعك", "✓ تم تحديد المعصم"; capture enabled (or
      automatic after a steady second) only when found.
- [ ] Also on the desktop studio's on-me upload (the guide shows what kind of photo to take).
- [ ] Walk: each kind, guide visible, feedback changes as the detection does (recorded frames).

## Phase 5 — Better auto-detect and auto-place  ·  status: ✅ core live 2026-10-11 (watch engine, harder detection); face retries next

- [x] `site/lib/placement.ts` (pure, tested with hands drawn from measurements): watch and ring placements
      **at true size** (knuckle span 58 mm unisex, palm 100 mm, the larger wins; watch 0.28 palm up the arm).
      *(Glasses, necklace, earring and bag keep the studio's own T68/T83/T84 maths, already true-size.)* Was: — a watch's case width in millimetres from the hand's own scale (knuckle span ≈ 78 mm adult
      average, wrist width ≈ 0.72 of it), the strap across the forearm, on the wrist crease (not the hand); a ring at
      the ring finger's base between MCP and PIP; glasses from pupils (62 mm); necklace from the jaw and shoulders;
      earring from the ear landmarks; bag from wrist and knuckles (T84).
- [x] Robustness (hands): `site/lib/hand-detect.ts` tries the photo at 0/90/270/180° then a weaker sighting; the confidence drops for a small hand (the studio says «تأكد من الموضع»). *(Face detection retries: next.)* Was: try the photo at 0/90/180/270° and with a contrast lift when the first pass finds nothing; prefer
      the hand facing the camera's back; reject a hand too small to place; a confidence score that decides between
      "placed" and "please adjust".
- [x] The studio's watch path uses the engine; ring and bag use the harder detection. *(The phone page: Phase 3.)* Was: The studio and the phone page both use the engine (the studio's inline maths moved behind it, same behaviour or
      better).
- [x] Tests: 7 (scale, true size, any angle, confidence, ring, landmark mapping, quarter-turn round trip); 13 breakages caught across T134. Real photo: the demo's wrist photo as a shopper's photo — found upright and turned sideways (only via the retries), the watch on the wrist across the arm; first look sat it against the hand and a little small → 0.28 palm and 58 mm, seen right on the second look.

## Phase 6 — The store sets where the product sits («جرّبه كما يراه المتسوّق»)  ·  status: ☐

- [ ] Per product and per model photo: a **zone** the product may move in (on the wrist, not the hand or the air) and
      a **default pose** (place, size, angle). Stored on the try-on config (`tryon_configs.placement`, migration 0048,
      ROLLBACK), published with the config, read by the studio: `constrainToModel` uses the store's zone when set,
      the built-in box otherwise.
- [ ] Editor in the preview: «اضبط الموضع» — choose the model photo, drag / rotate / size the product, draw the zone
      (a frame with handles, like the crop frame); «أعد الوضع التلقائي». Saved, reloads into the editor, stays editable.
- [ ] Shoppers can still move the product, inside the zone only.
- [ ] Tests: zone constraint (inside, edge, outside), contract, migration + rollback; walk: set a zone, publish, try
      as a shopper — it stays on the wrist.

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
| 2026-10-11 | 5 | Placement engine (watch true size, on the wrist, across the arm), harder hand detection (turned photos, weaker sighting), confidence note; walked on the real wrist photo upright and sideways. Next: Phase 4 (guides) with Phase 3 (phone page). |
| 2026-10-11 | 1, 2 | Shadow (contact + ambient, product-shaped, per kind) and the QR corner mark (level H, read back by jsQR) built, walked, deployed. Next: Phase 5, the placement engine. |
