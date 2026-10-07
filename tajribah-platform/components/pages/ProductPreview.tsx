'use client';

// T79 — a product as a shopper sees it, from what its store gives: its pictures, name, price, category
// and size. No 3D model and no publishing needed; the 3D view and the try-on show what they still need.
// T85 — and the try-on itself, the studio exactly as it opens over the shop, from the product's drafts:
// tried as any kind, its cut-out or else its store picture, its size or else the example's.

import { useEffect, useRef, useState } from 'react';
import { clearStorePicture } from '@/lib/clear-picture';
import { useWriteLock } from '@/components/dashboard/write-lock';
import { ArrowRight, Box, Eraser, ExternalLink, ImageOff, Package, Ruler, Sparkles } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useData, useResource } from '@/lib/data';
import { formatMoney } from '@/lib/money';
import { useLang } from '@/lib/i18n';
import { isSized } from '@/lib/product-list';
import { kindOf, type TryOnKind } from '@/lib/tryon';
import type { ProductRow, TryOnPreview } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';
import { PREVIEW_CONFIG, PREVIEW_HEIGHT, PREVIEW_READY } from '@site/lib/tryon-config';

const TYPE_LABEL: Record<ProductRow['productType'], { ar: string; en: string }> = {
  watch: { ar: 'ساعة', en: 'Watch' },
  jewelry: { ar: 'مجوهرات', en: 'Jewelry' },
  eyewear: { ar: 'نظارات', en: 'Eyewear' },
  bag: { ar: 'حقيبة', en: 'Bag' },
  apparel: { ar: 'ملابس', en: 'Apparel' },
  furniture: { ar: 'أثاث', en: 'Furniture' },
  other: { ar: 'أخرى', en: 'Other' },
};

/** The product's id: `/dashboard/products/{id}/preview`. */
export const previewId = (path: string): string => decodeURIComponent(path.split('/').filter(Boolean).at(-2) ?? '');

export default function ProductPreview() {
  const { t, lang } = useLang();
  const { path } = useEnv();
  const id = previewId(path);
  const { data: product, loading, error } = useResource((source) => source.product(id), [id]);
  const title = product ? (lang === 'ar' ? (product.nameAr ?? product.name) : product.name) : t('المنتج', 'Product');
  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('المنتجات', 'Products'), href: '/dashboard/products' },
    { label: title, href: `/dashboard/products/${encodeURIComponent(id)}` },
    { label: t('معاينة', 'Preview') },
  ];

  return (
    <Shell tenant={null} crumbs={crumbs}>
      {loading && <Loading rows={5} />}
      {error && <ErrorNote error={error} />}
      {!loading && !error && !product && (
        <Empty icon={<Package size={22} />} title={t('المنتج غير موجود', 'Product not found')}
          body={t('ربما حُذف، أو أنه يتبع متجرًا آخر.', 'It may have been deleted, or it belongs to another store.')}
          action={<AppLink href="/dashboard/products" className="btn btn-ghost">{t('كل المنتجات', 'All products')}</AppLink>} />
      )}
      {product && <Preview product={product} title={title} />}
    </Shell>
  );
}

