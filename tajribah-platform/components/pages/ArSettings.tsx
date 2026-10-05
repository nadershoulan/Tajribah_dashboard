'use client';

// MD-090 — AR settings per product

import { useWriteLock } from '@/components/dashboard/write-lock';
import { useState } from 'react';
import { Box, Copy, ExternalLink, Link2, Rotate3D, Search, Sparkles } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { ApiError } from '@/lib/api-client';
import { ArConfigInput, placementErrors, placementsFor, type ArConfigView, type Placement } from '@/lib/contracts/ar-config';
import { HostedPageInput, type HostedPageView } from '@/lib/contracts/hosted-page';
import { useData, useResource } from '@/lib/data';
import { formatDateTime, formatNumber } from '@/lib/format';
import { inArabic } from '@/lib/problem-text';
import { useLang } from '@/lib/i18n';
import type { Bi } from '@/lib/lang';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, PageSizePicker, Pagination, Panel } from '@/components/dashboard/ui';
import { DEFAULT_PAGE_SIZE, pageCount, rangeText, rowNumber, type PageSize } from '@/lib/pagination';
import { useDebounced } from '@/lib/use-debounced';

const PLACEMENT_LABEL: Record<Placement, Bi> = {
  floor: { ar: 'على الأرض', en: 'On the floor' },
  wall: { ar: 'على الجدار', en: 'On a wall' },
  table: { ar: 'على طاولة', en: 'On a table' },
  face: { ar: 'على الوجه', en: 'On the face' },
  wrist: { ar: 'على المعصم', en: 'On the wrist' },
};

/** Contract and server messages are English; the ones this screen meets get their Arabic here. */
const MESSAGE_AR: [RegExp, string][] = [
  [/needs a label/, 'الزر يحتاج نصًا'],
  [/at most 40/, '40 حرفًا على الأكثر'],
  [/between 0\.5/, 'بين 0.5 و 2'],
  [/between 0 and 2/, 'بين 0 و 2'],
  [/not for this kind of product/, 'لا يناسب هذا النوع من المنتجات'],
  [/missing permission: ar:write/, 'دورك لا يسمح بتغيير إعدادات العرض'],
  [/missing permission: ar:publish/, 'دورك لا يسمح بالنشر في المتجر'],
  [/nothing for the button to open/, 'لا يوجد ما يفتحه الزر بعد — اضبط تجربة المنتج أولًا (صورته ومقاسه).'],
  [/archived or deleted/, 'هذا المنتج مؤرشف أو محذوف.'],
  [/suspended or closed/, 'هذا المتجر موقوف أو مغلق.'],
  [/not make a valid config/, 'الإعدادات لا تكوّن عرضًا صالحًا — تواصل مع الدعم.'],
  [/is not published/, 'هذا المنتج غير منشور.'],
  [/a link starting with https/, 'رابط يبدأ بـ https:// لصفحة المنتج في متجرك'],
  [/plan does not include product pages/, 'باقتك لا تشمل صفحات المنتجات'],
];

