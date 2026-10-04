'use client';

import { useState } from 'react';
import { useLang, pick } from '@site/lib/i18n';
import { ANNUAL_MONTHS, PLANS, num, type Cycle, type Plan } from '@site/lib/plans';

/**
 * What the try-on has to earn to pay for itself.
 *
 * Every number here is the merchant's own: their traffic, their conversion rate, their
 * basket, their return rate — and the three effects are theirs to set too. We publish no
 * uplift figures of our own (CLAUDE.md rule 5: invent nothing), so the panel states plainly
 * that the last three fields are assumptions, and shows the arithmetic rather than a verdict.
 *
 * It works in revenue, not profit, and says so: we do not know a merchant's margins.
 */

/**
 * Arabic counts the thing it counts: one, two, a few (3–10) and many (11+) each take a
 * different form. English only needs a plural.
 */
const ordersAr = (n: number) =>
  n === 1 ? 'بطلب إضافي واحد'
    : n === 2 ? 'بطلبين إضافيين'
      : n <= 10 ? `بـ${num(n)} طلبات إضافية`
        : `بـ${num(n)} طلبًا إضافيًا`;

const ordersEn = (n: number) => `${num(n)} extra order${n === 1 ? '' : 's'}`;

/** The same agreement, without the "extra" and without the preposition. */
const countAr = (n: number) =>
  n === 1 ? 'طلب واحد'
    : n === 2 ? 'طلبان'
      : n <= 10 ? `${num(n)} طلبات`
        : `${num(n)} طلبًا`;

const countEn = (n: number) => `${num(n)} order${n === 1 ? '' : 's'}`;

const PRICED = PLANS.filter((p) => p.price !== null) as (Plan & { price: number; priceAnnual: number })[];

type Field = { key: keyof Inputs; label: [string, string]; hint?: [string, string]; suffix: [string, string]; max: number; step?: number };

type Inputs = {
  visits: number;
  conversion: number;
  basket: number;
  returns: number;
  tried: number;
  uplift: number;
  fewerReturns: number;
};

const START: Inputs = { visits: 20_000, conversion: 1.8, basket: 450, returns: 12, tried: 20, uplift: 10, fewerReturns: 10 };

const YOURS: Field[] = [
  { key: 'visits', label: ['زيارات صفحات المنتجات شهريًا', 'Product page visits a month'], suffix: ['زيارة', 'visits'], max: 10_000_000, step: 100 },
  { key: 'conversion', label: ['نسبة التحويل الحالية', 'Conversion rate today'], suffix: ['%', '%'], max: 100, step: 0.1 },
  { key: 'basket', label: ['متوسط قيمة الطلب', 'Average order value'], suffix: ['ر.س', 'SAR'], max: 1_000_000, step: 10 },
  { key: 'returns', label: ['نسبة الإرجاع الحالية', 'Return rate today'], suffix: ['%', '%'], max: 100, step: 0.5 },
];

const ASSUMED: Field[] = [
  {
    key: 'tried', label: ['من الزوّار يفتحون التجربة', 'Of visitors who open the try-on'],
    hint: ['نسبة من يضغط زر «جرّبها» في صفحة المنتج.', 'The share who tap “Try it” on the product page.'],
    suffix: ['%', '%'], max: 100, step: 1,
  },
  {
    key: 'uplift', label: ['تحسّن التحويل بين من جرّبوا', 'Conversion uplift among those who try'],
    hint: ['كم ترى أن التحويل سيرتفع لدى هذه المجموعة، نسبةً إلى تحويلك الحالي.', 'How much higher you expect this group to convert, relative to your rate today.'],
    suffix: ['%', '%'], max: 500, step: 1,
  },
  {
    key: 'fewerReturns', label: ['انخفاض الإرجاع بين من جرّبوا', 'Fewer returns among those who try'],
    hint: ['الإرجاع الذي يعود إلى المقاس أو الحجم المتوقَّع.', 'Returns that come down to size or expected scale.'],
    suffix: ['%', '%'], max: 100, step: 1,
  },
];

