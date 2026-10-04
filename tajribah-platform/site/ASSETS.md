# Asset provenance and scope

Reference supplied by the user: https://cdn.tangiblee.com/widget/index.html?id=p820241410&domain=failet.sa&directLink=1

The Failet product cutouts, model photography, and comparison reference images were obtained from the rendered reference widget and its publicly linked assets. This is an independently implemented interface; it does not embed or call the Tangiblee widget or copy its application code.

- Wrist photo: https://cdn.tangiblee.com/yruler-context-modes/6c45e9c3-b51e-4067-b35c-d912a7d59d65_5800%20-%20women's%20%20wrist.webp
- Lifestyle photo: https://cdn.tangiblee.com/yruler-context-modes/fce73e83-4010-4b85-950a-f19dd1ed1399_5798%20-%20right%20hand.webp
- Thumbnails: ContextMode_5800 and ContextMode_5798 under https://cdn.tangiblee.com/yruler-merger/Bags/Textures/12972524/Lifestyle/
- Reference objects: item IDs 2329 (AirPods), 3769 (iPhone 15), 4892 (Saudi riyal) under https://cdn.tangiblee.com/yruler-references-pictures/
- Watch cutouts and full iPhone comparison image: rendered inline image assets on the supplied reference.
- Wrist detection: @mediapipe/tasks-vision, with the official hand_landmarker float16 model from https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

Case width is approximate, inferred from the reference widget's watch/iPhone relative sizes. This is photo-based 2D try-on with optional client-side wrist detection and guided two-edge calibration. No live 3D AR, backend product catalog, checkout, or Tangiblee service access is included.

QR sessions use random 128-bit tokens. Photos are compressed in the browser, transferred through R2, and deleted on successful receipt or explicit session closure. Expired sessions are inaccessible after 30 minutes and removed opportunistically on polling or new session creation. All access to the first deployment is controlled by the private Sites gateway.

## Glasses (T68, 2026-10-03)

