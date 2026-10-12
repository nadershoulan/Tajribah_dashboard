'use client';

// T140.5 — the try-on's real success numbers (Nader: how often the wrist is found, how often shoppers move it by hand)

import { Fragment, useEffect, useState } from 'react';
import { useAuth, type TryOnAccuracy } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Empty, ErrorNote, Loading, Panel, Stat } from '@/components/dashboard/ui';

const KIND: Record<string, { ar: string; en: string }> = {
  watch: { ar: 'ساعة', en: 'Watch' }, glasses: { ar: 'نظارة', en: 'Glasses' }, ring: { ar: 'خاتم', en: 'Ring' },
  necklace: { ar: 'قلادة', en: 'Necklace' }, earring: { ar: 'قرط', en: 'Earring' }, bag: { ar: 'حقيبة', en: 'Bag' },
};
const SOURCE: Record<string, { ar: string; en: string }> = {
  camera: { ar: 'كاميرا الجوال', en: 'Phone camera' }, upload: { ar: 'صورة مرفوعة', en: 'Uploaded photo' }, phone: { ar: 'من الجوال إلى الشاشة', en: 'Phone to screen' },
};
const LOOK: Record<string, { ar: string; en: string }> = {
  'as-is': { ar: 'كما هي', en: 'As it is' }, live: { ar: 'من الكاميرا الحيّة', en: 'From the live camera' }, cleaned: { ar: 'بعد تنقية صورة معتمة', en: 'Cleaned (dark or grainy)' },
  turned: { ar: 'بعد تدوير الصورة', en: 'Turned' }, shrunk: { ar: 'بعد تصغيرها (يد قريبة)', en: 'Shrunk (too close)' }, zoomed: { ar: 'بعد تكبير جزء (يد بعيدة)', en: 'Zoomed (far away)' }, loose: { ar: 'تعرّف أضعف', en: 'Weaker sighting' },
};

export default function AdminAccuracy() {
  const { t } = useLang();
  return <AdminShell title={t('دقة التجربة', 'Try-on accuracy')}><Figures /></AdminShell>;
}

function Figures() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TryOnAccuracy | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.accuracy(days).then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, days]);

  const n = (v: number) => formatNumber(v, lang);
  const pct = (v: number | null) => (v === null ? '—' : `${formatNumber(v, lang)}%`);
  const range = (
    <div className="btn-row" role="group" aria-label={t('المدة', 'Period')}>
      {[7, 30, 90].map((d) => <button key={d} type="button" className={'btn btn-sm ' + (d === days ? 'btn-primary' : 'btn-ghost')} aria-pressed={d === days} onClick={() => { if (d !== days) { setData(null); setError(null); setDays(d); } }}>{t(`${d} يومًا`, `${d} days`)}</button>)}
    </div>
  );
  if (error) return <><ErrorNote error={error} />{range}</>;
  if (!data) return <Panel><Loading rows={4} /></Panel>;
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>{t(
        'من أحداث مجهولة ترسلها التجربة عن كل صورة — لا صورة ولا هوية: هل وُجد المنتج تلقائيًا، وهل حرّكه المتسوّق بيده بعد ذلك.',
        'From anonymous events the try-on sends about each photo — no picture, no identity: was the product placed by itself, and did the shopper then move it by hand.',
      )}</p>
      {range}
      {data.photos === 0 ? (
        <Panel><Empty title={t('لا صور بعد في هذه المدة', 'No photos in this period yet')} body={t('تظهر الأرقام حين يجرّب المتسوقون المنتجات على صورهم.', 'The numbers appear as shoppers try products on their photos.')} /></Panel>
      ) : (
        <>
          <div className="grid grid-4" style={{ marginTop: 14 }}>
            <Stat label={t('صور التجربة', 'Try-on photos')} value={n(data.photos)} sub={t(`${n(data.shares)} مشاركة أو حفظ`, `${n(data.shares)} shared or saved`)} />
            <Stat label={t('وُجد تلقائيًا', 'Found by itself')} value={pct(data.foundPct)} sub={t(`${n(data.found.detected)} من ${n(data.found.detected + data.found.guide + data.found.none)}`, `${n(data.found.detected)} of ${n(data.found.detected + data.found.guide + data.found.none)}`)}
              hint={t('من الصور التي وضعت التجربة المنتج عليها بنفسها. الصور المضبوطة على الجوال والمرسلة إلى الشاشة محسوبة على حدة.', 'Of the photos the try-on had to place itself. Photos fitted on the phone and sent to the screen are counted apart.')} />
            <Stat label={t('حرّكه المتسوّق بيده', 'Moved by hand')} value={pct(data.movedPct)} sub={t('من كل الصور', 'of all photos')} />
            <Stat label={t('حُرّك رغم إيجاده', 'Moved although found')} value={pct(data.movedWhenFoundPct)} sub={t('أقرب مقياس لصحة الموضع التلقائي', 'the closest to "was the automatic place right?"')} />
          </div>
          <div className="grid grid-2" style={{ marginTop: 18 }}>
            <Panel title={t('حسب نوع المنتج', 'By kind of product')}>
              <div className="table-wrap"><table className="data"><thead><tr><th>{t('النوع', 'Kind')}</th><th>{t('صور', 'Photos')}</th><th>{t('وُجد تلقائيًا', 'Found')}</th><th>{t('حُرّك', 'Moved')}</th></tr></thead>
                <tbody>{data.kinds.map((k) => <tr key={k.name}><td>{KIND[k.name] ? pick(KIND[k.name]!) : k.name}</td><td className="num">{n(k.photos)}</td><td className="num">{pct(k.foundPct)}</td><td className="num">{pct(k.movedPct)}</td></tr>)}</tbody></table></div>
            </Panel>
            <Panel title={t('حسب مصدر الصورة', 'By where the photo came from')}>
              <div className="table-wrap"><table className="data"><thead><tr><th>{t('المصدر', 'Source')}</th><th>{t('صور', 'Photos')}</th><th>{t('وُجد تلقائيًا', 'Found')}</th><th>{t('حُرّك', 'Moved')}</th></tr></thead>
                <tbody>{data.sources.map((s) => <tr key={s.name}><td>{SOURCE[s.name] ? pick(SOURCE[s.name]!) : s.name}</td><td className="num">{n(s.photos)}</td><td className="num">{pct(s.foundPct)}</td><td className="num">{pct(s.movedPct)}</td></tr>)}</tbody></table></div>
            </Panel>
          </div>
          {data.looks.length > 0 && (
            <div style={{ marginTop: 18 }}><Panel title={t('كيف وُجد', 'How it was found')} sub={t('أيّ طريقة بحث وجدت المنتج — تساعد في معرفة ما يحتاج تحسينًا', 'Which look found it — shows what to improve next')}>
              <dl className="facts">{data.looks.map((l) => <Fragment key={l.how}><dt>{LOOK[l.how] ? pick(LOOK[l.how]!) : l.how}</dt><dd className="num">{n(l.n)}</dd></Fragment>)}</dl>
            </Panel></div>
          )}
        </>
      )}
      <p className="hint">{t('منذ', 'Since')} {formatDateTime(data.since, lang)}</p>
    </>
  );
}
