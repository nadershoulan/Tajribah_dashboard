'use client';

// T79 — a product as a shopper sees it, from what its store gives: its pictures, name, price, category
// and size. No 3D model and no publishing needed; the 3D view and the try-on show what they still need.

import { useState } from 'react';
import { ArrowRight, Box, ImageOff, Package, Ruler, Sparkles } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useResource } from '@/lib/data';
import { formatMoney } from '@/lib/money';
import { useLang } from '@/lib/i18n';
import { isSized } from '@/lib/product-list';
import { kindOf } from '@/lib/tryon';
import type { ProductRow } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

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
          {product.description && <p className="preview-description">{product.description}</p>}

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
                  {!product.tryonEnabled && <AppLink href="/dashboard/tryon" className="btn btn-ghost btn-sm">{t('اضبط التجربة', 'Set up the try-on')}</AppLink>}
                </li>
              )}
            </ul>
            {product.live && <p className="hint" style={{ marginBottom: 0 }}><Badge tone="ok" dot>{t('في المتجر', 'Live')}</Badge> {t('الزر منشور في متجرك.', 'The button is published in your shop.')}</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
