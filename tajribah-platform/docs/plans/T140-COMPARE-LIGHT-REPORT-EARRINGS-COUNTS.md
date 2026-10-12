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

## 1 — Compare  ·  status: ✅ 2026-10-12
- [x] The store's **try-on shelf** (`server/modules/edge/shelf.ts`): every live try-on product (pictures, real size,
      kind, https store page), newest first, at most 40, at the reserved ref `shelf:tryons` next to the configs —
      rebuilt on publish, rewrite, withdrawal, take-down and the whole-store refresh; read through the config host.
- [x] The try-on page reads it (`site/lib/shelf.ts`, each entry checked as a config; `use-compare-choices.ts`): the
      same kind only, never the same product, at most 12 — in the shop's window and on the product's own page.
- [x] Studio, on the shopper's photo: «قارن» → the photo twice, side by side — this product and the one chosen, each
      at its real size against the other (42 mm is 42/38 of 38 mm) where the shopper fitted it, with its shadow, soft
      edge and the photo's light; names, sizes, «افتح صفحتها» (the store page) for the other; tiles to change it; a
      product whose picture does not load is dropped.
- [x] Tests: server shelf 2, client shelf 3; mutation 14/14. Walked: the store's window and product page, desktop and
      390 px — 50 mm beside 45 mm.

## 5 — Counts  ·  status: ✅ 2026-10-12
- [x] `site/lib/tryon-telemetry.ts`: one anonymous `tryon_capture` per photo (kind; source camera / upload / phone;
      found detected / phone / guide / none, and which look; moved by hand yes / no — more than a twentieth of its
      width, 4° or 6 %), one `tryon_share` per share or save; `surface: 'tryon'`; through the analytics collector
      (no picture, no point, no identity; nothing under Do Not Track / GPC). `tryon_share` added to the SDK's list
      (the table always had it).
- [x] Sent by the studio (each photo once, when it is left: another photo, a switch, share / save, leaving or the page
      going to the background) and the phone camera (when a photo is used, sent, shared, or the camera goes); the
      shop's window, the product page and the QR phone page say which store and product (the pairing carries them);
      on this computer the app's own collector.
- [x] Staff console «دقة التجربة» (`server/modules/admin/accuracy.ts`, `/api/admin/accuracy?days=`): photos, found by
      itself (of those it had to place — phone-fitted apart), moved by hand, moved although found; by kind, source,
      look; 7 / 30 / 90 days.
- [x] Tests: telemetry 3 (the collector's own schema accepts the batch), accuracy 2 (summary; from the database: only
      the try-on's own events, only the period); pairing +; mutation 15/15. Walked: the try-on → events in the local
      collector (a photo found by «shrunk», a save) → the console shows them.

## 3 — Weekly report  ·  status: ✅ 2026-10-12
- [x] The weekly summary by email already existed (P4.8 — a member's own choice, Growth and up, Sunday 08:00 Riyadh,
      views / AR / try-on sessions / add-to-carts / purchases / revenue beside the week before, uplift when stated).
      Added: **try-on photos** and **pictures shoppers shared or saved** (the try-on's own anonymous events, T140.5),
      each beside the week before, and **the week's most tried products** (top 3 by try-on sessions, with their
      add-to-carts; none untried).
- [x] **The same summary on the Analytics screen**: «عرض ملخص الأسبوع الماضي» beside the switch
      (`/api/analytics/report/preview`, the same checks as the email) — what the email says, without waiting for
      Sunday. The preview of the dashboard (demo) shows a made-up week.
- [x] Tests: report +1 (photos and shares counted from the try-on's own events, in the week only; top products sorted,
      untried left out, Arabic names; the email says the same; the screen's summary only for those who may) and the
      existing ones updated; mutation 8/8. Walked: the Analytics screen as the local test merchant.

## 4 — Earrings  ·  status: ✅ 2026-10-12
- [x] **From the front** (the face model): the earlobe hangs just outside the face's outline, half way from the ear's
      middle down to the lobe (face-oval 323 → 361, or 93 → 132), 4 mm out — the side nearer the camera, never one cut
      off by the photo's edge; sized by the pupils; hanging straight. Measured on our real face photos (the ears hidden
      by hair): it lands under the hair where the lobe is. (The pose model's ear point sat on the cheek there — not used
      from the front.)
- [x] **From the side** (no face from the front): Google's pose model (`public/assets/pose-landmarker.task`, downloaded
      with Nader's yes) marks the ear; the piercing 19 mm below its middle, sized from the pupils or the ear-to-eye
      distance (75 mm). *Not yet seen on a real side photo (we have none) — tested by its maths.*
- [x] Neither (a close-up of the ear alone, or the ears out of the photo): the two taps, as before.
- [x] Studio (the shopper's photo, «تم تحديد الأذن…») and the phone camera's photos; the pose model is fetched only
      when an earring needs it.
- [x] Tests: earring-auto 4; mutation 10/10. Walked: the demo earring on a face photo (placed by itself), on an ear
      close-up (the taps), through the phone camera (placed by itself when the ears are in the frame; the outline when
      the face fills the frame).

## Log

| Date | Phase | What happened |
|---|---|---|
| 2026-10-12 | — | Plan written; the pose model downloaded (Nader's yes). |
| 2026-10-12 | 2 | Light matching built and walked. |
| 2026-10-12 | 1 | Compare on the shopper's photo built and walked (shelf + split view). |
| 2026-10-12 | 5 | Anonymous success counts sent and shown in the staff console; walked end to end locally. |
| 2026-10-12 | 3 | The weekly summary: try-on photos, shares, top products; the same on the Analytics screen. |
| 2026-10-12 | 4 | Earrings placed by themselves (face outline from the front, the pose model's ear from the side). **T140 done.** |
