# T140 — Compare two products, match the light, the weekly report, earrings placed automatically, real success numbers

Nader, 2026-10-12, from the ideas list: *"do these only"* —

1. **Compare two products on the same photo** — "this watch or that one", side by side on your own wrist.
2. **Match the product to the photo's light** — a gold watch slightly warmer or darker in a dim indoor photo.
3. **A weekly report for the merchant** — try-ons, shares, add-to-carts, top products.
4. **Earrings placed automatically** — they needed two taps.
5. **Real success numbers, with no photos sent** — anonymous counts: how often the wrist is found, how often shoppers
   move the product by hand.

Order of work: 2 (light) → 1 (compare) → 5 (counts) → 3 (report, which shows the counts too) → 4 (earrings: Google's
MediaPipe pose model, which marks the ears — downloaded with Nader's yes, 2026-10-12: `pose_landmarker_lite.task`,
5,777,746 bytes, sha256 59929e1d…d574a, served as `public/assets/pose-landmarker.task`).

## 2 — Light  ·  status: ✅ 2026-10-12
- [x] `site/lib/light.ts`: the photo's light from its brightest 2 % (never its average — dark clothes or darker skin are
      not dim light) and the light's colour from its highlights that are not blown out; the product made only darker
      (down to 0.66), its colour moved half way towards the light's, at most a tenth. Cached per product and light.
- [x] Studio (the shopper's photo), the phone camera's result and its saved / shared picture; the live camera's
      product a little darker in a dim room (measured every 1.5 s).
- [x] Tests 4 (well lit untouched, dark things not dim light, dim → darker in proportion, warm lamp → warmer, blown-out
      highlights ignored); mutation 7/7. Walked: a warm dim wrist photo, live vs local — the watch no longer glows.

## 1 — Compare  ·  status: to do

## 5 — Counts  ·  status: to do

## 3 — Weekly report  ·  status: to do

## 4 — Earrings  ·  status: to do

## Log

| Date | Phase | What happened |
|---|---|---|
| 2026-10-12 | — | Plan written; the pose model downloaded (Nader's yes). |
| 2026-10-12 | 2 | Light matching built and walked. |