function Preview({ product, title }: { product: ProductRow; title: string }) {
  const { t, pick, lang } = useLang();
  const pictures = product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : [];
  const [shown, setShown] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const main = pictures[Math.min(shown, pictures.length - 1)];
  const kind = kindOf(product.productType);
  const d = product.dimensions;

  return (
    <>
      <div className="preview-note">
        <span>{t('هكذا يرى المتسوّق هذا المنتج، من صوره وبياناته في متجرك.', 'This is how a shopper sees this product, from its pictures and details in your store.')}</span>
        <AppLink href={`/dashboard/products/${encodeURIComponent(product.id)}`} className="btn btn-ghost btn-sm">
          {t('إعدادات المنتج', 'Product settings')}<ArrowRight size={14} aria-hidden className="flip-rtl" />
        </AppLink>
      </div>
      <div className="preview-grid">
        <div className="preview-gallery">
          <div className="preview-main">
            {main && !broken.has(main)
              ? <img src={main} alt={title} referrerPolicy="no-referrer" onError={() => setBroken((b) => new Set(b).add(main))} />
              : <span className="preview-empty"><ImageOff size={28} aria-hidden />{t('لا صورة لهذا المنتج في متجرك', 'Your store gives no picture for this product')}</span>}
          </div>
          {pictures.length > 1 && (
            <ul className="preview-thumbs" aria-label={t('صور المنتج', 'Product pictures')}>
              {pictures.map((src, i) => (
                <li key={src}>
                  <button type="button" aria-current={i === shown ? 'true' : undefined} onClick={() => setShown(i)}
                    aria-label={t(`الصورة ${i + 1} من ${pictures.length}`, `Picture ${i + 1} of ${pictures.length}`)}>
                    {broken.has(src) ? <ImageOff size={16} aria-hidden /> : <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken((b) => new Set(b).add(src))} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="preview-info">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {product.category && <Badge tone="accent">{product.category.name}</Badge>}
            <Badge>{pick(TYPE_LABEL[product.productType])}</Badge>
          </div>
          <h1 className="preview-title">{title}</h1>
          {product.priceMinor != null && <p className="preview-price num">{formatMoney(product.priceMinor, product.currency, lang)}</p>}
          <p className="preview-size">
            <Ruler size={15} aria-hidden />
            {isSized(product) && d
              ? t(`المقاس: ${[d.widthMm, d.heightMm, d.depthMm].filter(Boolean).join(' × ')} مم`, `Size: ${[d.widthMm, d.heightMm, d.depthMm].filter(Boolean).join(' × ')} mm`)
              : t('المقاس غير مضاف بعد — المتسوّق يرى الصور فقط.', 'No size yet — the shopper sees the pictures only.')}
          </p>
          {product.description && <p className="preview-description" tabIndex={0} role="region" aria-label={t('وصف المنتج', 'The product’s description')}>{product.description}</p>}
          {/* T96: the real page in the store, where the button shows once it is installed */}
          {product.pageUrl && <p style={{ margin: '0 0 12px' }}><a href={product.pageUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm"><ExternalLink size={14} aria-hidden />{t('صفحته في متجرك', 'Its page in your store')}</a></p>}

          <Panel title={t('ما يفتحه الزر في متجرك', 'What the button opens in your shop')}>
            <ul className="preview-steps">
              <li>
                <Box size={16} aria-hidden />
                <span>{product.modelStatus === 'ready'
                  ? t('عرض ثلاثي الأبعاد: النموذج جاهز.', '3D view: the model is ready.')
                  : t('عرض ثلاثي الأبعاد: يظهر حين يُضاف نموذج لهذا المنتج.', '3D view: shows once this product has a model.')}</span>
              </li>
              {kind && (
                <li>
                  <Sparkles size={16} aria-hidden />
                  <span>{product.tryonEnabled
                    ? t('التجربة الافتراضية مفعّلة.', 'The try-on is on.')
                    : t('التجربة الافتراضية: تحتاج صورة مقصوصة للمنتج ومقاسه.', 'The try-on: needs a cut-out picture of the product and its size.')}</span>
                  {!product.tryonEnabled && <AppLink href={`/dashboard/tryon/${encodeURIComponent(product.id)}`} className="btn btn-ghost btn-sm">{t('اضبط التجربة', 'Set up the try-on')}</AppLink>}
                </li>
              )}
            </ul>
            {product.live && <p className="hint" style={{ marginBottom: 0 }}><Badge tone="ok" dot>{t('في المتجر', 'Live')}</Badge> {t('الزر منشور في متجرك.', 'The button is published in your shop.')}</p>}
          </Panel>
        </div>
      </div>
      <TryItOn product={product} />
    </>
  );
}

const KIND_LABEL: Record<TryOnKind, { ar: string; en: string }> = {
  watch: { ar: 'ساعة', en: 'Watch' }, glasses: { ar: 'نظارة', en: 'Glasses' }, ring: { ar: 'خاتم', en: 'Ring' },
  necklace: { ar: 'قلادة', en: 'Necklace' }, earring: { ar: 'قرط', en: 'Earring' }, bag: { ar: 'حقيبة', en: 'Bag' },
};
const KINDS = Object.keys(KIND_LABEL) as TryOnKind[];

/** T85 — the shopper's try-on, in a frame: the same page the shop opens, reading this product's drafts. */
function TryItOn({ product }: { product: ProductRow }) {
  const { t, pick, lang } = useLang();
  const [as, setAs] = useState<TryOnKind | null>(null);
  const [version, setVersion] = useState(0); // T88: a new cut-out saved — read the preview again
  const { data, loading, error } = useResource((source) => source.tryOnPreview(product.id, as), [product.id, as, version]);
  const kind = data?.kind ?? null;
  const frame = data?.config && kind ? `/embed/try-on?preview=1&lang=${lang}` : null;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const config = data?.config ?? null;
  const configKey = config ? JSON.stringify(config) : '';
  const [measured, setMeasured] = useState<{ key: string; height: number } | null>(null);
  const height = measured?.key === configKey ? measured.height : null; // a new frame measures itself again
  // The frame asks once it is listening; the settings go only to it, on this same address. T87: it then
  // says its height, and the page gives it all of it — the studio reads as part of the page.
  useEffect(() => {
    if (!config) return;
    const onMessage = (event: MessageEvent) => {
      const target = frameRef.current?.contentWindow;
      if (!target || event.source !== target || event.origin !== location.origin) return;
      const message = event.data as { type?: unknown; height?: unknown } | null;
      if (message?.type === PREVIEW_HEIGHT && typeof message.height === 'number' && message.height > 0) setMeasured({ key: configKey, height: Math.min(message.height, 4000) });
      if (message?.type !== PREVIEW_READY) return;
      target.postMessage({ type: PREVIEW_CONFIG, config }, location.origin);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [config, configKey]);

  return (
    <Panel title={t('جرّبه كما يراه المتسوّق', 'Try it on, as a shopper does')}>
      <div className="preview-tryon-kinds" role="group" aria-label={t('جرّبه كـ', 'Try it as')}>
        <span className="hint" style={{ margin: 0 }}>{t('جرّبه كـ', 'Try it as')}</span>
        {KINDS.map((k) => (
          <button key={k} type="button" className={'btn btn-sm ' + (kind === k ? 'btn-primary' : 'btn-ghost')} aria-pressed={kind === k} onClick={() => setAs(k)}>
            {pick(KIND_LABEL[k])}
          </button>
        ))}
      </div>
      {loading && <Loading rows={2} />}
      {error && <ErrorNote error={error} />}
      {data && <PreviewNotes data={data} productId={product.id} />}
      {data?.picture === 'store' && data.kind && data.config && <ClearBackground product={product} kind={data.kind} own={data.own} url={String(data.config.tryon.worn)} onSaved={() => setVersion((v) => v + 1)} />}
      {frame
        ? <iframe key={configKey} ref={frameRef} src={frame} title={t('التجربة الافتراضية', 'The virtual try-on')} className={'preview-tryon-frame' + (height ? ' is-ready' : '')} style={height ? { height } : undefined} scrolling="no" allow="camera" />
        : data && kind && (
          <p className="hint" style={{ marginBottom: 0 }}>{data.picture === null && !data.config
            ? t('لا صورة لهذا المنتج نجرّبها: أضف صورة في متجرك أو صورة مقصوصة في إعدادات التجربة.', 'No picture to try this product on: add one in your store, or a cut-out in the try-on settings.')
            : t('المعاينة تعمل حين تكون متصلًا بالخادم.', 'The preview works when connected to the server.')}</p>
        )}
      {data && !kind && <p className="hint" style={{ marginBottom: 0 }}>{t('اختر ما تجرّبه كـ أعلاه. سوار؟ جرّبه كـ «ساعة»: يوضع على المعصم.', 'Choose what to try it as, above. A bracelet? Try it as a “Watch”: it goes on the wrist.')}</p>}
    </Panel>
  );
}

const TYPE_OF: Record<TryOnKind, ProductRow['productType']> = { watch: 'watch', glasses: 'eyewear', bag: 'bag', ring: 'jewelry', necklace: 'jewelry', earring: 'jewelry' };

/**
 * T88 — one click: the store picture's plain background taken off here, in the browser
 * (`lib/background.ts`), and the result saved as this product's try-on picture through the same upload
 * and checks as a cut-out made by hand. A product of another type is first set up as what it is being
 * tried as — the button says so.
 */
function ClearBackground({ product, kind, own, url, onSaved }: { product: ProductRow; kind: TryOnKind; own: TryOnKind | null; url: string; onSaved: () => void }) {
  const { t, pick } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const retypes = own !== kind;
  const run = async () => {
    setBusy(true); setFailure(null); setRefusal(null);
    try {
      const cleared = await clearStorePicture(await source.storePhoto(product.id, url));
      if (!cleared.ok) { setRefusal(pick(cleared.reason)); return; }
      // set up as what it is tried as, then the picture (a watch takes it as both of its pictures)
      if (product.productType !== TYPE_OF[kind]) await source.updateProduct(product.id, { productType: TYPE_OF[kind] });
      if (TYPE_OF[kind] === 'jewelry' && own !== kind) await source.updateTryOn(product.id, { jewelry: kind as 'ring' | 'necklace' | 'earring' });
      const file = cleared.file;
      await source.uploadCutout(product.id, 'worn', file);
      if (kind === 'watch') await source.uploadCutout(product.id, 'flat', file);
      onSaved();
    } catch (e) {
      setFailure(e as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="preview-clear">
      <button type="button" className="btn btn-primary btn-sm" disabled={busy || lock.locked} onClick={() => void run()}>
        <Eraser size={15} aria-hidden />{busy ? t('نزيل الخلفية…', 'Taking the background off…') : t('أزل الخلفية واحفظها', 'Remove the background and save it')}
      </button>
      <span className="hint" style={{ margin: 0 }}>{retypes
        ? t(`يُحفظ صورةً للتجربة، ويصبح نوعه «${pick(KIND_LABEL[kind])}».`, `Saved as its try-on picture, and its type becomes “${pick(KIND_LABEL[kind])}”.`)
        : t('يُحفظ صورةً للتجربة. يعمل حين تكون الخلفية بلون واحد، كالأبيض.', 'Saved as its try-on picture. Works when the background is one plain colour, such as white.')}</span>
      {refusal && <p className="hint" role="alert" style={{ margin: 0, color: 'var(--bad)' }}>{refusal}</p>}
      {failure && <ErrorNote error={failure} />}
    </div>
  );
}

function PreviewNotes({ data, productId }: { data: TryOnPreview; productId: string }) {
  const { t, pick } = useLang();
  const notes: string[] = [];
  if (data.guessed && data.kind) notes.push(t(`اخترنا «${pick(KIND_LABEL[data.kind])}» من تصنيفه أو اسمه — غيّره أعلاه إن لم يكن كذلك.`, `We chose “${pick(KIND_LABEL[data.kind])}” from its category or name — change it above if that is wrong.`));
  if (data.picture === 'store') notes.push(t('نستخدم صورة المتجر كما هي، فتظهر خلفيتها. صورة مقصوصة بخلفية شفافة تجعله يبدو ملبوسًا.', 'We use the store picture as it is, so its background shows. A cut-out on a transparent background makes it look worn.'));
  if (data.size?.from === 'example') notes.push(t(`لا مقاس له بعد: نعرضه بمقاس منتج المثال (${data.size.mm} مم). أضف مقاسه الحقيقي في إعدادات التجربة.`, `It has no size yet: shown at the example product's size (${data.size.mm} mm). Add its real size in the try-on settings.`));
  if (data.size?.from === 'product') notes.push(t(`بمقاسه من بيانات المنتج: ${data.size.mm} مم.`, `At its size from the product's details: ${data.size.mm} mm.`));
  if (!data.onMe) notes.push(t('«عليّ» (صورة المتسوّق) متاحة في الباقة الاحترافية وما فوق.', '“On me” (the shopper’s own photo) is on the Pro plan and up.'));
  if (!notes.length) return null;
  return (
    <ul className="preview-tryon-notes">
      {notes.map((n) => <li key={n}>{n}</li>)}
      {(data.picture === 'store' || data.size?.from === 'example') && (
        <li><AppLink href={`/dashboard/tryon/${encodeURIComponent(productId)}`} className="btn btn-primary btn-sm">{t('اضبط التجربة وانشرها', 'Set up the try-on and publish')}</AppLink></li>
      )}
    </ul>
  );
}
