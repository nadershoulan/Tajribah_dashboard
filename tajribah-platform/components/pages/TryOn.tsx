'use client';

// MD-070 / P5.10 — Virtual try-on: set up each watch for the try-on studio (the owner's studio, T26)

import { useWriteLock } from '@/components/dashboard/write-lock';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Camera, Lock, Search, Watch } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { ApiError, currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useData, useResource } from '@/lib/data';
import { formatBytes, formatNumber, formatPercent } from '@/lib/format';
import { clearStorePicture } from '@/lib/clear-picture';
import { useLang } from '@/lib/i18n';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { SLOTS_OF, WIDTH_LABEL, sayCutout, slotInfo, type TryOnKind } from '@/lib/tryon';
import { KIND_WORDS } from '@/lib/tryon-words';
import { CALIBRATE_MIN_PX, TRUE_SIZE_MIN, alphaFacts, type SlotQuality } from '@/lib/tryon-quality';
import type { TryOnOne, TryOnScreen, TryOnWatchView } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, PageSizePicker, Pagination, Panel } from '@/components/dashboard/ui';
import { DEFAULT_PAGE_SIZE, pageCount, rangeText, rowNumber, type PageSize } from '@/lib/pagination';
import { useDebounced } from '@/lib/use-debounced';

