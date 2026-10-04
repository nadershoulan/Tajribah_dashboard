'use client';

// MD-012 — New product: one added by hand (API-031), for a store not connected yet or a product off its catalogue

import { useState } from 'react';
import { useWriteLock } from '@/components/dashboard/write-lock';
import { AppLink, useEnv } from '@/lib/app-env';
import { ApiError } from '@/lib/api-client';
import { useData } from '@/lib/data';
import { useLang } from '@/lib/i18n';
import { toMinor } from '@/lib/money';
import { newProductErrors, parseMm, type FieldErrors, type NewProduct } from '@/lib/product-edit';
import type { ProductRow } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { ErrorNote, PageHead, Panel } from '@/components/dashboard/ui';

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
  required: 'مطلوب',
  'at most 200 characters': '200 حرف على الأكثر',
  'at most 100 characters': '100 حرف على الأكثر',
  'a price of 0 or more': 'سعر 0 أو أكثر، بالريال',
  'must be more than 0': 'يجب أن يكون أكبر من 0',
  'is over 3 metres — check the unit (mm)': 'أكثر من 3 أمتار — تأكد أن الوحدة مليمتر',
  'numbers only, in millimetres': 'أرقام فقط، بالمليمتر',
};

export default function ProductNew() {
  const { t, pick, lang } = useLang();
  const env = useEnv();
  const source = useData();
  const lock = useWriteLock(); // T50: a read-only store or a staff view adds nothing
  const [v, setV] = useState({ name: '', nameAr: '', sku: '', price: '', type: 'other' as ProductRow['productType'], width: '', height: '', depth: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const set = (key: keyof typeof v) => (value: string) => setV((old) => ({ ...old, [key]: value }));
  const say = (message: string) => (lang === 'ar' ? MESSAGE_AR[message] ?? message : message);

  const save = async () => {
    setFailure(null);
    const local: FieldErrors = {};
    const input: NewProduct = { name: v.name, productType: v.type };
    if (v.nameAr.trim()) input.nameAr = v.nameAr.trim();
    if (v.sku.trim()) input.sku = v.sku.trim();
    if (v.price.trim()) {
      try { input.priceMinor = toMinor(v.price); } catch { local.priceMinor = ['a price of 0 or more']; }
    }
    const dimensions: Record<string, number> = {};
    for (const [key, text] of [['widthMm', v.width], ['heightMm', v.height], ['depthMm', v.depth]] as const) {
      const parsed = parseMm(text);
      if ('error' in parsed) local[`dimensions.${key}`] = [parsed.error];
      else if (parsed.value !== null) dimensions[key] = parsed.value;
    }
    if (Object.keys(dimensions).length) input.dimensions = dimensions;
    const all = { ...newProductErrors(input), ...local };
    setErrors(all);
    if (Object.keys(all).length) {
      document.getElementById(`np-${Object.keys(all)[0]!.replace('dimensions.', '')}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const row = await source.createProduct(input);
      env.navigate(`/dashboard/products/${encodeURIComponent(row.id)}`); // its page: sizes, AR, the 3D model
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else setFailure(error as Error);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: string, label: string, value: string, onChange: (v: string) => void, opts: { ltr?: boolean; unit?: string; hint?: string; required?: boolean } = {}) => {
    const message = errors[key]?.[0];
    const id = `np-${key.replace('dimensions.', '')}`;
    const input = (
      <input id={id} value={value} dir={opts.ltr ? 'ltr' : undefined} inputMode={opts.unit ? 'decimal' : undefined} required={opts.required}
        aria-invalid={!!message} aria-describedby={message ? `${id}-error` : opts.hint ? `${id}-hint` : undefined}
        onChange={(e) => { onChange(e.target.value); if (message) setErrors((old) => { const next = { ...old }; delete next[key]; return next; }); }} />
    );
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        {opts.unit ? <div className="input-unit">{input}<span aria-hidden>{opts.unit}</span></div> : input}
        {message ? <span id={`${id}-error`} className="field-error">{say(message)}</span>
          : opts.hint ? <span id={`${id}-hint`} className="field-hint">{opts.hint}</span> : null}
      </div>
    );
  };

  return (
    <Shell tenant={null} crumbs={[{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('المنتجات', 'Products'), href: '/dashboard/products' }, { label: t('منتج جديد', 'New product') }]}>
      <PageHead
        title={t('منتج جديد', 'New product')}
        lead={t('أضف منتجًا بيدك — لمتجر لم تربطه بعد، أو لمنتج ليس في متجرك. المنتجات المربوطة تأتي من متجرك تلقائيًا.', 'Add a product by hand — for a store you have not connected yet, or a product that is not in your store. Connected products come from your store on their own.')}
      />
      <div className="detail-grid">
        <Panel title={t('المنتج', 'The product')}>
          {field('name', t('الاسم', 'Name'), v.name, set('name'), { required: true, hint: t('كما يظهر للعميل.', 'As shoppers see it.') })}
          {field('nameAr', t('الاسم بالعربية (اختياري)', 'Arabic name (optional)'), v.nameAr, set('nameAr'))}
          {field('sku', t('الرمز SKU (اختياري)', 'SKU (optional)'), v.sku, set('sku'), { ltr: true })}
          {field('priceMinor', t('السعر (اختياري)', 'Price (optional)'), v.price, set('price'), { ltr: true, unit: t('ر.س', 'SAR') })}
          <div className="field">
            <label htmlFor="np-type">{t('النوع', 'Type')}</label>
            <select id="np-type" value={v.type} onChange={(e) => set('type')(e.target.value)}>
              {TYPES.map((option) => <option key={option.value} value={option.value}>{pick(option)}</option>)}
            </select>
          </div>
        </Panel>
        <Panel title={t('المقاس', 'Size')} sub={t('بالمليمتر — العرض والارتفاع يلزمان للعرض بالحجم الحقيقي، ويمكن إضافتهما لاحقًا', 'In millimetres — width and height are needed for true-size AR, and can be added later')}>
          <div className="mm-grid">
            {field('dimensions.widthMm', t('العرض', 'Width'), v.width, set('width'), { ltr: true, unit: t('مم', 'mm') })}
            {field('dimensions.heightMm', t('الارتفاع', 'Height'), v.height, set('height'), { ltr: true, unit: t('مم', 'mm') })}
            {field('dimensions.depthMm', t('العمق', 'Depth'), v.depth, set('depth'), { ltr: true, unit: t('مم', 'mm') })}
          </div>
        </Panel>
      </div>
      {failure && <ErrorNote error={failure} />}
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || lock.locked} title={lock.title}>
          {saving ? t('جارٍ الإضافة…', 'Adding…') : t('أضف المنتج', 'Add the product')}
        </button>
        <AppLink href="/dashboard/products" className="btn btn-ghost">{t('إلغاء', 'Cancel')}</AppLink>
      </div>
    </Shell>
  );
}
