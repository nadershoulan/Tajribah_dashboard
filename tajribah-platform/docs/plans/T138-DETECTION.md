# T138 — Finding the wrist (and the face) more often, and placing the product more exactly

Nader, 2026-10-12: *"continue improve the auto watch and other product detection after user take picture or trying to
take"*.

Two moments: **after the picture** (the shopper's photo — uploaded in the studio, or taken with the guided camera) and
**while trying to take it** (the live camera).

## How it is measured — the detection bench

`node scripts/dev/detection-bench/run.mjs` runs the site's own detection (`site/lib/hand-detect.ts`,
`face-detect.ts`, the real MediaPipe models from `public/`) in a headless Chrome on the real photos we have (the
studio's model photos and the camera test pictures: 7 hands, 3 faces), each made harder the ways a shopper's photo goes
wrong: dim, dark, flat light, blur, grain, grain in the dark, the other hand (mirrored), tilted 30°–180°, far away (×0.5,
×0.3, ×0.2), the fingers cut off by the edge (as our own arm guide invites), and combinations — 240 cases. Ground truth
is the clean photo's detection carried through each known change (checked by eye: the points sit on the knuckles,
wrists, pupils and chins). "Placed well": within a third of the product's width, 15° and 20 % of its size of where it
should be. Faces are never tested upside down (a selfie never is).

| | found | placed well |
|---|---|---|
| Before (T134's detection) | 194 / 240 | 173 / 240 |
| After | **221 / 240** | **203 / 240** |

Biggest gains: a hand **too close** (filling the photo) — never found before, now found; a **grainy** or **dark and
grainy** photo; **tiny** hands and faces; tilted faces. Typical miss on grainy photos 0.08 → 0.02 of the product's width.

## What changed

### After the picture — `site/lib/detect-views.ts` (shared by hand and face)  ·  ✅
- [x] **Cleaned, first — only for a dark or grainy photo** (its light and grain are measured first: mean brightness,
      and the typical neighbour difference in its middle): made smaller with smoothing (the grain averages away) at
      512 px, then 320 px, with its light stretched (lifted when dark). A clean photo never gets this look.
- [x] **As it is**, then **turned** (a quarter, three quarters; a half for a hand only).
- [x] **Shrunk** into a margin of its own edge colour — a hand or face so close it fills the photo.
- [x] **Zoomed** — five overlapping crops, the middle first — a hand or face far away.
- [x] Then (hands) a weaker sighting, as before.
- [x] **A hand or face found small** (under a fifth of the photo's shorter side) **is looked at once more, closer** — a
      square crop 2.4× its size — and the closer answer kept when found there: its points are more exact.
- [x] **Faces are never turned upside down**: the face model fits an upside-down face wrongly (the chin where the
      forehead is — measured: the necklace 1.7 widths off, the glasses upside down); that look only ever produced a
      confident wrong answer, e.g. on a grainy upright selfie. No face found is better than a wrong one.
- [x] **The guided camera places the product from a fresh look at the photo itself** (full size, all the looks above),
      then the live preview's last sighting, then the guide's outline — the live sighting is a frame or two older and
      from the lighter video tracking.

### While trying to take it — the live camera  ·  ✅
- [x] **Steadier following**: the "one-euro" filter (`smooth` in `site/lib/live-feedback.ts`) — held still, the
      detector's jitter is smoothed away (about half the wobble of the fixed share it replaces); moving, it keeps up
      (a sudden jump caught in three looks instead of four, a steady slide followed closer).
- [x] **No flicker on a dropped frame** (250 ms): the product stays where it was and the guide keeps what it said,
      instead of blinking off and flashing «أظهر يدك».
- [x] **Auto capture is not restarted by one dropped frame** (the ring holds where it was); "away" after a shot counts
      from when the hand was last seen.

### Tried and left out (measured)
- A separate "cleaned" look *after* the shrunk one: it found nothing the shrunk look did not (clean photos).
  Cleaning helps only when it comes *first*, for a dark or grainy photo — which is how it is kept.
- The closer look for anything under 30 % of the photo: it moved moderately small hands by 0.1–0.2 widths with no gain;
  kept for small ones only (under 20 %), where it fixed four misplaced tiny hands.

## Tests
`detect-views` (6), `hand-detect` (3), `face-detect` (4), `live-feedback` (+3), `auto-capture` (+2); mutation 31 / 31
caught across the package. Walked: the studio, live vs local — a hand too close and a grainy dim wrist: live
«لم يتم تحديد المعصم» for both, local «تم تحديد المعصم» for both, the watch on the wrist; the guided phone camera (fake
camera fed a real wrist) — the product follows, auto capture fires, the photo placed by detection (no outline note).

## Left
- The earring is still placed by two taps — the face model does not find the ear. An automatic first guess from the
  face needs photos showing both face and ear to test against.
- More real shopper photos (wrists photographed with a phone, indoors, in the evening, with clutter) would sharpen the
  bench — the photos here are studio-clean before they are made harder.

## Log

| Date | What happened |
|---|---|
| 2026-10-12 | Bench built (240 cases); baseline 194 found / 173 placed well. Shrunk, zoomed, closer looks; faces never upside down; the camera's fresh look at the photo; one-euro smoothing, dropped-frame tolerance; cleaned-first for dark or grainy photos. After: 221 / 203. Walked locally; deployed. |