export default function TryOn() {
  const { t, lang } = useLang();
  const lock = useWriteLock(); // T50: a read-only store or a staff view changes nothing
  const auth = useAuth();
  const role = currentStore(auth.me)?.role;
  const canEdit = !role || (ROLE_PERMISSIONS[role] as readonly string[]).includes('tryon:write');
  const [version, setVersion] = useState(0); // P5.4/P5.5: a jewelry item marked as a ring or necklace moves into the list
  // T87: `/dashboard/tryon/{product}` — the same screen, for that product only (from its preview's link).
  const { path } = useEnv();
  const only = /^\/dashboard\/tryon\/([^/]+)\/?$/.exec(path)?.[1];
  const productId = only ? decodeURIComponent(only) : null;
  // T89: numbered pages and a search, as on Products — products already being set up come first.
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 250);
  const [perPage, setPerPage] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [paged, setPaged] = useState({ key: `${q}|${perPage}`, page: 1 });
  const page = paged.key === `${q}|${perPage}` ? paged.page : 1; // a new search or page size starts at page 1
  const { data, loading, error } = useResource((s): Promise<TryOnScreen & { product?: TryOnOne['product'] }> => (productId ? s.tryOnOne(productId) : s.tryOn({ page, pageSize: perPage, q: q || undefined })), [version, productId, page, perPage, q]);
  const pages = data?.total != null && data.pageSize ? pageCount(data.total, data.pageSize) : 1;
  const numberOf = (index: number) => (!productId && data?.page && data.pageSize ? formatNumber(rowNumber(data.page, data.pageSize, index), lang) : null);
  const reload = () => setVersion((v) => v + 1);
  const one = productId && data?.product ? data.product : null;
  const oneName = one ? (lang === 'ar' ? (one.nameAr ?? one.name) : one.name) : null;
  const crumbs = productId
    ? [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('التجربة الافتراضية', 'Virtual try-on'), href: '/dashboard/tryon' }, { label: oneName ?? t('المنتج', 'Product') }]
    : [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('التجربة الافتراضية', 'Virtual try-on') }];

  return (
    <Shell tenant={null} crumbs={crumbs}>
      {productId ? (
        <PageHead
          title={oneName ? t(`التجربة الافتراضية: ${oneName}`, `Virtual try-on: ${oneName}`) : t('التجربة الافتراضية', 'Virtual try-on')}
          lead={t('إعدادات التجربة لهذا المنتج وحده.', 'The try-on settings for this product only.')}
          actions={<AppLink href={`/dashboard/products/${encodeURIComponent(productId)}/preview`} className="btn btn-ghost btn-sm">{t('معاينة المنتج', 'Preview the product')}</AppLink>}
        />
      ) : <PageHead
        title={t('التجربة الافتراضية', 'Virtual try-on')}
        lead={t('جهّز ساعاتك ونظاراتك وخواتمك وقلائدك وأقراطك لاستوديو التجربة: يجرّبها المتسوق على عارضة حقيقية بمقاسها الحقيقي، أو بجانب أشياء يعرف حجمها.',
          'Set your watches, glasses, rings, necklaces and earrings up for the try-on studio: shoppers try each on a real model at its real size, or beside things they know the size of.')}
      />}
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
      {one && data && data.watches.length === 0 && data.jewelry.length === 0 && (
        <Empty icon={<Watch size={22} />} title={t('نوع هذا المنتج لا يُجرَّب بعد', 'This product’s type is not tried on yet')}
          body={t('اجعل نوعه «ساعة» أو «نظارات» أو «حقيبة» أو «مجوهرات» (للخواتم والقلائد والأقراط) في صفحته، ثم ارجع هنا. السوار يُجرَّب كساعة: على المعصم.', 'Set its type to Watch, Eyewear, Bag or Jewelry (for rings, necklaces and earrings) on its page, then come back. A bracelet is tried as a watch: on the wrist.')}
          action={<AppLink href={`/dashboard/products/${encodeURIComponent(one.id)}`} className="btn btn-ghost">{t('صفحة المنتج', 'The product’s page')}</AppLink>} />
      )}
      {!productId && (data?.total ?? 0) + (q ? 1 : 0) > 0 && (
        <div className="tryon-toolbar">
          <label className="pick-search">
            <Search size={15} aria-hidden />
            <span className="sr-only">{t('ابحث', 'Search')}</span>
            <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('ابحث بالاسم أو الرمز', 'Search by name or SKU')} />
          </label>
          <PageSizePicker id="tryon-page-size" value={perPage} onChange={setPerPage} />
          {data?.total != null && data.page && data.pageSize && <span className="hint" style={{ margin: 0 }}>{rangeText(data.page, data.pageSize, data.watches.length + data.jewelry.length, data.total, lang)}</span>}
        </div>
      )}
      {!productId && q && data && data.watches.length === 0 && data.jewelry.length === 0 && <p className="hint">{t('لا منتجات بهذا البحث.', 'No products match this search.')}</p>}
      {!productId && !q && data && data.watches.length === 0 && data.jewelry.length === 0 && (
        <Empty icon={<Watch size={22} />} title={t('لا منتجات للتجربة بعد', 'Nothing to try on yet')}
          body={t('اجعل نوع المنتج «ساعة» أو «نظارات» أو «مجوهرات» (للخواتم والقلائد والأقراط) في صفحته ليظهر هنا. بقية الأنواع تأتي تباعًا.', 'Set a product’s type to Watch, Eyewear or Jewelry (for rings, necklaces and earrings) on its page and it appears here. Other kinds follow.')}
          action={<AppLink href="/dashboard/products" className="btn btn-ghost">{t('المنتجات', 'Products')}</AppLink>} />
      )}
      <div style={{ display: 'grid', gap: 16 }}>
        {data?.watches.map((w, i) => <WatchCard key={w.productId} number={numberOf(i)} initial={w} editable={canEdit && !lock.locked} onUnmarked={reload} />)}
      </div>
      {data && data.jewelry.length > 0 && <JewelryPanel items={data.jewelry} numberOf={(i) => numberOf(data.watches.length + i)} editable={canEdit && !lock.locked} onMarked={reload} />}
      {!productId && pages > 1 && <Pagination page={data?.page ?? 1} pages={pages} onPage={(next) => setPaged({ key: `${q}|${perPage}`, page: next })} label={t('صفحات المنتجات', 'Product pages')} />}
    </Shell>
  );
}

