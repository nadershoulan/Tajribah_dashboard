'use client';

// MD-011 — Product detail: sizes in millimetres, AR switch, 3D model; P3.7 — photos for 3D generation

import { useWriteLock } from '@/components/dashboard/write-lock';
import { useState } from 'react';
import { Box, Package, Ruler } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { ApiError } from '@/lib/api-client';
import { useData, useResource } from '@/lib/data';
import { formatRelative } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { useLang } from '@/lib/i18n';
import { editErrors, parseMm, type FieldErrors, type ProductEdit } from '@/lib/product-edit';
import { isSized } from '@/lib/product-list';
import type { ProductRow } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Forward, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import ProductPhotos from '@/components/pages/ProductPhotos';
import ProfessionalPanel from '@/components/pages/ProfessionalPanel';
import RelatedPanel from '@/components/pages/RelatedPanel';

const TYPES: { value: ProductRow['productType']; ar: string; en: string }[] = [
  { value: 'watch', ar: 'ساعة', en: 'Watch' },
  { value: 'jewelry', ar: 'مجوهرات', en: 'Jewellery' },
  { value: 'eyewear', ar: 'نظارات', en: 'Eyewear' },
  { value: 'bag', ar: 'حقيبة', en: 'Bag' },
  { value: 'apparel', ar: 'ملابس', en: 'Apparel' },
  { value: 'furniture', ar: 'أثاث', en: 'Furniture' },
  { value: 'other', ar: 'أخرى', en: 'Other' },
];

/** Server and client messages are English; these are the ones a merchant meets here. */
const MESSAGE_AR: Record<string, string> = {
  'must be more than 0': 'يجب أن يكون أكبر من 0',
  'is over 3 metres — check the unit (mm)': 'أكثر من 3 أمتار — تأكد أن الوحدة مليمتر',
  'numbers only, in millimetres': 'أرقام فقط، بالمليمتر',
  'needs the width and height in millimetres first — AR shows the real size': 'أدخل العرض والارتفاع بالمليمتر أولًا — العرض يُظهر المقاس الحقيقي',
};

export default function ProductDetail() {
  const { t, lang } = useLang();
  const { path } = useEnv();
  const id = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
  const { data, loading, error } = useResource((source) => source.product(id), [id]);
  const [saved, setSaved] = useState<ProductRow | null>(null);
  const product = saved?.id === id ? saved : data;

  const title = product ? (lang === 'ar' ? (product.nameAr ?? product.name) : product.name) : t('المنتج', 'Product');
  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('المنتجات', 'Products'), href: '/dashboard/products' },
    { label: title },
  ];

  return (
    <Shell tenant={null} crumbs={crumbs}>
      {loading && <Loading rows={5} />}
      {error && <ErrorNote error={error} />}
      {!loading && !error && !product && (
        <Empty
          icon={<Package size={22} />}
          title={t('المنتج غير موجود', 'Product not found')}
          body={t('ربما حُذف، أو أنه يتبع متجرًا آخر.', 'It may have been deleted, or it belongs to another store.')}
          action={<AppLink href="/dashboard/products" className="btn btn-ghost">{t('كل المنتجات', 'All products')}</AppLink>}
        />
      )}
      {product && (
        <>
          <PageHead
            title={title}
            lead={product.sku ? `${t('الرمز', 'SKU')} ${product.sku}` : undefined}
          />
          <div className="detail-grid">
            <Editor key={`${product.id}:${product.updatedAt}`} product={product} onSaved={setSaved} wasSaved={saved?.id === id} />
            <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <StorePanel product={product} />
              <ModelPanel product={product} />
              <ProfessionalPanel product={product} />
              <RelatedPanel productId={product.id} />
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <ProductPhotos product={product} />
          </div>
        </>
      )}
    </Shell>
  );
}

