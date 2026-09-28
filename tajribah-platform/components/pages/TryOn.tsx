'use client';

// MD-070 / P5.10 — Virtual try-on: set up each watch for the try-on studio (the owner's studio, T26)

import { useEffect, useRef, useState } from 'react';
import { Camera, Lock, Watch } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { ApiError, currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useData, useResource } from '@/lib/data';
import { formatBytes, formatNumber, formatPercent } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { TRYON_SLOTS, sayCutout } from '@/lib/tryon';
import type { TryOnWatchView } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';

export default function TryOn() {
  const { t } = useLang();
  const auth = useAuth();
  const role = currentStore(auth.me)?.role;
  const canEdit = !role || (ROLE_PERMISSIONS[role] as readonly string[]).includes('tryon:write');
  const { data, loading, error } = useResource((s) => s.tryOn(), []);
  const crumbs = [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('التجربة الافتراضية', 'Virtual try-on') }];

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('التجربة الافتراضية', 'Virtual try-on')}
        lead={t('جهّز ساعاتك لاستوديو التجربة: يجرّب المتسوق الساعة على معصم بمقاسها الحقيقي، أو على صورته، أو بجانب أشياء يعرف حجمها.',
          'Set your watches up for the try-on studio: shoppers try the watch on a wrist at its real size, on their own photo, or beside things they know the size of.')}
      />
      {loading && !data && <Loading rows={4} />}
      {error && <ErrorNote error={error} />}
      {data && !data.included && (
        <Panel>
          <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Lock size={16} aria-hidden />{t('التجربة الافتراضية ضمن الباقة الاحترافية. ترى ساعاتك هنا، والإعداد يُفتح عند الترقية.', 'Virtual try-on is in the Pro plan. You can see your watches here; setting them up opens when you upgrade.')}
            <AppLink href="/dashboard/billing" className="btn btn-accent btn-sm" style={{ marginInlineStart: 'auto' }}>{t('الباقات', 'Plans')}</AppLink>
          </p>
        </Panel>
      )}
      {data && data.watches.length === 0 && (
        <Empty icon={<Watch size={22} />} title={t('لا ساعات بعد', 'No watches yet')}
          body={t('اجعل نوع المنتج «ساعة» في صفحته لتظهر هنا. التجربة للساعات أولًا، وبقية الأنواع تأتي تباعًا.', 'Set a product’s type to Watch on its page and it appears here. Try-on starts with watches; other kinds follow.')}
          action={<AppLink href="/dashboard/products" className="btn btn-ghost">{t('المنتجات', 'Products')}</AppLink>} />
      )}
      <div style={{ display: 'grid', gap: 16 }}>
        {data?.watches.map((w) => <WatchCard key={w.productId} initial={w} editable={canEdit && data.included} />)}
      </div>
    </Shell>
  );
}

