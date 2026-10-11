# T135 — The phone camera try-on, learned from Tangiblee's

Asked by Nader on 2026-10-11 with two screenshots and a 30-second screen recording of Tangiblee's wrist try-on on a
phone (`cdn.tangiblee.com/widget`): "learn from images, and make instruction like it (rotated in good way) and the side
with animation … same for other product, also user can upload the product and have the option to view it in the phone
only just like the record". **This file is the tracker.** Same rules as T134 (the studio is Nader's code — additive;
real products, never drawn stand-ins; Arabic first; every check seen to fail; walked in a browser before it counts).

## What the recording shows (read frame by frame)

| Moment | Tangiblee | Ours today (T134.3) |
|---|---|---|
| Camera opens | The guide: a forearm lying **across** the screen, the hand at one edge (fingers running off it), a translucent watch on the wrist. Top bar: back, close. | A hand standing up, fingers to the top, a dashed band on the wrist. |
| Which hand | A pill with two hand icons above the shutter; switching **flips the guide** to the other side. | None. |
| Instruction | A dark banner at the top: «قم بلف كمك ووضع معصمك» (auto on) / «قم بشمر كمك والتقط صورة لمعصمك» (auto off). | A pill above the shutter with the live state. |
| Auto | A switch at the bottom (auto). With the wrist in the guide: «ثابت…» then «التقاط الصورة…», a shot is taken by itself and the camera stays; the banner offers «واقع في مشكلة؟ جرب يدوي — أوقف التلقائي». | Manual only. |
| Shots | The last shot's thumbnail at the bottom-left with a count badge; tapping it opens the results. | «صورك (n)» as text. |
| Result | Full picture, the watch on the wrist; a note «الصورة لغرض التوضيح فقط. قد يختلف حجم المنتج الفعلي»; «يظهر على 50mm | تغيير حجم المعصم»; share; back to the camera; the shots below with delete. | Full picture, drag/pinch, thumbnails, send to the screen. |

## Phases

### A — Guides like it, every kind  ·  ✅ 2026-10-11
- [x] The arm across the screen, the hand at the side (watch; the ring's hand up to the left so its finger stays in view), slightly tilted; the arm hanging (bag); the face
      (glasses, necklace); the head in profile (earring). Line art, the **real product picture translucent** where it
      will go (never a drawn watch), gently pulsing.
- [x] A left / right switch (hand; ear for an earring) that flips the guide with an animation (CSS scaleX on the
      drawing, the product slides across, never mirrored); the guide slides in when the camera opens; reduced motion respected.
      The earring is an ear close-up: the face model cannot see an ear, so the earring goes where the guide shows it (no taps).
- [x] Manual capture with no hand found: the product goes where the guide showed it (the guide's screen point mapped
      to the frame). Found on the way: a watch's dial was upside down on a right wrist — 12 o'clock now faces the little
      finger (placement.ts), which the right-hand guide needs.

### B — Auto capture  ·  ✅ 2026-10-11
- [x] «تلقائي» switch (on by default; none for an earring): found + held still → «ثبّت يدك…» (a ring fills round the shutter) →
      «جارٍ التقاط الصورة…» → a shot taken by itself, a flash, the camera stays; one photo per pose — the next only
      when the hand goes away (not one dropped frame) or takes a new pose. Off: the shutter only. The banner offers manual mode.
- [x] The instruction banner at the top; the last shot's thumbnail with its count at the bottom-left; the camera switch in the top bar.

### C — Result  ·  ✅ 2026-10-11
- [x] The illustration note; hand size (small / medium / large — the hand is the ruler, a hand far from the average
      gets a truer size — face / ear for those kinds); share / save the photo with the product and its shadow (the CDN
      allows it: `Access-Control-Allow-Origin: *`).

### D — "On the phone only" per product  ·  ✅ 2026-10-11
- [x] A switch in the product's try-on settings («على الجوال فقط»); `tryon_configs.phone_only` (0049, ROLLBACK);
      published as `tryon.mode: 'phone'`; in the preview too.
- [x] The shop's frame and the product page (`TryOnFor`): on a phone the camera try-on (with a close button); on a
      computer a QR code (`PhoneQr`) — a photo sent from the phone shows there with the product where it was left. The
      widget's frame already allows the camera.

## Log

| Date | Phase | What happened |
|---|---|---|
| 2026-10-11 | A–D | Built and walked: guides per kind with the product translucent and the side flip; auto capture (one photo per pose); the result's hand size, note and share; on the phone only (dashboard switch → shop frame: QR on a computer, camera on a phone). The QR's corner mark no longer stretched (Nader): a square trimmed copy of the mark, drawn in its own proportions. |
| 2026-10-11 | — | Recording read frame by frame (30 s, 590×1280); plan written. |