function WatchCard({ initial, editable, onUnmarked, number = null }: { initial: TryOnWatchView; editable: boolean; onUnmarked: () => void; number?: string | null }) {
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
      source.tryOnOne(w.productId).then((screen) => {
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
  // T90: one step into the shop — the try-on switched on and the product published
  const [published, setPublished] = useState<number | null>(null);
  const publish = async () => {
    setBusy('publish'); setFailure(null); setNote(null);
    try {
      const result = await source.publishTryOn(w.productId);
      setW((now) => ({ ...now, enabled: true }));
      setPublished(result.version);
    } catch (e) { setFailure(e as Error); } finally { setBusy(null); }
  };
  const toggle = (on: boolean) => run('toggle', () => source.updateTryOn(w.productId, { enabled: on }),
    on ? { ar: 'زر التجربة يظهر في متجرك بعد نشر المنتج من «إعدادات العرض» (انشر في المتجر). إن كان منشورًا فقد حُدّث.', en: 'The try-on button appears in your store once the product is published from AR settings (Publish to the store). If it is already published, it has been updated.' } : { ar: 'أُوقف.', en: 'Switched off.' });

  const status = w.enabled ? <Badge tone="ok" dot>{t('مفعّلة', 'On')}</Badge>
    : w.ready ? <Badge tone="accent">{t('جاهزة للتفعيل', 'Ready to switch on')}</Badge>
      : <Badge tone="warn">{t('ناقصة', 'Incomplete')}</Badge>;
  // P5.13 — from the screen's list only: an upload or a save returns the settings, not the numbers.
  const stats = initial.last30;
  const missingText = w.missing.map((m) => (m === 'case' ? pick(WIDTH_LABEL[w.kind]) : pick(slotInfo(w.kind, m).label))).join(t('، ', ', '));

  return (
    <Panel title={(number ? `${number}. ` : '') + (lang === 'ar' ? w.nameAr ?? w.name : w.name)} sub={w.sku ? `${t('الرمز', 'SKU')} ${w.sku}` : undefined} actions={status}>
      <div className="tryon-grid">
        {SLOTS_OF[w.kind].map((slot) => (
          <Picture key={slot} kind={w.kind} productId={w.productId} slot={slot} has={w[slot]} quality={w.quality[slot]} disabled={!editable || busy !== null}
            busy={busy === slot} onPick={(file) => { setMarking(null); void run(slot, () => source.uploadCutout(w.productId, slot, file), { ar: 'قُبلت الصورة.', en: 'Picture accepted.' }); }}
            storePictures={w.storePictures ?? []}
            onStorePicture={(url) => {
              setMarking(null);
              // T92: its plain background taken off here (as on the preview), then checked like an upload
              void run(slot, async () => {
                const cleared = await clearStorePicture(await source.storePhoto(w.productId, url));
                if (!cleared.ok) throw new Error(pick(cleared.reason));
                return source.uploadCutout(w.productId, slot, cleared.file);
              }, { ar: 'أُزيلت خلفية صورة المتجر وقُبلت.', en: 'The store picture’s background was taken off, and it was accepted.' });
            }}
            onMark={editable && w.quality[slot] && !w.quality[slot]!.issue ? () => setMarking(slot) : undefined} />
        ))}
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div className="field">
            <label htmlFor={`case-${w.productId}`}>{pick(WIDTH_LABEL[w.kind])}</label>
            <div className="input-unit">
              <input id={`case-${w.productId}`} inputMode="decimal" dir="ltr" value={caseMm} disabled={!editable} onChange={(e) => setCaseMm(e.target.value)} />
              <span aria-hidden>{t('مم', 'mm')}</span>
            </div>
            <span className="field-hint">{w.kind === 'watch' && w.productWidthMm && !w.caseMm
              ? t(`عرض المنتج المسجّل ${w.productWidthMm} مم — تأكد أنه عرض العلبة وحدها.`, `The product’s width on record is ${w.productWidthMm} mm — make sure it is the case alone.`)
              : pick(KIND_WORDS[w.kind].widthHint)}</span>
          </div>
          <div className="field">
            <label htmlFor={`fin-ar-${w.productId}`}>{t('وصف اللون (اختياري)', 'Finish (optional)')}</label>
            <input id={`fin-ar-${w.productId}`} dir="rtl" placeholder={KIND_WORDS[w.kind].finish.ar} value={finishAr} disabled={!editable} onChange={(e) => setFinishAr(e.target.value)} />
            <input dir="ltr" placeholder={KIND_WORDS[w.kind].finish.en} value={finishEn} disabled={!editable} onChange={(e) => setFinishEn(e.target.value)} aria-label={t('وصف اللون بالإنجليزية', 'Finish in English')} />
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
            }, KIND_WORDS[w.kind].cropping);
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
      {editable && (
        <div className="tryon-publish">
          <button type="button" className="btn btn-primary" disabled={!w.ready || busy !== null} onClick={() => void publish()}>
            {busy === 'publish' ? t('جارٍ النشر…', 'Publishing…') : t('انشر في المتجر', 'Publish to the store')}
          </button>
          <span className="hint" style={{ margin: 0 }}>{published
            ? t(`نُشر (نسخة ${published}). يظهر الزر في متجرك وصفحة المنتج خلال دقيقة تقريبًا.`, `Published (version ${published}). The button shows in your store and on the product’s page within about a minute.`)
            : w.ready
              ? t('يفعّل التجربة وينشر المنتج بخطوة واحدة.', 'Switches the try-on on and publishes the product in one step.')
              : t(`أكمل أولًا: ${w.missing.map((m) => (m === 'case' ? pick(WIDTH_LABEL[w.kind]) : pick(slotInfo(w.kind, m).label))).join('، ')}.`, `Finish first: ${w.missing.map((m) => (m === 'case' ? pick(WIDTH_LABEL[w.kind]) : pick(slotInfo(w.kind, m).label))).join(', ')}.`)}</span>
          {published && <AppLink href={`/dashboard/products/${encodeURIComponent(w.productId)}/preview`} className="btn btn-ghost btn-sm">{t('معاينة المنتج', 'Preview the product')}</AppLink>}
        </div>
      )}
        {!w.ready && <span className="hint" style={{ margin: 0 }}>{t(`ينقصها: ${missingText}.`, `Still needed: ${missingText}.`)}</span>}
        {(w.kind === 'ring' || w.kind === 'necklace' || w.kind === 'earring') && !w.worn && editable && (
          <button type="button" className="btn btn-quiet btn-sm" style={{ marginInlineStart: 'auto' }} disabled={busy !== null}
            onClick={() => void run('unmark', async () => { const v = await source.updateTryOn(w.productId, { jewelry: null }); onUnmarked(); return v; })}>
            {w.kind === 'ring' ? t('ليس خاتمًا', 'Not a ring') : w.kind === 'earring' ? t('ليس قرطًا', 'Not an earring') : t('ليست قلادة', 'Not a necklace')}
          </button>
        )}
      </div>
      {note && <p role="status" className={`upload-note upload-${note.tone === 'ok' ? 'done' : 'failed'}`} style={{ margin: '12px 0 0' }}>{pick(note.text)}</p>}
      {failure && <ErrorNote error={failure} />}
    </Panel>
  );
}

