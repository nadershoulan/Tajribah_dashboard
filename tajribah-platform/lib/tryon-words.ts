/**
 * The try-on settings screen's words for each kind (P5.2 glasses, P5.4 rings) — the watch's are the
 * screen's original lines, unchanged. Arabic first, every line in both languages.
 */
import type { Bi } from './lang';
import type { TryOnKind } from './tryon';

export type KindWords = {
  widthHint: Bi;
  finish: Bi;
  markButton: Bi;
  markTitle: (label: string) => Bi;
  markHelp: Bi;
  cropping: Bi;
  empty: Bi;
  undersized: (pct: string) => Bi;
  /** "True to size" — Arabic agrees with the noun: الساعة/النظارة (feminine), الخاتم (masculine). */
  trueSize: Bi;
};

export const KIND_WORDS: Record<TryOnKind, KindWords> = {
  watch: {
    trueSize: { ar: 'بمقاسها الحقيقي.', en: 'True to size.' },
    widthHint: { ar: 'عرض العلبة وحدها بلا تاج، كما تقيسه أنت.', en: 'The case alone, without the crown, as you measure it.' },
    finish: { ar: 'ذهبي · مينا أخضر', en: 'Gold · green dial' },
    markButton: { ar: 'حدّد حافتي العلبة', en: 'Mark the case edges' },
    markTitle: (label) => ({ ar: `حدّد حافتي العلبة — ${label}`, en: `Mark the case edges — ${label}` }),
    markHelp: {
      ar: 'اسحب الخطين إلى حافتي العلبة اليمنى واليسرى، بلا التاج. ما خارج الخطين يُقص، فيظهر عرض العلبة بمقاسه الحقيقي في الاستوديو.',
      en: 'Drag the two lines to the case’s left and right edges, without the crown. What lies outside them is cropped away, so the studio shows the case at its real width.',
    },
    cropping: { ar: 'نقصّ الصورة على حافتي العلبة ثم نفحص مقاسها من جديد.', en: 'Cropping the picture to the case’s edges, then checking its size again.' },
    empty: { ar: 'لا يظهر شيء في هذه الصورة. ارفع صورة الساعة.', en: 'Nothing is visible in this picture. Upload the watch.' },
    undersized: (pct) => ({
      ar: `تظهر الساعة بنحو ${pct} من مقاسها الحقيقي: ظل أو توهج خفيف على الجانبين يوسّع الصورة دون الساعة. قصّها على حافتي العلبة بحدّ واضح.`,
      en: `The watch shows at about ${pct} of its real size: a soft shadow or glow at the sides widens the picture, not the watch. Crop it to the case’s edges, with a clean edge.`,
    }),
  },
  glasses: {
    trueSize: { ar: 'بمقاسها الحقيقي.', en: 'True to size.' },
    widthHint: { ar: 'عرض الإطار من الأمام، من مفصل إلى مفصل (100–170 مم).', en: 'The frame’s front width, hinge to hinge (100–170 mm).' },
    finish: { ar: 'معدن أسود · عدسات شفافة', en: 'Black metal · clear lenses' },
    markButton: { ar: 'حدّد حافتي الإطار', en: 'Mark the frame edges' },
    markTitle: (label) => ({ ar: `حدّد حافتي الإطار — ${label}`, en: `Mark the frame edges — ${label}` }),
    markHelp: {
      ar: 'اسحب الخطين إلى طرفي الإطار عند المفصلين. ما خارج الخطين يُقص، فيظهر الإطار بعرضه الحقيقي في الاستوديو.',
      en: 'Drag the two lines to the frame’s ends at the hinges. What lies outside them is cropped away, so the studio shows the frame at its real width.',
    },
    cropping: { ar: 'نقصّ الصورة على حافتي الإطار ثم نفحص مقاسها من جديد.', en: 'Cropping the picture to the frame’s edges, then checking its size again.' },
    empty: { ar: 'لا يظهر شيء في هذه الصورة. ارفع صورة الإطار.', en: 'Nothing is visible in this picture. Upload the frame.' },
    undersized: (pct) => ({
      ar: `تظهر النظارة بنحو ${pct} من مقاسها الحقيقي: ظل أو توهج خفيف على الجانبين يوسّع الصورة دون الإطار. قصّها على حافتي الإطار بحدّ واضح.`,
      en: `The glasses show at about ${pct} of their real size: a soft shadow or glow at the sides widens the picture, not the frame. Crop it to the frame’s edges, with a clean edge.`,
    }),
  },
  necklace: {
    trueSize: { ar: 'بحجمها الحقيقي.', en: 'True to size.' },
    widthHint: { ar: 'عرض القلادة من طرف إلى طرف عند الرقبة، كما تظهر من الأمام (60–300 مم).', en: 'The necklace’s width across at the neck, end to end, as seen from the front (60–300 mm).' },
    finish: { ar: 'ذهب · لؤلؤ', en: 'Gold · pearls' },
    markButton: { ar: 'حدّد طرفي القلادة', en: 'Mark the necklace’s ends' },
    markTitle: (label) => ({ ar: `حدّد طرفي القلادة — ${label}`, en: `Mark the necklace’s ends — ${label}` }),
    markHelp: {
      ar: 'اسحب الخطين إلى طرفي القلادة عند الرقبة. ما خارج الخطين يُقص، فتظهر القلادة بعرضها الحقيقي في الاستوديو.',
      en: 'Drag the two lines to the necklace’s ends at the neck. What lies outside them is cropped away, so the studio shows the necklace at its real width.',
    },
    cropping: { ar: 'نقصّ الصورة على طرفي القلادة ثم نفحص مقاسها من جديد.', en: 'Cropping the picture to the necklace’s ends, then checking its size again.' },
    empty: { ar: 'لا يظهر شيء في هذه الصورة. ارفع صورة القلادة.', en: 'Nothing is visible in this picture. Upload the necklace.' },
    undersized: (pct) => ({
      ar: `تظهر القلادة بنحو ${pct} من حجمها الحقيقي: ظل أو توهج خفيف على الجانبين يوسّع الصورة دون القلادة. قصّها على طرفيها بحدّ واضح.`,
      en: `The necklace shows at about ${pct} of its real size: a soft shadow or glow at the sides widens the picture, not the necklace. Crop it to its ends, with a clean edge.`,
    }),
  },
  bag: {
    trueSize: { ar: 'بحجمها الحقيقي.', en: 'True to size.' },
    widthHint: { ar: 'عرض الحقيبة من جانب إلى جانب، بلا المقابض (100–600 مم).', en: 'The bag’s width side to side, without the handles (100–600 mm).' },
    finish: { ar: 'جلد بني · تطريز', en: 'Tan leather · embroidery' },
    markButton: { ar: 'حدّد جانبي الحقيبة', en: 'Mark the bag’s sides' },
    markTitle: (label) => ({ ar: `حدّد جانبي الحقيبة — ${label}`, en: `Mark the bag’s sides — ${label}` }),
    markHelp: {
      ar: 'اسحب الخطين إلى جانبي الحقيبة. ما خارج الخطين يُقص، فتظهر الحقيبة بعرضها الحقيقي في الاستوديو.',
      en: 'Drag the two lines to the bag’s sides. What lies outside them is cropped away, so the studio shows the bag at its real width.',
    },
    cropping: { ar: 'نقصّ الصورة على جانبي الحقيبة ثم نفحص مقاسها من جديد.', en: 'Cropping the picture to the bag’s sides, then checking its size again.' },
    empty: { ar: 'لا يظهر شيء في هذه الصورة. ارفع صورة الحقيبة.', en: 'Nothing is visible in this picture. Upload the bag.' },
    undersized: (pct) => ({
      ar: `تظهر الحقيبة بنحو ${pct} من حجمها الحقيقي: ظل أو توهج خفيف على الجانبين يوسّع الصورة دون الحقيبة. قصّها على جانبيها بحدّ واضح.`,
      en: `The bag shows at about ${pct} of its real size: a soft shadow or glow at the sides widens the picture, not the bag. Crop it to its sides, with a clean edge.`,
    }),
  },
  ring: {
    trueSize: { ar: 'بمقاسه الحقيقي.', en: 'True to size.' },
    widthHint: { ar: 'عرض الخاتم من طرف إلى طرف كما يظهر على الإصبع: القطر الداخلي وسماكة الحلقة من الجهتين (14–30 مم).', en: 'The ring’s width end to end as it sits on a finger: the inner diameter plus the band on both sides (14–30 mm).' },
    finish: { ar: 'ذهب أصفر · فصوص شفافة', en: 'Yellow gold · clear stones' },
    markButton: { ar: 'حدّد طرفي الخاتم', en: 'Mark the ring’s ends' },
    markTitle: (label) => ({ ar: `حدّد طرفي الخاتم — ${label}`, en: `Mark the ring’s ends — ${label}` }),
    markHelp: {
      ar: 'اسحب الخطين إلى طرفي الحلقة حيث تلتف حول الإصبع. ما خارج الخطين يُقص، فيظهر الخاتم بعرضه الحقيقي في الاستوديو.',
      en: 'Drag the two lines to the band’s ends, where it goes round the finger. What lies outside them is cropped away, so the studio shows the ring at its real width.',
    },
    cropping: { ar: 'نقصّ الصورة على طرفي الخاتم ثم نفحص مقاسها من جديد.', en: 'Cropping the picture to the ring’s ends, then checking its size again.' },
    empty: { ar: 'لا يظهر شيء في هذه الصورة. ارفع صورة الخاتم.', en: 'Nothing is visible in this picture. Upload the ring.' },
    undersized: (pct) => ({
      ar: `يظهر الخاتم بنحو ${pct} من مقاسه الحقيقي: ظل أو توهج خفيف على الجانبين يوسّع الصورة دون الخاتم. قصّها على طرفي الحلقة بحدّ واضح.`,
      en: `The ring shows at about ${pct} of its real size: a soft shadow or glow at the sides widens the picture, not the ring. Crop it to the band’s ends, with a clean edge.`,
    }),
  },
};
