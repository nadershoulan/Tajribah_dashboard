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