/** Re-keyed after each save, so it starts from the saved values; `wasSaved` carries the confirmation across. */
function Editor({ product, onSaved, wasSaved }: { product: ProductRow; onSaved: (row: ProductRow) => void; wasSaved: boolean }) {
  const { t, pick, lang } = useLang();
  const lock = useWriteLock(); // T50: a read-only store or a staff view changes nothing
  const source = useData();
  const d = product.dimensions ?? {};
  const [width, setWidth] = useState(d.widthMm?.toString() ?? '');
  const [height, setHeight] = useState(d.heightMm?.toString() ?? '');
  const [depth, setDepth] = useState(d.depthMm?.toString() ?? '');
  const [type, setType] = useState(product.productType);
  const [arOn, setArOn] = useState(product.arEnabled);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [justSaved, setJustSaved] = useState(wasSaved);

  const say = (message: string) => (lang === 'ar' ? MESSAGE_AR[message] ?? message : message);
  const fieldError = (key: string) => errors[key]?.[0];
  /** Any change after a save means the confirmation no longer describes the form. */
  const touched = <T,>(set: (v: T) => void) => (v: T) => { setJustSaved(false); set(v); };

  const save = async () => {
    setFailure(null);
    setJustSaved(false);
    const parsed = { widthMm: parseMm(width), heightMm: parseMm(height), depthMm: parseMm(depth) };
    const local: FieldErrors = {};
    const dimensions: Record<string, number> = { ...(d.caseMm ? { caseMm: d.caseMm } : {}) };
    for (const [key, result] of Object.entries(parsed)) {
      if ('error' in result) local[`dimensions.${key}`] = [result.error];
      else if (result.value !== null) dimensions[key] = result.value;
    }
    const edit: ProductEdit = {
      dimensions: Object.keys(dimensions).length ? dimensions : null,
      arEnabled: arOn,
      productType: type,
    };
    const all = { ...local, ...editErrors(product, edit) };
    setErrors(all);
    if (Object.keys(all).length) return;

    setSaving(true);
    try {
      const row = await source.updateProduct(product.id, edit);
      onSaved(row); // re-keys this editor with the saved values; `wasSaved` shows the confirmation
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else setFailure(error as Error);
    } finally {
      setSaving(false);
    }
  };

  const mmField = (key: 'widthMm' | 'heightMm' | 'depthMm', label: string, value: string, set: (v: string) => void, required: boolean) => {
    const message = fieldError(`dimensions.${key}`);
    return (
      <div className="field">
        <label htmlFor={`mm-${key}`}>
          {label}{required && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · {t('مطلوب للعرض', 'needed for AR')}</span>}
        </label>
        <div className="input-unit">
          <input
            id={`mm-${key}`} inputMode="decimal" dir="ltr" value={value}
            aria-invalid={!!message} aria-describedby={message ? `mm-${key}-error` : undefined}
            onChange={(e) => touched(set)(e.target.value)}
          />
          <span aria-hidden>{t('مم', 'mm')}</span>
        </div>
        {message && <span id={`mm-${key}-error`} className="field-error">{say(message)}</span>}
      </div>
    );
  };

  const arMessage = fieldError('arEnabled');
  return (
    <Panel title={t('المقاس والعرض', 'Size and AR')} sub={t('بالمليمتر، كما تقيسه أنت', 'In millimetres, as you measure it')}>
      <div className="mm-grid">
        {mmField('widthMm', t('العرض', 'Width'), width, setWidth, true)}
        {mmField('heightMm', t('الارتفاع', 'Height'), height, setHeight, true)}
        {mmField('depthMm', t('العمق', 'Depth'), depth, setDepth, false)}
      </div>
      <div className="field">
        <label htmlFor="product-type">{t('النوع', 'Type')}</label>
        <select id="product-type" value={type} onChange={(e) => touched(setType)(e.target.value as ProductRow['productType'])}>
          {TYPES.map((option) => <option key={option.value} value={option.value}>{pick(option)}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="toggle">
          <input type="checkbox" role="switch" checked={arOn} onChange={(e) => touched(setArOn)(e.target.checked)}
            aria-invalid={!!arMessage} aria-describedby={arMessage ? 'ar-error' : 'ar-hint'} />
          <span>{t('العرض ثلاثي الأبعاد في المتجر', 'AR on the storefront')}</span>
        </label>
        {arMessage
          ? <span id="ar-error" className="field-error">{say(arMessage)}</span>
          : <span id="ar-hint" className="field-hint">{t('يتيح نشر نموذجه في صفحة المنتج من «إعدادات العرض».', 'Lets its 3D model be published to the product page from AR settings.')}{' '}
            {product.live ? <Badge tone="ok" dot>{t('في المتجر الآن', 'Live on your shop')}</Badge> : null}</span>}
      </div>
      {failure && <ErrorNote error={failure} />}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || lock.locked} title={lock.title}>
          {saving ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ', 'Save')}
        </button>
        {justSaved && <span role="status" className="hint" style={{ margin: 0 }}>{t('حُفظ', 'Saved')}</span>}
      </div>
    </Panel>
  );
}

function StorePanel({ product }: { product: ProductRow }) {
  const { t, lang } = useLang();
  return (
    <Panel title={t('من متجرك', 'From your store')} sub={t('يتغير في متجرك ويُزامن هنا', 'Change these in your store; they sync here')}>
      <dl className="facts">
        <dt>{t('الاسم', 'Name')}</dt><dd>{lang === 'ar' ? (product.nameAr ?? product.name) : product.name}</dd>
        <dt>{t('التصنيف', 'Category')}</dt><dd>{product.category ? (
          <AppLink href={`/dashboard/products?category=${product.category.id}`}>{product.category.name}</AppLink>
        ) : '—'}</dd>
        <dt>{t('السعر', 'Price')}</dt><dd className="num">{product.priceMinor == null ? '—' : formatMoney(product.priceMinor, product.currency, lang)}</dd>
        <dt>{t('آخر تحديث', 'Updated')}</dt><dd>{formatRelative(product.updatedAt, lang)}</dd>
      </dl>
    </Panel>
  );
}

function ModelPanel({ product }: { product: ProductRow }) {
  const { t } = useLang();
  const status = {
    ready: <Badge tone="ok">{t('جاهز', 'Ready')}</Badge>,
    processing: <Badge tone="accent">{t('قيد المعالجة', 'Processing')}</Badge>,
    failed: <Badge tone="bad">{t('فشل', 'Failed')}</Badge>,
    none: <Badge>{t('لا يوجد', 'None')}</Badge>,
  }[product.modelStatus];
  return (
    <Panel title={t('النموذج ثلاثي الأبعاد', '3D model')} actions={status}>
      {!isSized(product) && (
        <p className="hint" style={{ marginTop: 0, display: 'flex', gap: 6 }}>
          <Ruler size={15} aria-hidden />{t('أضف العرض والارتفاع ليظهر النموذج بمقاسه الحقيقي.', 'Add width and height so the model shows at its real size.')}
        </p>
      )}
      <AppLink href="/dashboard/models" className="btn btn-ghost">
        <Box size={16} aria-hidden />
        {product.modelStatus === 'none' ? t('ارفع نموذجًا', 'Upload a model') : t('إدارة النموذج', 'Manage the model')}
        <Forward size={13} />
      </AppLink>
    </Panel>
  );
}