export default function ArSettings() {
  const { t, lang } = useLang();
  const [version, setVersion] = useState(0);
  // T73: numbered pages and a search — products already set up come first.
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 250);
  const [perPage, setPerPage] = useState<PageSize>(DEFAULT_PAGE_SIZE); // T76
  const [paged, setPaged] = useState({ key: `${q}|${perPage}`, page: 1 });
  const page = paged.key === `${q}|${perPage}` ? paged.page : 1; // a new search or page size starts at page 1
  const { data: list, loading, error } = useResource((s) => s.arConfigs({ page, q: q || undefined, pageSize: perPage }), [version, page, q, perPage]);
  const data = list?.configs;
  const { data: settings } = useResource((s) => s.settings());
  const [selected, setSelected] = useState<string | null>(null);
  const current = data?.find((c) => c.productId === selected) ?? data?.[0] ?? null;
  const pages = list ? pageCount(list.total, list.pageSize) : 1;

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('إعدادات العرض', 'AR settings') },
  ];
  const name = (c: ArConfigView) => (lang === 'ar' ? c.productNameAr ?? c.productName : c.productName);

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('إعدادات العرض', 'AR settings')}
        lead={t(
          'نص الزر ومكان وضع المنتج وحركته، لكل منتج. اللون والاستدارة من إعدادات المتجر.',
          'The button text, where the product is placed and how it moves, per product. Colour and corners come from your store settings.',
        )}
      />
      {loading && !data && <Panel><Loading rows={4} /></Panel>}
      {error && <ErrorNote error={error} />}
      {data && data.length === 0 && !q && (
        <Empty icon={<Box size={22} />} title={t('لا توجد منتجات بعد', 'No products yet')}
          body={t('استورد منتجاتك أو أضف منتجًا، ثم اضبط عرضه هنا.', 'Import your products or add one, then set up its AR here.')}
          action={<AppLink href="/dashboard/products" className="btn btn-ghost">{t('المنتجات', 'Products')}</AppLink>} />
      )}
      {data && (current || q) && (
        <div className="ar-grid">
          <Panel flush title={t('المنتجات', 'Products')} sub={list ? rangeText(list.page, list.pageSize, data.length, list.total, lang) : undefined}>
            <div className="pick-tools">
            <label className="pick-search">
              <Search size={15} aria-hidden />
              <span className="sr-only">{t('ابحث في المنتجات', 'Search products')}</span>
              <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('ابحث بالاسم أو الرمز', 'Search by name or SKU')} />
            </label>
            <PageSizePicker id="ar-page-size" value={perPage} onChange={setPerPage} />
            </div>
            {data.length === 0 && <p className="hint" style={{ padding: '8px 16px 16px' }}>{t('لا منتجات بهذا البحث.', 'No products match this search.')}</p>}
            <ul className="pick-list">
              {data.map((c, index) => (
                <li key={c.productId}>
                  <button type="button" aria-current={c.productId === current?.productId ? 'true' : undefined} onClick={() => setSelected(c.productId)}>
                    <span className="pick-num">{formatNumber(rowNumber(list?.page ?? 1, list?.pageSize ?? perPage, index), lang)}</span>
                    <span className="pick-name">{name(c)}</span>
                    <span className="pick-meta">
                      {c.arEnabled ? <Badge tone="ok" dot>{t('العرض مفعّل', 'AR on')}</Badge> : <Badge>{t('العرض متوقف', 'AR off')}</Badge>}
                      {c.saved ? <Badge tone="accent">{t('مضبوط', 'Customised')}</Badge> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={list?.page ?? 1} pages={pages} onPage={(next) => setPaged({ key: `${q}|${perPage}`, page: next })} label={t('صفحات المنتجات', 'Product pages')} />
          </Panel>
          <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
            {current && <Editor key={`${current.productId}:${JSON.stringify(current)}`} config={current} name={name(current)}
              brandColor={settings?.brandColor ?? null} radius={settings?.buttonRadius ?? 12}
              onSaved={() => setVersion((v) => v + 1)} />}
            {current?.page && <ProductPage key={`page:${current.productId}:${JSON.stringify(current.page)}`} productId={current.productId} page={current.page}
              onSaved={() => setVersion((v) => v + 1)} />}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Editor({ config, name, brandColor, radius, onSaved }: {
  config: ArConfigView; name: string; brandColor: string | null; radius: number; onSaved: () => void;
}) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [form, setForm] = useState<ArConfigInput>({
    buttonLabelAr: config.buttonLabelAr, buttonLabelEn: config.buttonLabelEn, variant: config.variant, showIcon: config.showIcon,
    placement: config.placement, scale: config.scale, autoRotate: config.autoRotate, shadow: config.shadow,
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [removing, setRemoving] = useState<'ask' | 'busy' | null>(null);
  const lock = useWriteLock(); // T50: a read-only store or a staff view changes nothing
  const set = <K extends keyof ArConfigInput>(key: K) => (value: ArConfigInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const say = (m: string) => (lang === 'ar' ? MESSAGE_AR.find(([p]) => p.test(m))?.[1] ?? inArabic(m) : m);
  const err = (key: string) => errors[key]?.[0];

  const save = async () => {
    setFailure(null);
    const parsed = ArConfigInput.safeParse(form);
    const local: Record<string, string[]> = parsed.success ? placementErrors(config.productType, form.placement) : {};
    if (!parsed.success) for (const i of parsed.error.issues) (local[String(i.path[0])] ??= []).push(i.message);
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      await source.saveArConfig(config.productId, parsed.data!);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else setFailure(e as Error);
    } finally {
      setSaving(false);
    }
  };

  // Publishing sends what is saved; unsaved edits would not be in it, so save first.
  const dirty = (Object.keys(form) as (keyof ArConfigInput)[]).some((k) => form[k] !== config[k]);
  const publish = async () => {
    setRefusal(null);
    setPublishing(true);
    try {
      await source.publishArConfig(config.productId);
      onSaved();
    } catch (e) {
      setRefusal(say((e as Error).message));
    } finally {
      setPublishing(false);
    }
  };

  // T40: the merchant takes the product off the shop; nothing brings it back but publishing again.
  const remove = async () => {
    setRefusal(null);
    setRemoving('busy');
    try {
      await source.unpublishArConfig(config.productId);
      onSaved();
    } catch (e) {
      setRefusal(say((e as Error).message));
    } finally {
      setRemoving(null);
    }
  };

  const color = brandColor ?? 'var(--aqua)';
  const label = lang === 'ar' ? form.buttonLabelAr : form.buttonLabelEn;
  return (
    <Panel title={name} sub={t('يُطبَّق على صفحة هذا المنتج فقط', 'Applies to this product’s page only')}
      actions={<>
        {config.publishedVersion > 0
          ? <Badge tone="ok" dot>{t(`منشور · نسخة ${config.publishedVersion}`, `Live · version ${config.publishedVersion}`)}</Badge>
          : <Badge>{t('غير منشور', 'Not published')}</Badge>}
        {config.unpublishedChanges && (config.saved || config.publishedVersion > 0) ? <Badge tone="warn">{t('تغييرات غير منشورة', 'Unpublished changes')}</Badge> : null}
      </>}>
      <div className="button-preview" aria-hidden style={{ marginBottom: 16 }}>
        <span style={form.variant === 'solid'
          ? { background: color, borderRadius: radius }
          : { background: 'transparent', color, border: `2px solid ${color}`, borderRadius: radius }}>
          {form.showIcon && <Sparkles size={15} />}{label || '…'}
        </span>
      </div>

      <div className="brand-row">
        {(['buttonLabelAr', 'buttonLabelEn'] as const).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`ar-${key}`}>{key === 'buttonLabelAr' ? t('نص الزر بالعربية', 'Button text (Arabic)') : t('نص الزر بالإنجليزية', 'Button text (English)')}</label>
            <input id={`ar-${key}`} dir={key === 'buttonLabelEn' ? 'ltr' : 'rtl'} value={form[key]} onChange={(e) => set(key)(e.target.value)}
              aria-invalid={!!err(key)} maxLength={60} />
            {err(key) && <span className="field-error">{say(err(key)!)}</span>}
          </div>
        ))}
      </div>

      <div className="brand-row">
        <div className="field">
          <label htmlFor="ar-variant">{t('شكل الزر', 'Button style')}</label>
          <select id="ar-variant" value={form.variant} onChange={(e) => set('variant')(e.target.value as 'solid' | 'outline')}>
            <option value="solid">{t('ممتلئ', 'Filled')}</option>
            <option value="outline">{t('إطار فقط', 'Outline')}</option>
          </select>
        </div>
        <div className="field">
          <label className="toggle" style={{ marginTop: 26 }}>
            <input type="checkbox" checked={form.showIcon} onChange={(e) => set('showIcon')(e.target.checked)} />
            <span>{t('أيقونة في الزر', 'Icon on the button')}</span>
          </label>
        </div>
      </div>

      <fieldset className="field placement">
        <legend>{t('أين يوضع المنتج', 'Where the product goes')}</legend>
        <div className="placement-options">
          {placementsFor(config.productType).map((p) => (
            <label key={p} className={form.placement === p ? 'is-on' : undefined}>
              <input type="radio" name="placement" value={p} checked={form.placement === p} onChange={() => set('placement')(p)} />
              {pick(PLACEMENT_LABEL[p])}
            </label>
          ))}
        </div>
        {err('placement') && <span className="field-error">{say(err('placement')!)}</span>}
      </fieldset>

      <div className="brand-row">
        <div className="field">
          <label htmlFor="ar-scale">{t('تصحيح الحجم', 'Size correction')} <span className="num">{form.scale.toFixed(2)}×</span></label>
          <input id="ar-scale" type="range" min={0.5} max={2} step={0.05} value={form.scale} onChange={(e) => set('scale')(Number(e.target.value))} />
          <span className="field-hint">{t('1× هو المقاس الحقيقي من المليمترات. غيّره فقط إن كان النموذج نفسه بمقياس خاطئ.', '1× is the true size from the millimetres. Change it only if the model itself is at the wrong scale.')}</span>
        </div>
        <div className="field">
          <label htmlFor="ar-shadow">{t('قوة الظل', 'Shadow strength')} <span className="num">{form.shadow.toFixed(1)}</span></label>
          <input id="ar-shadow" type="range" min={0} max={2} step={0.1} value={form.shadow} onChange={(e) => set('shadow')(Number(e.target.value))} />
        </div>
      </div>
      <label className="toggle" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={form.autoRotate} onChange={(e) => set('autoRotate')(e.target.checked)} />
        <span><Rotate3D size={14} aria-hidden /> {t('يدور المنتج تلقائيًا في المعاينة', 'The product turns slowly in the preview')}</span>
      </label>

      {config.tryon && !config.tryon.ready && config.publishedVersion === 0 && (
        <div className="next-step">
          <span>{t('قبل النشر: جهّز تجربة هذا المنتج — صورته بلا خلفية ومقاسه. ثم انشره من هناك بنقرة.', 'Before publishing: set up this product’s try-on — its picture without a background and its size. Then publish it from there in one click.')}</span>
          <AppLink href={`/dashboard/tryon/${encodeURIComponent(config.productId)}`} className="btn btn-primary btn-sm">{t('اضبط التجربة', 'Set up the try-on')}</AppLink>
        </div>
      )}
      {failure && <ErrorNote error={failure} />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || lock.locked} title={lock.title}>{saving ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ', 'Save')}</button>
        <button type="button" className="btn btn-ghost" onClick={publish} disabled={publishing || saving || dirty || lock.locked}
          title={lock.title ?? (dirty ? t('احفظ أولًا', 'Save first') : undefined)}>
          {publishing ? t('جارٍ النشر…', 'Publishing…') : t('انشر في المتجر', 'Publish to the store')}
        </button>
        {config.publishedVersion > 0 && !removing && (
          <button type="button" className="btn btn-quiet" onClick={() => setRemoving('ask')} disabled={publishing || saving || lock.locked} title={lock.title}>{t('أزِله من المتجر', 'Remove from the store')}</button>
        )}
      </div>
      {removing && (
        <div className="confirm" role="alertdialog" aria-labelledby="ar-remove" style={{ marginTop: 12 }}>
          <p id="ar-remove" style={{ margin: 0 }}>
            <strong>{t('إزالة الزر من صفحة هذا المنتج؟', 'Remove the button from this product’s page?')}</strong>{' '}
            {t('يختفي خلال دقيقة تقريبًا. إعداداته تبقى هنا، ويمكنك نشره من جديد متى شئت.', 'It disappears within about a minute. Its settings stay here, and you can publish it again whenever you like.')}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={removing === 'busy'}>
              {removing === 'busy' ? t('جارٍ الإزالة…', 'Removing…') : t('نعم، أزِله', 'Yes, remove it')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(null)} disabled={removing === 'busy'}>{t('إلغاء', 'Cancel')}</button>
          </div>
        </div>
      )}
      {refusal && <p className="field-error" role="alert" style={{ marginTop: 10 }}>{refusal}</p>}
      {refusal && /تجربة المنتج|try-on/.test(refusal) && <AppLink href={`/dashboard/tryon/${encodeURIComponent(config.productId)}`} className="btn btn-primary btn-sm" style={{ marginTop: 6 }}>{t('اضبط التجربة', 'Set up the try-on')}</AppLink>}
      <p className="hint">{config.publishedAt
        ? t(`آخر نشر ${formatDateTime(config.publishedAt, 'ar')}. `, `Last published ${formatDateTime(config.publishedAt, 'en')}. `)
        : null}{t(
        'الحفظ يحفظ الإعدادات هنا. النشر يضعها في صفحة المنتج في متجرك مع تجربته، ويراها المتسوّقون خلال دقيقة تقريبًا.',
        'Saving keeps the settings here. Publishing puts them on the product’s page in your store with its try-on; shoppers see it within about a minute.',
      )}</p>
    </Panel>
  );
}

/**
 * P1.19 — the product's own page: one link a merchant can share anywhere (a post, a message, a bio),
 * showing the product in 3D with "view in your space", and a watch in the try-on. It exists while the
 * product is published; here it can be switched off, and given the link to buy it in the shop.
 */
function ProductPage({ productId, page, onSaved }: { productId: string; page: HostedPageView; onSaved: () => void }) {
  const { t, lang } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const [active, setActive] = useState(page.active);
  const [shopUrl, setShopUrl] = useState(page.shopUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const say = (m: string) => (lang === 'ar' ? MESSAGE_AR.find(([p]) => p.test(m))?.[1] ?? inArabic(m) : m);
  const dirty = active !== page.active || (shopUrl.trim() || null) !== page.shopUrl;

  const save = async () => {
    setProblem(null);
    const parsed = HostedPageInput.safeParse({ active, shopUrl });
    if (!parsed.success) { setProblem(say(parsed.error.issues[0]!.message)); return; }
    setSaving(true);
    try {
      await source.saveHostedPage(productId, parsed.data);
      onSaved();
    } catch (e) {
      setProblem(say((e as ApiError).fields?.shopUrl?.[0] ?? (e as Error).message));
    } finally {
      setSaving(false);
    }
  };
  const copy = async () => {
    if (!page.url) return;
    try { await navigator.clipboard.writeText(page.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the link can still be selected */ }
  };

  return (
    <Panel title={t('صفحة المنتج', 'Product page')} sub={t('رابط واحد تشاركه في أي مكان', 'One link to share anywhere')}
      actions={!page.url ? <Badge>{t('بعد النشر', 'After publishing')}</Badge>
        : page.active ? <Badge tone="ok" dot>{t('متاحة', 'Live')}</Badge> : <Badge>{t('متوقفة', 'Off')}</Badge>}>
      <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-2)' }}>{t(
        'صفحة خاصة بهذا المنتج يفتحها أي أحد من رابط: يراه بأبعاده الثلاثية ويضعه في مكانه، ويجرّب الساعة على المعصم. شاركها في منشور أو رسالة أو في حسابك.',
        'A page of its own for this product, opened from a link: anyone can see it in 3D, place it in their space, and try a watch on the wrist. Share it in a post, a message or your profile.',
      )}</p>
      {page.url ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 100%', minWidth: 0 }}>
            <Link2 size={16} aria-hidden style={{ color: 'var(--text-3)', flex: 'none' }} />
            <code dir="ltr" style={{ wordBreak: 'break-all', opacity: page.active ? 1 : 0.55 }}>{page.url}</code>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()} disabled={!page.active}>
            <Copy size={14} aria-hidden />{copied ? t('نُسخ', 'Copied') : t('انسخ الرابط', 'Copy link')}
          </button>
          {page.active && (
            <a className="btn btn-ghost btn-sm" href={page.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} aria-hidden />{t('افتح', 'Open')}
            </a>
          )}
        </div>
      ) : (
        <p className="hint" style={{ marginTop: 0 }}>{t('يظهر رابط الصفحة بعد نشر المنتج في المتجر.', 'The page’s link appears once the product is published to the store.')}</p>
      )}
      <label className="toggle" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>{t('الصفحة متاحة لمن معه الرابط', 'Anyone with the link can open the page')}</span>
      </label>
      <div className="field">
        <label htmlFor={`page-shop-${productId}`}>{t('رابط شراء المنتج في متجرك (اختياري)', 'Link to buy it in your shop (optional)')}</label>
        <input id={`page-shop-${productId}`} dir="ltr" type="url" inputMode="url" placeholder="https://" value={shopUrl}
          onChange={(e) => setShopUrl(e.target.value)} maxLength={2048} aria-invalid={!!problem} />
        <span className="field-hint">{t('يظهر في الصفحة زرًا يأخذ المتسوّق إلى المنتج في متجرك.', 'Shown on the page as a button that takes the shopper to the product in your shop.')}</span>
      </div>
      {problem && <p className="field-error" role="alert">{problem}</p>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty || lock.locked} title={lock.title}>
          {saving ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ', 'Save')}
        </button>
        <span className="hint" style={{ margin: 0 }}>{t('يصل التغيير إلى الصفحة خلال دقيقة تقريبًا.', 'Changes reach the page within about a minute.')}</span>
      </div>
    </Panel>
  );
}
