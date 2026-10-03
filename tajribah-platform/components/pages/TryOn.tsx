'use client';

// MD-070 / P5.10 — Virtual try-on: set up each watch for the try-on studio (the owner's studio, T26)

import { useWriteLock } from '@/components/dashboard/write-lock';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Camera, Lock, Watch } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { ApiError, currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useData, useResource } from '@/lib/data';
import { formatBytes, formatNumber, formatPercent } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { SLOTS_OF, WIDTH_LABEL, sayCutout, slotInfo, type TryOnKind } from '@/lib/tryon';
import { CALIBRATE_MIN_PX, TRUE_SIZE_MIN, alphaFacts, type SlotQuality } from '@/lib/tryon-quality';
import type { TryOnWatchView } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';

export default function TryOn() {
  const { t } = useLang();
  const lock = useWriteLock(); // T50: a read-only store or a staff view changes nothing
  const auth = useAuth();
  const role = currentStore(auth.me)?.role;
  const canEdit = !role || (ROLE_PERMISSIONS[role] as readonly string[]).includes('tryon:write');
  const { data, loading, error } = useResource((s) => s.tryOn(), []);
  const crumbs = [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('التجربة الافتراضية', 'Virtual try-on') }];

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('التجربة الافتراضية', 'Virtual try-on')}
        lead={t('جهّز ساعاتك ونظاراتك لاستوديو التجربة: يجرّب المتسوق الساعة على معصم والنظارة على وجه بمقاسها الحقيقي، أو بجانب أشياء يعرف حجمها.',
          'Set your watches and glasses up for the try-on studio: shoppers try a watch on a wrist and glasses on a face at their real size, or beside things they know the size of.')}
      />
      {loading && !data && <Loading rows={4} />}
      {error && <ErrorNote error={error} />}
      {data && !data.onMe && (
        <Panel>
          <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Lock size={16} aria-hidden />{t('في باقتك يجرّب المتسوق الساعة على النموذج ويقارن مقاسها. تجربتها على صورته هو تأتي مع الباقة الاحترافية.', 'On your plan, shoppers try the watch on the model and compare its size. Trying it on their own photo comes with the Pro plan.')}
            <AppLink href="/dashboard/billing" className="btn btn-accent btn-sm" style={{ marginInlineStart: 'auto' }}>{t('الباقات', 'Plans')}</AppLink>
          </p>
        </Panel>
      )}
      {data && data.watches.length === 0 && (
        <Empty icon={<Watch size={22} />} title={t('لا ساعات ولا نظارات بعد', 'No watches or glasses yet')}
          body={t('اجعل نوع المنتج «ساعة» أو «نظارات» في صفحته ليظهر هنا. بقية الأنواع تأتي تباعًا.', 'Set a product’s type to Watch or Eyewear on its page and it appears here. Other kinds follow.')}
          action={<AppLink href="/dashboard/products" className="btn btn-ghost">{t('المنتجات', 'Products')}</AppLink>} />
      )}
      <div style={{ display: 'grid', gap: 16 }}>
        {data?.watches.map((w) => <WatchCard key={w.productId} initial={w} editable={canEdit && !lock.locked} />)}
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
  const [marking, setMarking] = useState<'worn' | 'flat' | null>(null);
  // P5.9: a new picture is checked in the background; look again until its check is back.
  const checking = (!!w.worn && !w.quality.worn) || (!!w.flat && !w.quality.flat);
  useEffect(() => {
    if (!checking) return;
    let live = true;
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 20) { clearInterval(timer); return; }
      source.tryOn().then((screen) => {
        const next = screen.watches.find((x) => x.productId === w.productId);
        if (live && next) setW((now) => ({ ...now, worn: next.worn, flat: next.flat, quality: next.quality }));
      }).catch(() => undefined);
    }, 4000);
    return () => { live = false; clearInterval(timer); };
  }, [checking, source, w.productId]);

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
        const name = what === 'worn' || what === 'flat' ? slotInfo(w.kind, what).label : null;
        const joined = { ar: lines.map((l) => l.ar).join(' '), en: lines.map((l) => l.en).join(' ') };
        setNote({ tone: 'bad', text: name ? { ar: `${name.ar}: ${joined.ar}`, en: `${name.en} ${joined.en}` } : joined });
      } else setFailure(e as Error);
    } finally { setBusy(null); }
  };
  const save = () => run('save', () => source.updateTryOn(w.productId, {
    caseMm: caseMm.trim() === '' ? null : Number(caseMm.replace(',', '.')), finishAr: finishAr || null, finishEn: finishEn || null,
  }), { ar: 'حُفظ.', en: 'Saved.' });
  const toggle = (on: boolean) => run('toggle', () => source.updateTryOn(w.productId, { enabled: on }),
    on ? { ar: 'زر التجربة يظهر في متجرك بعد نشر المنتج من «إعدادات العرض» (انشر في المتجر). إن كان منشورًا فقد حُدّث.', en: 'The try-on button appears in your store once the product is published from AR settings (Publish to the store). If it is already published, it has been updated.' } : { ar: 'أُوقف.', en: 'Switched off.' });

  const status = w.enabled ? <Badge tone="ok" dot>{t('مفعّلة', 'On')}</Badge>
    : w.ready ? <Badge tone="accent">{t('جاهزة للتفعيل', 'Ready to switch on')}</Badge>
      : <Badge tone="warn">{t('ناقصة', 'Incomplete')}</Badge>;
  // P5.13 — from the screen's list only: an upload or a save returns the settings, not the numbers.
  const stats = initial.last30;
  const missingText = w.missing.map((m) => (m === 'case' ? pick(WIDTH_LABEL[w.kind]) : pick(slotInfo(w.kind, m).label))).join(t('، ', ', '));

  return (
    <Panel title={lang === 'ar' ? w.nameAr ?? w.name : w.name} sub={w.sku ? `${t('الرمز', 'SKU')} ${w.sku}` : undefined} actions={status}>
      <div className="tryon-grid">
        {SLOTS_OF[w.kind].map((slot) => (
          <Picture key={slot} kind={w.kind} productId={w.productId} slot={slot} has={w[slot]} quality={w.quality[slot]} disabled={!editable || busy !== null}
            busy={busy === slot} onPick={(file) => { setMarking(null); void run(slot, () => source.uploadCutout(w.productId, slot, file), { ar: 'قُبلت الصورة.', en: 'Picture accepted.' }); }}
            onMark={editable && w.quality[slot] && !w.quality[slot]!.issue ? () => setMarking(slot) : undefined} />
        ))}
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div className="field">
            <label htmlFor={`case-${w.productId}`}>{pick(WIDTH_LABEL[w.kind])}</label>
            <div className="input-unit">
              <input id={`case-${w.productId}`} inputMode="decimal" dir="ltr" value={caseMm} disabled={!editable} onChange={(e) => setCaseMm(e.target.value)} />
              <span aria-hidden>{t('مم', 'mm')}</span>
            </div>
            <span className="field-hint">{w.kind === 'glasses'
              ? t('عرض الإطار من الأمام، من مفصل إلى مفصل (100–170 مم).', 'The frame’s front width, hinge to hinge (100–170 mm).')
              : w.productWidthMm && !w.caseMm
                ? t(`عرض المنتج المسجّل ${w.productWidthMm} مم — تأكد أنه عرض العلبة وحدها.`, `The product’s width on record is ${w.productWidthMm} mm — make sure it is the case alone.`)
                : t('عرض العلبة وحدها بلا تاج، كما تقيسه أنت.', 'The case alone, without the crown, as you measure it.')}</span>
          </div>
          <div className="field">
            <label htmlFor={`fin-ar-${w.productId}`}>{t('وصف اللون (اختياري)', 'Finish (optional)')}</label>
            <input id={`fin-ar-${w.productId}`} dir="rtl" placeholder={w.kind === 'glasses' ? 'معدن أسود · عدسات شفافة' : 'ذهبي · مينا أخضر'} value={finishAr} disabled={!editable} onChange={(e) => setFinishAr(e.target.value)} />
            <input dir="ltr" placeholder={w.kind === 'glasses' ? 'Black metal · clear lenses' : 'Gold · green dial'} value={finishEn} disabled={!editable} onChange={(e) => setFinishEn(e.target.value)} aria-label={t('وصف اللون بالإنجليزية', 'Finish in English')} />
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!editable || busy !== null}>{busy === 'save' ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ', 'Save')}</button>
        </div>
      </div>

      {marking && w.quality[marking] && (
        <CaseEdges key={w.quality[marking]!.key} kind={w.kind} productId={w.productId} slot={marking} busy={busy !== null} onCancel={() => setMarking(null)}
          onSave={(left, right) => {
            const key = w.quality[marking]!.key;
            setMarking(null);
            void run(`mark-${marking}`, async () => {
              try { return await source.calibrateCutout(w.productId, marking, { key, left, right }); } catch (e) {
                if (e instanceof ApiError && e.status === 409) throw new Error(t('تغيّرت الصورة منذ حدّدتها — حدّدها مرة أخرى.', 'The picture changed since you marked it — mark it again.'));
                throw e;
              }
            }, w.kind === 'glasses'
              ? { ar: 'نقصّ الصورة على حافتي الإطار ثم نفحص مقاسها من جديد.', en: 'Cropping the picture to the frame’s edges, then checking its size again.' }
              : { ar: 'نقصّ الصورة على حافتي العلبة ثم نفحص مقاسها من جديد.', en: 'Cropping the picture to the case’s edges, then checking its size again.' });
          }} />
      )}
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

function Picture({ kind, productId, slot, has, quality, disabled, busy, onPick, onMark }: {
  kind: TryOnKind; productId: string; slot: 'worn' | 'flat'; has: { bytes: number } | null; quality: SlotQuality | null; disabled: boolean; busy: boolean; onPick: (file: File) => void; onMark?: () => void;
}) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const picker = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  // Stored pictures are private until published: fetched with the session, shown from a blob.
  const bytes = has?.bytes ?? null;
  useEffect(() => {
    if (bytes === null) return;
    let live = true;
    let url: string | null = null;
    source.cutoutImage(productId, slot).then((blob) => { if (live) { url = URL.createObjectURL(blob); setSrc(url); } }).catch(() => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [source, productId, slot, bytes]);
  const info = slotInfo(kind, slot);
  return (
    <div className="tryon-picture">
      <strong>{pick(info.label)}</strong>
      <div className="tryon-checker">
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the merchant's own picture */}
        {has && src ? <img src={src} alt={pick(info.label)} /> : <Camera size={24} aria-hidden />}
        {busy && <span className="photo-slot-busy" role="status">{t('جارٍ الرفع والفحص…', 'Uploading and checking…')}</span>}
      </div>
      {has && <span className="hint" style={{ margin: 0 }}><span dir="ltr">{formatBytes(has.bytes, lang)}</span></span>}
      {has && <QualityNote quality={quality} kind={kind} />}
      <span className="hint" style={{ margin: 0 }}>{pick(info.hint)}</span>
      <input ref={picker} type="file" accept="image/png,image/webp,.png,.webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => picker.current?.click()}>{has ? t('بدّل الصورة', 'Replace') : t('ارفع صورة', 'Upload')}</button>
        {has && onMark && <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={onMark}>{kind === 'glasses' ? t('حدّد حافتي الإطار', 'Mark the frame edges') : t('حدّد حافتي العلبة', 'Mark the case edges')}</button>}
      </div>
    </div>
  );
}

/** P5.9 — what the check found: the studio draws the picture's full width as the case width. */
function QualityNote({ quality, kind }: { quality: SlotQuality | null; kind: TryOnKind }) {
  const { t } = useLang();
  const glasses = kind === 'glasses';
  if (!quality) return <span className="quality-note" role="status">{t('جارٍ فحص المقاس…', 'Checking the size…')}</span>;
  if (quality.issue === 'empty') return <span className="quality-note quality-bad">{glasses ? t('لا يظهر شيء في هذه الصورة. ارفع صورة الإطار.', 'Nothing is visible in this picture. Upload the frame.') : t('لا يظهر شيء في هذه الصورة. ارفع صورة الساعة.', 'Nothing is visible in this picture. Upload the watch.')}</span>;
  if (quality.issue === 'unreadable') return <span className="quality-note quality-bad">{t('تعذّرت قراءة الصورة. ارفعها مرة أخرى.', 'The picture could not be read. Upload it again.')}</span>;
  const pct = `${Math.floor(quality.sizeShown * 100)}%`;
  const trimmed = quality.trimmed ? t(' قصصنا الحواف الفارغة لتظهر بمقاسها.', ' We cropped away the empty edges so it shows at its size.') : '';
  if (quality.sizeShown < TRUE_SIZE_MIN) {
    return (
      <span className="quality-note quality-warn">
        {glasses
          ? t(`تظهر النظارة بنحو ${pct} من مقاسها الحقيقي: ظل أو توهج خفيف على الجانبين يوسّع الصورة دون الإطار. قصّها على حافتي الإطار بحدّ واضح.`,
            `The glasses show at about ${pct} of their real size: a soft shadow or glow at the sides widens the picture, not the frame. Crop it to the frame’s edges, with a clean edge.`)
          : t(`تظهر الساعة بنحو ${pct} من مقاسها الحقيقي: ظل أو توهج خفيف على الجانبين يوسّع الصورة دون الساعة. قصّها على حافتي العلبة بحدّ واضح.`,
            `The watch shows at about ${pct} of its real size: a soft shadow or glow at the sides widens the picture, not the watch. Crop it to the case’s edges, with a clean edge.`)}{trimmed}
      </span>
    );
  }
  return <span className="quality-note quality-ok">{t('بمقاسها الحقيقي.', 'True to size.')}{trimmed}</span>;
}

/**
 * T68 calibration — the merchant drags two markers to the case's left and right edges (the crown and
 * any shadow outside them); the picture is cropped to that span so its full width is the case, which
 * is what the studio draws (P5.9). The studio itself is untouched. Markers start at the visible edges;
 * arrow keys move the focused marker a pixel (Shift: ten).
 */
function CaseEdges({ kind, productId, slot, busy, onSave, onCancel }: {
  kind: TryOnKind; productId: string; slot: 'worn' | 'flat'; busy: boolean; onSave: (left: number, right: number) => void; onCancel: () => void;
}) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [picture, setPicture] = useState<{ url: string; width: number; height: number } | null>(null);
  const [edges, setEdges] = useState<[number, number]>([0, 0]);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<0 | 1 | null>(null);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    source.cutoutImage(productId, slot).then(async (blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const g = canvas.getContext('2d')!;
      g.drawImage(bitmap, 0, 0);
      const box = alphaFacts(g.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height).box;
      if (!live) return;
      url = URL.createObjectURL(blob);
      setPicture({ url, width: bitmap.width, height: bitmap.height });
      setEdges(box ? [box.left, box.left + box.width] : [0, bitmap.width]);
    }).catch(() => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [source, productId, slot]);

  const W = picture?.width ?? 1;
  const move = (which: 0 | 1, to: number) => setEdges(([l, r]) => which === 0
    ? [Math.max(0, Math.min(Math.round(to), r - CALIBRATE_MIN_PX)), r]
    : [l, Math.min(W, Math.max(Math.round(to), l + CALIBRATE_MIN_PX))]);
  const at = (e: PointerEvent) => {
    const rect = stage!.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * W;
  };
  const onKey = (which: 0 | 1) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); move(which, edges[which] + (e.key === 'ArrowRight' ? step : -step)); }
  };
  const pct = (x: number) => `${(x / W) * 100}%`;
  const [left, right] = edges;
  const label = pick(slotInfo(kind, slot).label);
  const glasses = kind === 'glasses';
  const unchanged = left === 0 && right === W;

  return (
    <div className="case-edges">
      <strong>{glasses ? t(`حدّد حافتي الإطار — ${label}`, `Mark the frame edges — ${label}`) : t(`حدّد حافتي العلبة — ${label}`, `Mark the case edges — ${label}`)}</strong>
      <p className="hint" style={{ margin: 0 }}>
        {glasses
          ? t('اسحب الخطين إلى طرفي الإطار عند المفصلين. ما خارج الخطين يُقص، فيظهر الإطار بعرضه الحقيقي في الاستوديو.',
            'Drag the two lines to the frame’s ends at the hinges. What lies outside them is cropped away, so the studio shows the frame at its real width.')
          : t('اسحب الخطين إلى حافتي العلبة اليمنى واليسرى، بلا التاج. ما خارج الخطين يُقص، فيظهر عرض العلبة بمقاسه الحقيقي في الاستوديو.',
            'Drag the two lines to the case’s left and right edges, without the crown. What lies outside them is cropped away, so the studio shows the case at its real width.')}
      </p>
      {!picture ? <Loading rows={2} /> : (
        // The picture is physical left-to-right whatever the page's direction: the markers sit on it.
        <div className="case-edges-frame" dir="ltr" style={{ width: `min(100%, ${Math.round((420 * picture.width) / picture.height)}px)` }}>
          <div className="case-edges-stage tryon-checker" ref={setStage} style={{ aspectRatio: `${picture.width} / ${picture.height}` }}
            onPointerMove={(e) => { if (dragging !== null) move(dragging, at(e)); }}
            onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the merchant's own picture */}
            <img src={picture.url} alt={label} draggable={false} />
            <div className="case-edges-cut" style={{ left: 0, width: pct(left) }} aria-hidden />
            <div className="case-edges-cut" style={{ left: pct(right), right: 0 }} aria-hidden />
            {([0, 1] as const).map((which) => (
              <div key={which} className="case-edges-mark" style={{ left: pct(edges[which]) }} role="slider" tabIndex={0}
                aria-label={which === 0 ? t('الحافة اليسرى للعلبة', 'The case’s left edge') : t('الحافة اليمنى للعلبة', 'The case’s right edge')}
                aria-valuemin={0} aria-valuemax={W} aria-valuenow={edges[which]} aria-valuetext={`${edges[which]} px`}
                onKeyDown={onKey(which)}
                onPointerDown={(e) => { e.currentTarget.parentElement!.setPointerCapture(e.pointerId); setDragging(which); }} />
            ))}
          </div>
        </div>
      )}
      {picture && (
        <p className="hint" style={{ margin: 0 }}>
          {t(`يبقى ${formatNumber(right - left, lang)} من ${formatNumber(W, lang)} بكسل في العرض، والارتفاع كما هو.`,
            `Keeps ${formatNumber(right - left, lang)} of ${formatNumber(W, lang)} pixels across; the height stays as it is.`)}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={!picture || busy || unchanged} onClick={() => onSave(left, right)}>{t('قصّ على هذين الحدّين', 'Crop to these edges')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>{t('إلغاء', 'Cancel')}</button>
      </div>
    </div>
  );
}