Real photographs only, under the [Unsplash License](https://unsplash.com/license) — free for commercial use, no permission or attribution required (credited here anyway).

- `model-face.webp` (and `model-face-thumb.webp`): front-facing portrait by Meital Anlen — https://unsplash.com/photos/KTQN0UWNwS4 (published 2020-05-11). Cropped to 2000 × 1750 from the top of the 2000 px download (y 450) and scaled to the 1200 × 1050 stage; nothing else changed.
- `glasses-front.png`: round black metal frame by Konsepta Studio — https://unsplash.com/photos/62rTkfxLTDg (published 2020-06-11). Cut out by `scripts/cut-glasses.mjs`: the front frame only; each lens's inner edge fitted as an ellipse and made transparent (clear lenses — the arms seen through them in the flat photo would not be seen when worn); alpha from how dark each pixel is; the colours are the photo's own. No brand is shown or named.

Scale on the face photo is measured, not tuned by eye: pupils at (433, 527) and (757, 514) on the stage, 324 px apart, taken as 62 mm (an adult's average interpupillary distance) → 5.23 px/mm. The example frame's width, 132 mm, is approximate (a typical round metal frame); it is an example product, not a store's.

## Ring (T68, 2026-10-03)

Real photographs under the [Pexels License](https://www.pexels.com/license/) — free for commercial use, no permission or attribution required (credited here anyway).

- `model-hand.webp` (and `model-hand-thumb.webp`): the back of a hand, fingers spread, by Vera Emilie — https://www.pexels.com/photo/20805371/ (3631 × 5457). Cropped to x 900–3100, y 1350–3275 and scaled to the 1200 × 1050 stage; nothing else changed.
- `ring-top.webp`: a two-stone gold ring on a white display roll by Melike B — https://www.pexels.com/photo/12194367/ (2383 × 2110). The roll stands in for a finger, so the band crosses it as when worn. Cut out by `scripts/cut-ring.mjs`: the gold found by its colour, gaps closed, the background flood-filled; the two settings filled as measured circles (their halos are white stones), the band's pavé strip kept as a measured strip, the band cut where it goes under the roll; the colours are the photo's own. Rotated 90° so the band runs across, and stored as lossless WebP (pixel-identical to the PNG). No brand is shown or named.

Scale on the hand photo is measured: 953 px across the knuckles in the photo, taken as 79 mm (an adult woman's average hand breadth) → 6.58 px/mm on the stage. The example ring's width across the finger, 20.5 mm, is approximate (about 2.7 times a halo's width); it is an example product, not a store's.

## Face detection for glasses (T68, 2026-10-03)

- `face-landmarker.task`: MediaPipe's official Face Landmarker model (float16, Apache-2.0) from https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task — 3,758,596 bytes, SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`. Runs in the shopper's browser (like the hand model): the photo never leaves the device. Its two iris centres (landmarks 468 and 473), taken as 62 mm apart, size the frame. On the demo's own portrait it puts the frame at −2°, as measured by hand (−2.3°).

## Necklace (T68, 2026-10-03)

Real photographs under the [Pexels License](https://www.pexels.com/license/) (credited here anyway). The model wears a hijab — a modest choice for a Saudi audience; long necklaces are worn over it.

- `model-neck.webp` (and `model-neck-thumb.webp`): a portrait in a black hijab by Abdulkadir Muhammad Sani — https://www.pexels.com/photo/34900678/ (4480 × 6720). Cropped to y 2560–6480 (from the lips down) and scaled to the 1200 × 1050 stage; nothing else changed.
- `necklace-front.webp`: a gold pendant necklace on a teal display bust by sinu sony — https://www.pexels.com/photo/20768279/ (3889 × 5835). The bust holds the chains as worn. Cut out by `scripts/cut-necklace.mjs`: what is warm (gold, pearls) or bright near-white (the white stones) kept; the medallion and the two roundels filled as measured circles, keeping all but the bust's teal; teal showing through the openwork removed; the chains fade where they go behind the neck; the colours are the photo's own. Stored as WebP (quality 90, alpha lossless) — a demo asset, not a merchant's picture.

Scale on the portrait is measured: the pupils are 810 px apart in the photo, taken as 62 mm → 13.07 px/mm, × 1200/4480 on the stage = 3.50 px/mm. The example necklace's width across at the neck, 170 mm, is approximate (the bust's neck taken as 100 mm); it is an example product, not a store's.

## Bag (T68, 2026-10-03)

Real photographs under the [Pexels License](https://www.pexels.com/license/) (credited here anyway). The model wears an abaya and hijab — a modest choice for a Saudi audience.

- `model-bag.webp` (and `model-bag-thumb.webp`): a full-length portrait in a black abaya by Kazys Photography — https://www.pexels.com/photo/32279506/ (4160 × 6240). Cropped to y 2100–5740 (shoulders to below the knees) and scaled to the 1200 × 1050 stage; nothing else changed.
- `model-bag-hand.webp`: the same photo's fingers of her left hand, cut by skin colour from a 140 × 120 box around the hand (alpha softened), drawn over the bag so the handles pass behind her fingers.
- `bag-front.webp`: an embroidered tan handbag on a grey sweep by Amjed wani — https://www.pexels.com/photo/26610519/ (6000 × 4000). Cut out by `scripts/cut-bag.mjs`: warm or dark kept, the neutral sweep and its shadow dropped everywhere (the light through the handles too), the largest piece kept; the colours are the photo's own. Stored as WebP (quality 90, alpha lossless).

Scale on the portrait is measured: 5300 px from the top of her hijab to her feet, taken as 160 cm (an adult Saudi woman's average height, approximately) → 3.31 px/mm, × 1200/4160 on the stage = 0.956 px/mm. The example bag's width, 280 mm, is approximate; it is an example product, not a store's.

## Earring (P5.5, 2026-10-04)

Real photographs under the [Pexels License](https://www.pexels.com/license/) (credited here anyway). The model photo is an ear alone, no face — a modest choice for a Saudi audience, and the hijab portraits cover the ears.

- `model-ear.webp` (and `model-ear-thumb.webp`): a close-up of a woman's ear, the lobe pierced, by Karolina Grabowska (Kaboompics) — https://www.pexels.com/photo/8092973/ (4480 × 6720). Cropped 3600 × 3150 from (74, 3135) and scaled to the 1200 × 1050 stage (the lobe in the stage's visible middle); nothing else changed.
- `earring-front.webp`: a pair of diamond-set gold huggie hoops on a grey sweep by The Glorious Studio — https://www.pexels.com/photo/20943477/ (5992 × 5992); the right-hand hoop, standing upright as it hangs. Cut out by `site/scripts/cut-earring.mjs`: gold (warm — even the pale hinge, the sweep being neutral grey) or dark kept; the white stones kept by where they lie, inside the hoop's band (closed with a round element, at least 8 px from the outside); the sweep inside the hoop and outside dropped; small enclosed clear spots filled; colours the photo's own. Stored as WebP (quality 90, alpha lossless). No brand is shown or named.

Scale on the ear is measured: 2,308 px from the top of the helix to the bottom of the lobe in the photo, taken as 60 mm (an adult woman's ear, approximately) → 38.5 px/mm, × 1200/3600 on the stage = 12.8 px/mm. The example hoop is about 18 mm tall (its true diameter: the photo is seen three-quarter on), so 10.6 mm across as seen; it is an example product, not a store's.
