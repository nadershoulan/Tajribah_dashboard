'use client';

// MD-010 — Products table view

import { useEffect, useState } from 'react';
import { Package, Plus, Ruler, Search, Upload } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useData, useResource } from '@/lib/data';
import type { ProductFilter } from '@/lib/contracts/products';
import { isSized } from '@/lib/product-list';
import { formatNumber, formatRelative } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Forward, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import type { ProductRow } from '@/lib/view-models';

const TYPE_LABEL: Record<ProductRow['productType'], { ar: string; en: string }> = {
  watch: { ar: 'ساعة', en: 'Watch' },
  jewelry: { ar: 'مجوهرات', en: 'Jewellery' },
  eyewear: { ar: 'نظارات', en: 'Eyewear' },
  bag: { ar: 'حقيبة', en: 'Bag' },
  apparel: { ar: 'ملابس', en: 'Apparel' },
  furniture: { ar: 'أثاث', en: 'Furniture' },
  other: { ar: 'أخرى', en: 'Other' },
};

/** Wait for typing to pause before asking the server. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

type MorePages = { key: string; rows: ProductRow[]; nextCursor: string | null; loading: boolean; error: Error | null };

export default function Products() {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 250);

  // Search, filter, counts and paging are the server's (P1.9): the screen never holds more
  // of the catalogue than it has shown, however large the store.
  const { data, loading, error } = useResource((s) => s.products({ q: q || undefined, filter }), [q, filter]);
  const key = `${filter}|${q}`;
  const [more, setMore] = useState<MorePages | null>(null);
  const extra = more?.key === key ? more : null; // pages for an older query are simply ignored
  const rows = [...(data?.rows ?? []), ...(extra?.rows ?? [])];
  const nextCursor = extra ? extra.nextCursor : data?.nextCursor ?? null;
  const counts = data?.counts;

  const loadMore = async () => {
    if (!nextCursor || extra?.loading) return;
    setMore({ key, rows: extra?.rows ?? [], nextCursor, loading: true, error: null });
    try {
      const page = await source.products({ q: q || undefined, filter, cursor: nextCursor });
      setMore((m) => (m?.key === key ? { key, rows: [...m.rows, ...page.rows], nextCursor: page.nextCursor, loading: false, error: null } : m));
    } catch (failure) {
      setMore((m) => (m?.key === key ? { ...m, loading: false, error: failure as Error } : m));
    }
  };

  const crumbs = [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('المنتجات', 'Products') }];
  const missing = counts?.missing_sizes ?? 0;

  const filters: { key: ProductFilter; label: string; count?: number }[] = [
    { key: 'all', label: t('الكل', 'All'), count: counts?.all },
    { key: 'ar_on', label: t('العرض مفعّل', 'AR on'), count: counts?.ar_on },
    { key: 'no_ar', label: t('بدون عرض', 'No AR'), count: counts?.no_ar },
    { key: 'missing_sizes', label: t('بدون مقاسات', 'Missing sizes'), count: counts?.missing_sizes },
    { key: 'draft', label: t('مسودة', 'Draft'), count: counts?.draft },
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
              {t(unsizedAr(missing, formatNumber(missing, lang)), missing === 1 ? '1 product has no size' : `${formatNumber(missing, lang)} products have no size`)}
            </strong>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
              {t(
                'المقاس بالمليمتر هو ما يجعل المقارنة والتجربة حقيقية. بدونه يظهر المنتج بحجم تقريبي.',
                'Millimetres are what make the comparison and the try-on true to life. Without them the product is only approximately sized.',
              )}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter('missing_sizes')}>
            {t('اعرضها', 'Show them')}
          </button>
        </div>
      )}

      <Panel
        flush
        title={t('كل المنتجات', 'All products')}
        sub={counts ? t(`${formatNumber(rows.length, lang)} من ${formatNumber(counts[filter], lang)}`, `${formatNumber(rows.length, lang)} of ${formatNumber(counts[filter], lang)}`) : undefined}
        actions={
          <label style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1 }}>
            <Search size={15} aria-hidden style={{ position: 'absolute', insetInlineStart: 10, color: 'var(--text-3)' }} />
            <span className="sr-only">{t('ابحث في المنتجات', 'Search products')}</span>
            <input
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
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
                      {isSized(product)
                        ? <span className="mm">{sizeText(product, t('مم', 'mm'))}</span>
                        : <Badge tone="warn">{t('ناقص', 'Missing')}</Badge>}
                    </td>
                    <td><ModelBadge status={product.modelStatus} /></td>
                    <td>
                      {product.live
                        ? <Badge tone="ok" dot>{t('في المتجر', 'Live')}</Badge>
                        : product.arEnabled
                          ? <Badge tone="accent">{t('مفعّل، غير منشور', 'On, not published')}</Badge>
                          : <Badge>{t('متوقف', 'Off')}</Badge>}
                    </td>
                    <td className="num">{formatNumber(product.views30, lang)}</td>
                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{formatRelative(product.updatedAt, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {extra?.error && <ErrorNote error={extra.error} />}
            {nextCursor && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 18px' }}>
                <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={extra?.loading}>
                  {extra?.loading ? t('جارٍ التحميل…', 'Loading…') : t('عرض المزيد', 'Show more')}
                </button>
              </div>
            )}
          </div>
        )}
      </Panel>

      <p className="hint" style={{ marginTop: 14 }}>
        <AppLink href="/dashboard/models" style={{ color: 'var(--aqua-ink)' }}>
          {t('إدارة النماذج ثلاثية الأبعاد', 'Manage 3D models')}<Forward size={13} />
        </AppLink>
      </p>
    </Shell>
  );
}

/** Arabic counts agree with their noun: one, two, three to ten, eleven and up. */
function unsizedAr(n: number, shown: string): string {
  if (n === 1) return 'منتج واحد بلا مقاس';
  if (n === 2) return 'منتجان بلا مقاس';
  if (n <= 10) return `${shown} منتجات بلا مقاس`;
  return `${shown} منتجًا بلا مقاس`;
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
