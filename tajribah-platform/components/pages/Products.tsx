'use client';

// MD-010 — Products table view

import { useMemo, useState } from 'react';
import { Package, Plus, Ruler, Search, Upload } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { formatNumber, formatRelative } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Forward, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import type { ProductRow } from '@/lib/view-models';

type Filter = 'all' | 'ar_on' | 'ar_off' | 'no_dimensions' | 'draft';

const TYPE_LABEL: Record<ProductRow['productType'], { ar: string; en: string }> = {
  watch: { ar: 'ساعة', en: 'Watch' },
  jewelry: { ar: 'مجوهرات', en: 'Jewellery' },
  eyewear: { ar: 'نظارات', en: 'Eyewear' },
  bag: { ar: 'حقيبة', en: 'Bag' },
  apparel: { ar: 'ملابس', en: 'Apparel' },
  furniture: { ar: 'أثاث', en: 'Furniture' },
  other: { ar: 'أخرى', en: 'Other' },
};

/** A product with no millimetres cannot be shown at true scale — that is the whole product. */
export const hasDimensions = (product: ProductRow): boolean => {
  const d = product.dimensions;
  return !!d && Object.values(d).some((value) => typeof value === 'number' && value > 0);
};

export default function Products() {
  const { t, pick, lang } = useLang();
  const { data, loading, error } = useResource((source) => source.products());
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const all = data ?? [];
    const text = query.trim().toLowerCase();
    return all.filter((product) => {
      if (text && ![product.name, product.nameAr ?? '', product.sku ?? '']
        .some((field) => field.toLowerCase().includes(text))) return false;
      if (filter === 'ar_on') return product.arEnabled;
      if (filter === 'ar_off') return !product.arEnabled;
      if (filter === 'no_dimensions') return !hasDimensions(product);
      if (filter === 'draft') return product.status !== 'active';
      return true;
    });
  }, [data, filter, query]);

  const crumbs = [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('المنتجات', 'Products') }];
  const missing = (data ?? []).filter((p) => !hasDimensions(p)).length;

  const filters: { key: Filter; label: string; count?: number }[] = [
    { key: 'all', label: t('الكل', 'All'), count: data?.length },
    { key: 'ar_on', label: t('العرض مفعّل', 'AR on'), count: data?.filter((p) => p.arEnabled).length },
    { key: 'ar_off', label: t('بدون عرض', 'No AR'), count: data?.filter((p) => !p.arEnabled).length },
    { key: 'no_dimensions', label: t('بدون مقاسات', 'Missing sizes'), count: missing },
    { key: 'draft', label: t('مسودة', 'Draft'), count: data?.filter((p) => p.status !== 'active').length },
  ];

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('المنتجات', 'Products')}
        lead={t(
          'المنتجات المستوردة من متجرك. فعّل العرض ثلاثي الأبعاد لكل منتج، وتأكد من مقاسه بالمليمتر.',
          'Products imported from your store. Switch on AR per product, and check each one’s millimetre size.',
        )}
        actions={
          <>
            <AppLink href="/dashboard/connections" className="btn btn-ghost">
              <Upload size={16} aria-hidden />{t('مزامنة الآن', 'Sync now')}
            </AppLink>
            <AppLink href="/dashboard/products/new" className="btn btn-primary">
              <Plus size={16} aria-hidden />{t('منتج يدوي', 'Add manually')}
            </AppLink>
          </>
        }
      />

      {missing > 0 && (
        <div className="panel" style={{ padding: '13px 16px', marginBottom: 16, display: 'flex', gap: 11, alignItems: 'center' }}>
          <span className="empty-icon" style={{ width: 34, height: 34, margin: 0, borderRadius: 10, background: 'var(--warn-bg)', color: 'var(--warn)' }}>
            <Ruler size={17} aria-hidden />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 14.5 }}>
              {t(`${formatNumber(missing, lang)} منتجات بلا مقاس`, `${formatNumber(missing, lang)} products have no size`)}
            </strong>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
              {t(
                'المقاس بالمليمتر هو ما يجعل المقارنة والتجربة حقيقية. بدونه يظهر المنتج بحجم تقريبي.',
                'Millimetres are what make the comparison and the try-on true to life. Without them the product is only approximately sized.',
              )}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter('no_dimensions')}>
            {t('اعرضها', 'Show them')}
          </button>
        </div>
      )}

      <Panel
        flush
        title={t('كل المنتجات', 'All products')}
        sub={data ? t(`${formatNumber(rows.length, lang)} من ${formatNumber(data.length, lang)}`, `${formatNumber(rows.length, lang)} of ${formatNumber(data.length, lang)}`) : undefined}
        actions={
          <label style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1 }}>
            <Search size={15} aria-hidden style={{ position: 'absolute', insetInlineStart: 10, color: 'var(--text-3)' }} />
            <span className="sr-only">{t('ابحث في المنتجات', 'Search products')}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('ابحث بالاسم أو الرمز', 'Search by name or SKU')}
              style={{
                border: '1px solid var(--line)', borderRadius: 10, padding: '7px 12px',
                paddingInlineStart: 30, font: 'inherit', fontSize: 13.5, width: 220, maxWidth: '100%', flex: 1,
              }}
            />
          </label>
        }
      >
        <div style={{ display: 'flex', gap: 6, padding: '12px 18px 0', flexWrap: 'wrap' }}>
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`btn btn-sm ${filter === item.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              {item.count != null && <span style={{ opacity: .65 }}>{formatNumber(item.count, lang)}</span>}
            </button>
          ))}
        </div>

        {loading && <Loading rows={6} />}
        {error && <ErrorNote error={error} />}

        {!loading && !error && rows.length === 0 && (
          <Empty
            icon={<Package size={22} />}
            title={t('لا نتائج', 'Nothing here')}
            body={t('جرّب مرشّحًا آخر، أو اربط متجرك لاستيراد منتجاتك.', 'Try another filter, or connect your store to import your catalogue.')}
            action={<AppLink href="/dashboard/connections" className="btn btn-accent">{t('اربط متجرك', 'Connect your store')}</AppLink>}
          />
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">{t('المنتج', 'Product')}</th>
                  <th scope="col">{t('النوع', 'Type')}</th>
                  <th scope="col">{t('السعر', 'Price')}</th>
                  <th scope="col">{t('المقاس', 'Size')}</th>
                  <th scope="col">{t('النموذج', 'Model')}</th>
                  <th scope="col">{t('العرض', 'AR')}</th>
                  <th scope="col">{t('مشاهدات 30 يومًا', 'Views 30d')}</th>
                  <th scope="col">{t('آخر تحديث', 'Updated')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <AppLink href={`/dashboard/products/${product.id}`} className="cell-main">
                        <span className="thumb" aria-hidden><Package size={17} /></span>
                        <span className="lines">
                          <strong>{lang === 'ar' ? (product.nameAr ?? product.name) : product.name}</strong>
                          <span>{product.sku ?? '—'}</span>
                        </span>
                      </AppLink>
                    </td>
                    <td>{pick(TYPE_LABEL[product.productType])}</td>
                    <td className="num">
                      {product.priceMinor == null ? '—' : formatMoney(product.priceMinor, product.currency, lang)}
                    </td>
                    <td>
                      {hasDimensions(product)
                        ? <span className="mm">{sizeText(product, t('مم', 'mm'))}</span>
                        : <Badge tone="warn">{t('ناقص', 'Missing')}</Badge>}
                    </td>
                    <td><ModelBadge status={product.modelStatus} /></td>
                    <td>
                      {product.arEnabled
                        ? <Badge tone="ok" dot>{t('مفعّل', 'On')}</Badge>
                        : <Badge>{t('متوقف', 'Off')}</Badge>}
                    </td>
                    <td className="num">{formatNumber(product.views30, lang)}</td>
                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{formatRelative(product.updatedAt, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="hint" style={{ marginTop: 14 }}>
        <AppLink href="/dashboard/models" style={{ color: 'var(--aqua)' }}>
          {t('إدارة النماذج ثلاثية الأبعاد', 'Manage 3D models')}<Forward size={13} />
        </AppLink>
      </p>
    </Shell>
  );
}

function sizeText(product: ProductRow, unit: string): string {
  const d = product.dimensions!;
  if (d.caseMm) return `${d.caseMm} ${unit}`;
  const parts = [d.widthMm, d.heightMm, d.depthMm].filter((v): v is number => typeof v === 'number' && v > 0);
  return `${parts.join(' × ')} ${unit}`;
}

function ModelBadge({ status }: { status: ProductRow['modelStatus'] }) {
  const { t } = useLang();
  if (status === 'ready') return <Badge tone="ok">{t('جاهز', 'Ready')}</Badge>;
  if (status === 'processing') return <Badge tone="accent">{t('قيد المعالجة', 'Processing')}</Badge>;
  if (status === 'failed') return <Badge tone="bad">{t('فشل', 'Failed')}</Badge>;
  return <Badge>{t('لا يوجد', 'None')}</Badge>;
}