function Picture({ kind, productId, slot, has, quality, disabled, busy, onPick, onMark, storePictures = [], onStorePicture }: {
  kind: TryOnKind; productId: string; slot: 'worn' | 'flat'; has: { bytes: number } | null; quality: SlotQuality | null; disabled: boolean; busy: boolean; onPick: (file: File) => void; onMark?: () => void;
  /** T80: the product's store pictures, one of which can be chosen instead of an upload. */
  storePictures?: string[]; onStorePicture?: (url: string) => void;
}) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const picker = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
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
        {storePictures.length > 0 && onStorePicture && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} aria-expanded={choosing} onClick={() => setChoosing((c) => !c)}>{t('من صور المتجر', 'From the store’s pictures')}</button>
        )}
        {has && onMark && <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={onMark}>{pick(KIND_WORDS[kind].markButton)}</button>}
      </div>
      {choosing && onStorePicture && (
        <div className="store-pictures">
          <span className="hint" style={{ margin: 0 }}>{t('اختر صورة من متجرك: نزيل خلفيتها (البيضاء أو أي لون واحد) ونقصّها على المنتج، ثم نفحصها كما نفحص الصورة المرفوعة.', 'Choose one of your store’s pictures: its background (white, or any one plain colour) is taken off and it is cropped to the product, then checked like an uploaded one.')}</span>
          <ul>
            {storePictures.map((url, i) => (
              <li key={url}>
                <button type="button" disabled={disabled} onClick={() => { setChoosing(false); onStorePicture(url); }}
                  aria-label={t(`صورة المتجر ${i + 1}`, `Store picture ${i + 1}`)}>
                  <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** P5.9 — what the check found: the studio draws the picture's full width as the case width. */
function QualityNote({ quality, kind }: { quality: SlotQuality | null; kind: TryOnKind }) {
  const { t, pick } = useLang();
  const words = KIND_WORDS[kind];
  if (!quality) return <span className="quality-note" role="status">{t('جارٍ فحص المقاس…', 'Checking the size…')}</span>;
  if (quality.issue === 'empty') return <span className="quality-note quality-bad">{pick(words.empty)}</span>;
  if (quality.issue === 'unreadable') return <span className="quality-note quality-bad">{t('تعذّرت قراءة الصورة. ارفعها مرة أخرى.', 'The picture could not be read. Upload it again.')}</span>;
  const pct = `${Math.floor(quality.sizeShown * 100)}%`;
  const trimmed = quality.trimmed ? t(' قصصنا الحواف الفارغة لتظهر بمقاسها.', ' We cropped away the empty edges so it shows at its size.') : '';
  if (quality.sizeShown < TRUE_SIZE_MIN) {
    return (
      <span className="quality-note quality-warn">
        {pick(words.undersized(pct))}{trimmed}
      </span>
    );
  }
  return <span className="quality-note quality-ok">{pick(words.trueSize)}{trimmed}</span>;
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
  const words = KIND_WORDS[kind];
  const unchanged = left === 0 && right === W;

  return (
    <div className="case-edges">
      <strong>{pick(words.markTitle(label))}</strong>
      <p className="hint" style={{ margin: 0 }}>
        {pick(words.markHelp)}
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

/** P5.4/P5.5 — Jewelry is rings, necklaces, earrings, bracelets…: only the merchant knows which is which. */
function JewelryPanel({ items, editable, onMarked, numberOf = () => null }: { items: TryOnScreen['jewelry']; editable: boolean; onMarked: () => void; numberOf?: (index: number) => string | null }) {
  const { t, lang } = useLang();
  const source = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const mark = async (productId: string, jewelry: 'ring' | 'necklace' | 'earring') => {
    setBusy(productId); setFailure(null);
    try { await source.updateTryOn(productId, { jewelry }); onMarked(); } catch (e) { setFailure(e as Error); } finally { setBusy(null); }
  };
  return (
    <Panel title={t('مجوهراتك', 'Your jewelry')} sub={t('الخواتم تُجرَّب على يد حقيقية، والقلائد على عارضة، والأقراط على أذن حقيقية. حدّد ما كل قطعة.', 'Rings are tried on a real hand, necklaces on a model and earrings on a real ear. Say which each piece is.')}>
      <ul className="jewelry-list">
        {items.map((item, index) => (
          <li key={item.productId}>
            <span>{numberOf(index) && <span className="pick-num">{numberOf(index)}</span>}<strong>{lang === 'ar' ? item.nameAr ?? item.name : item.name}</strong>{item.sku && <span className="hint" style={{ margin: 0 }}> · <span dir="ltr">{item.sku}</span></span>}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!editable || busy !== null} onClick={() => void mark(item.productId, 'ring')}>
                {busy === item.productId ? t('جارٍ…', 'Working…') : t('هذا خاتم', 'It’s a ring')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!editable || busy !== null} onClick={() => void mark(item.productId, 'necklace')}>
                {t('هذه قلادة', 'It’s a necklace')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!editable || busy !== null} onClick={() => void mark(item.productId, 'earring')}>
                {t('هذا قرط', 'It’s an earring')}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {failure && <ErrorNote error={failure} />}
    </Panel>
  );
}