function WatchCard({ initial, editable }: { initial: TryOnWatchView; editable: boolean }) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [w, setW] = useState(initial);
  const [caseMm, setCaseMm] = useState(initial.caseMm?.toString() ?? '');
  const [finishAr, setFinishAr] = useState(initial.finish?.ar ?? '');
  const [finishEn, setFinishEn] = useState(initial.finish?.en ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: { ar: string; en: string } } | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);

  const run = async (what: string, fn: () => Promise<TryOnWatchView>, done?: { ar: string; en: string }) => {
    setBusy(what); setFailure(null); setNote(null);
    try {
      const next = await fn();
      setW(next);
      if (done) setNote({ tone: 'ok', text: done });
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        const lines = Object.values(e.fields).flat().map(sayCutout);
        // A picture's refusal names the picture: "The watch as worn — has no transparency…".
        const name = what === 'worn' || what === 'flat' ? TRYON_SLOTS[what].label : null;
        const joined = { ar: lines.map((l) => l.ar).join(' '), en: lines.map((l) => l.en).join(' ') };
        setNote({ tone: 'bad', text: name ? { ar: `${name.ar}: ${joined.ar}`, en: `${name.en} ${joined.en}` } : joined });
      } else setFailure(e as Error);
    } finally { setBusy(null); }
  };
  const save = () => run('save', () => source.updateTryOn(w.productId, {
    caseMm: caseMm.trim() === '' ? null : Number(caseMm.replace(',', '.')), finishAr: finishAr || null, finishEn: finishEn || null,
  }), { ar: 'حُفظ.', en: 'Saved.' });
  const toggle = (on: boolean) => run('toggle', () => source.updateTryOn(w.productId, { enabled: on }),
    on ? { ar: 'زر التجربة يظهر في متجرك عند نشر إعداداتك.', en: 'The try-on button appears in your store once your settings are published.' } : { ar: 'أُوقف.', en: 'Switched off.' });

  const status = w.enabled ? <Badge tone="ok" dot>{t('مفعّلة', 'On')}</Badge>
    : w.ready ? <Badge tone="accent">{t('جاهزة للتفعيل', 'Ready to switch on')}</Badge>
      : <Badge tone="warn">{t('ناقصة', 'Incomplete')}</Badge>;
  // P5.13 — from the screen's list only: an upload or a save returns the settings, not the numbers.
  const stats = initial.last30;
  const missingText = w.missing.map((m) => (m === 'case' ? t('عرض العلبة', 'case width') : pick(TRYON_SLOTS[m].label))).join(t('، ', ', '));

  return (
    <Panel title={lang === 'ar' ? w.nameAr ?? w.name : w.name} sub={w.sku ? `${t('الرمز', 'SKU')} ${w.sku}` : undefined} actions={status}>
      <div className="tryon-grid">
        {(['worn', 'flat'] as const).map((slot) => (
          <Picture key={slot} productId={w.productId} slot={slot} has={w[slot]} disabled={!editable || busy !== null}
            busy={busy === slot} onPick={(file) => run(slot, () => source.uploadCutout(w.productId, slot, file), { ar: 'قُبلت الصورة.', en: 'Picture accepted.' })} />
        ))}
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div className="field">
            <label htmlFor={`case-${w.productId}`}>{t('عرض العلبة', 'Case width')}</label>
            <div className="input-unit">
              <input id={`case-${w.productId}`} inputMode="decimal" dir="ltr" value={caseMm} disabled={!editable} onChange={(e) => setCaseMm(e.target.value)} />
              <span aria-hidden>{t('مم', 'mm')}</span>
            </div>
            <span className="field-hint">{w.productWidthMm && !w.caseMm
              ? t(`عرض المنتج المسجّل ${w.productWidthMm} مم — تأكد أنه عرض العلبة وحدها.`, `The product’s width on record is ${w.productWidthMm} mm — make sure it is the case alone.`)
              : t('عرض العلبة وحدها بلا تاج، كما تقيسه أنت.', 'The case alone, without the crown, as you measure it.')}</span>
          </div>
          <div className="field">
            <label htmlFor={`fin-ar-${w.productId}`}>{t('وصف اللون (اختياري)', 'Finish (optional)')}</label>
            <input id={`fin-ar-${w.productId}`} dir="rtl" placeholder="ذهبي · مينا أخضر" value={finishAr} disabled={!editable} onChange={(e) => setFinishAr(e.target.value)} />
            <input dir="ltr" placeholder="Gold · green dial" value={finishEn} disabled={!editable} onChange={(e) => setFinishEn(e.target.value)} aria-label={t('وصف اللون بالإنجليزية', 'Finish in English')} />
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!editable || busy !== null}>{busy === 'save' ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ', 'Save')}</button>
        </div>
      </div>

      {stats && (
        <p className="hint tryon-stats">
          <span>{t('آخر 30 يومًا', 'Last 30 days')}</span>
          <span>{t('التجارب', 'Try-ons')} <strong dir="ltr">{formatNumber(stats.tryonSessions, lang)}</strong></span>
          <span>{t('مشاهدات المنتج', 'Product views')} <strong dir="ltr">{formatNumber(stats.views, lang)}</strong></span>
          {stats.views > 0 && <span>{t('التجارب إلى المشاهدات', 'Try-ons to views')} <strong dir="ltr">{formatPercent(stats.tryonSessions / stats.views, lang)}</strong></span>}
        </p>
      )}
      <div className="tryon-foot">
        <label className="toggle">
          <input type="checkbox" role="switch" checked={w.enabled} disabled={!editable || busy !== null || (!w.ready && !w.enabled)} onChange={(e) => void toggle(e.target.checked)} />
          <span>{t('زر «جرّبها» في صفحة المنتج', 'The “Try it on” button on the product page')}</span>
        </label>
        {!w.ready && <span className="hint" style={{ margin: 0 }}>{t(`ينقصها: ${missingText}.`, `Still needed: ${missingText}.`)}</span>}
      </div>
      {note && <p role="status" className={`upload-note upload-${note.tone === 'ok' ? 'done' : 'failed'}`} style={{ margin: '12px 0 0' }}>{pick(note.text)}</p>}
      {failure && <ErrorNote error={failure} />}
    </Panel>
  );
}

function Picture({ productId, slot, has, disabled, busy, onPick }: {
  productId: string; slot: 'worn' | 'flat'; has: { bytes: number } | null; disabled: boolean; busy: boolean; onPick: (file: File) => void;
}) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const picker = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  // Stored pictures are private until published: fetched with the session, shown from a blob.
  useEffect(() => {
    if (!has) return;
    let live = true;
    let url: string | null = null;
    source.cutoutImage(productId, slot).then((blob) => { if (live) { url = URL.createObjectURL(blob); setSrc(url); } }).catch(() => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [source, productId, slot, has]);
  const info = TRYON_SLOTS[slot];
  return (
    <div className="tryon-picture">
      <strong>{pick(info.label)}</strong>
      <div className="tryon-checker">
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the merchant's own picture */}
        {has && src ? <img src={src} alt={pick(info.label)} /> : <Camera size={24} aria-hidden />}
        {busy && <span className="photo-slot-busy" role="status">{t('جارٍ الرفع والفحص…', 'Uploading and checking…')}</span>}
      </div>
      {has && <span className="hint" style={{ margin: 0 }}><span dir="ltr">{formatBytes(has.bytes, lang)}</span></span>}
      <span className="hint" style={{ margin: 0 }}>{pick(info.hint)}</span>
      <input ref={picker} type="file" accept="image/png,image/webp,.png,.webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
      <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => picker.current?.click()}>{has ? t('بدّل الصورة', 'Replace') : t('ارفع صورة', 'Upload')}</button>
    </div>
  );
}