export function RoiPanel({ cycle }: { cycle: Cycle }) {
  const { lang, t } = useLang();
  const [v, setV] = useState<Inputs>(START);
  const [planId, setPlanId] = useState(PRICED.find((p) => p.featured)?.id ?? PRICED[0].id);

  const plan = PRICED.find((p) => p.id === planId) ?? PRICED[0];
  const perMonth = cycle === 'annual' ? plan.priceAnnual / 12 : plan.price;

  const ordersNow = (v.visits * v.conversion) / 100;
  const triedVisits = (v.visits * v.tried) / 100;
  const extraOrders = (triedVisits * v.conversion * v.uplift) / 10_000;
  const extraRevenue = extraOrders * v.basket;
  const returnsAvoided = ((triedVisits * v.conversion) / 100) * (v.returns / 100) * (v.fewerReturns / 100);
  const returnsValue = returnsAvoided * v.basket;
  const gain = extraRevenue + returnsValue;
  // Rounded before the subtraction, or the last line disagrees with the two above it.
  const net = Math.round(gain) - Math.round(perMonth);
  const paysForItself = v.basket > 0 ? Math.ceil(perMonth / v.basket) : 0;

  const set = (f: Field, raw: string) => {
    const n = Number(raw.replace(/[^\d.]/g, ''));
    setV((prev) => ({ ...prev, [f.key]: Number.isFinite(n) ? Math.min(Math.max(n, 0), f.max) : 0 }));
  };

  const row = (f: Field) => (
    <label className="field" key={f.key}>
      <span>{t(f.label[0], f.label[1])}</span>
      <span className="roi-input">
        <input inputMode="decimal" step={f.step} value={String(v[f.key])} onChange={(e) => set(f, e.target.value)}
          aria-describedby={f.hint ? `roi-hint-${f.key}` : undefined} />
        <i aria-hidden>{t(f.suffix[0], f.suffix[1])}</i>
      </span>
      {f.hint && <small id={`roi-hint-${f.key}`}>{t(f.hint[0], f.hint[1])}</small>}
    </label>
  );

  return (
    <div className="roi">
      <div className="form roi-form">
        <fieldset>
          <legend>{t('أرقام متجرك', 'Your store’s numbers')}</legend>
          <div className="field-row">{YOURS.map(row)}</div>
        </fieldset>

        <fieldset>
          <legend>{t('افتراضاتك', 'Your assumptions')}</legend>
          <p className="roi-note">{t(
            'هذه الثلاثة افتراضاتك أنت. لا ننشر نسب تحسّن من عندنا، ولن نضع لك رقمًا لم نقِسه.',
            'These three are your assumptions. We publish no uplift figures of our own, and we will not put a number here that we have not measured.')}</p>
          <div className="field-row">{ASSUMED.map(row)}</div>
        </fieldset>
      </div>

      <div className="panel-card roi-out">
        <label className="field">
          <span>{t('الباقة', 'Plan')}</span>
          <select value={planId} onChange={(e) => setPlanId(e.target.value as typeof planId)}>
            {PRICED.map((p) => <option key={p.id} value={p.id}>{pick(p.name, lang)}</option>)}
          </select>
        </label>

        <p className="roi-cost">
          <bdi>{num(perMonth)}</bdi>
          <span>{cycle === 'annual'
            ? t('ر.س شهريًا، مدفوعة سنويًا', 'SAR a month, billed annually')
            : t('ر.س شهريًا', 'SAR a month')}</span>
        </p>

        <p className="roi-pays">{t(
          `تسدّد الباقة نفسها ${ordersAr(paysForItself)} في الشهر`,
          `The plan pays for itself with ${ordersEn(paysForItself)} a month`)}</p>

        <dl className="roi-lines">
          <div><dt>{t('طلباتك اليوم', 'Orders today')}</dt><dd><bdi>{num(ordersNow)}</bdi></dd></div>
          <div><dt>{t('من يفتحون التجربة', 'Visitors who try it')}</dt><dd><bdi>{num(triedVisits)}</bdi></dd></div>
          <div><dt>{t('طلبات إضافية', 'Extra orders')}</dt><dd><bdi>{num(extraOrders)}</bdi></dd></div>
          <div><dt>{t('إيراد إضافي', 'Extra revenue')}</dt><dd><bdi>{num(extraRevenue)}</bdi> {t('ر.س', 'SAR')}</dd></div>
          <div><dt>{t('إرجاع تم تفاديه', 'Returns avoided')}</dt><dd className="roi-words">{t(countAr(Math.round(returnsAvoided)), countEn(Math.round(returnsAvoided)))}</dd></div>
          <div><dt>{t('قيمة الإرجاع المتفادى', 'Value of those returns')}</dt><dd><bdi>{num(returnsValue)}</bdi> {t('ر.س', 'SAR')}</dd></div>
          <div className="roi-total"><dt>{t('الأثر الشهري على الإيراد', 'Monthly effect on revenue')}</dt><dd><bdi>{num(gain)}</bdi> {t('ر.س', 'SAR')}</dd></div>
          <div className="roi-total"><dt>{t('بعد سعر الباقة', 'After the plan price')}</dt>
            <dd className={net < 0 ? 'roi-down' : undefined}><bdi>{num(net)}</bdi> {t('ر.س', 'SAR')}</dd></div>
        </dl>

        <p className="fine">{t(
          'الأرقام إيراد، لا ربحًا — هوامشك لا نعرفها. لا تشمل ضريبة القيمة المضافة ولا تكلفة نمذجة المنتجات. الحساب يجري في متصفحك ولا يُرسل إلى أحد.',
          'These are revenue figures, not profit — we do not know your margins. VAT and any product modelling are not included. The arithmetic runs in your browser and is sent nowhere.')}</p>
      </div>
    </div>
  );
}

/** Monthly / annual switch. Annual is ten months' price, stated as such. */
export function CycleSwitch({ cycle, onChange }: { cycle: Cycle; onChange: (next: Cycle) => void }) {
  const { t } = useLang();
  const opts: { id: Cycle; label: string }[] = [
    { id: 'monthly', label: t('شهريًا', 'Monthly') },
    { id: 'annual', label: t('سنويًا', 'Annually') },
  ];
  return (
    <div className="cycle">
      <div className="cycle-toggle" role="group" aria-label={t('دورة الفوترة', 'Billing cycle')}>
        {opts.map((o) => (
          <button key={o.id} type="button" aria-pressed={cycle === o.id}
            className={'cycle-btn' + (cycle === o.id ? ' on' : '')} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      <span className="cycle-save">{t(
        `الاشتراك السنوي بسعر ${ANNUAL_MONTHS} أشهر — شهران مجانًا`,
        `A year costs ${ANNUAL_MONTHS} months — two months free`)}</span>
    </div>
  );
}
