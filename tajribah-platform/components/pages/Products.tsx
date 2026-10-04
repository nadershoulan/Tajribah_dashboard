'use client';

// MD-010 — Products table view

import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Package, Plus, Ruler, Search, Upload } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import type { ProductFilter, ProductSort } from '@/lib/contracts/products';
import { isSized, nextSort, type ProductSortState } from '@/lib/product-list';
import { formatNumber, formatRelative } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Forward, Loading, PageHead, PageSizePicker, Pagination, Panel } from '@/components/dashboard/ui';
import { DEFAULT_PAGE_SIZE, pageCount, rangeText, rowNumber, type PageSize } from '@/lib/pagination';
import { useDebounced } from '@/lib/use-debounced';
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



const COLUMNS: { by: ProductSort; label: { ar: string; en: string } }[] = [
  { by: 'name', label: { ar: 'المنتج', en: 'Product' } },
  { by: 'type', label: { ar: 'النوع', en: 'Type' } },
  { by: 'price', label: { ar: 'السعر', en: 'Price' } },
  { by: 'size', label: { ar: 'المقاس', en: 'Size' } },
  { by: 'model', label: { ar: 'النموذج', en: 'Model' } },
  { by: 'ar', label: { ar: 'العرض', en: 'AR' } },
  { by: 'views', label: { ar: 'مشاهدات 30 يومًا', en: 'Views 30d' } },
  { by: 'updated', label: { ar: 'آخر تحديث', en: 'Updated' } },
];


export default function Products() {
  const { t, pick, lang } = useLang();
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 250);

  // Search, filter, counts and paging are the server's (P1.9): the screen never holds more
  // of the catalogue than one page, however large the store. T73: numbered pages.
  const [sort, setSort] = useState<ProductSortState>(null);
  const [perPage, setPerPage] = useState<PageSize>(DEFAULT_PAGE_SIZE); // T76: rows per page, beside the search
  const key = `${filter}|${q}|${sort?.by ?? ''}|${sort?.dir ?? ''}|${perPage}`;
  const [paged, setPaged] = useState({ key, page: 1 });
  const page = paged.key === key ? paged.page : 1; // a new search or filter starts at page 1
  const { data, loading, error } = useResource((s) => s.products({ q: q || undefined, filter, page, limit: perPage, sort: sort?.by, dir: sort?.dir }), [q, filter, page, sort?.by, sort?.dir, perPage]);
  const rows = data?.rows ?? [];
  const counts = data?.counts;
  const pages = pageCount(counts?.[filter] ?? 0, perPage);
  const goTo = (next: number) => {
    setPaged({ key, page: next });
    document.querySelector('table.data')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
        sub={counts ? rangeText(Math.min(page, pages), perPage, rows.length, counts[filter], lang) : undefined}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, flexWrap: 'wrap' }}>
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
          <PageSizePicker id="products-page-size" value={perPage} onChange={setPerPage} />
          </div>
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
                  <th scope="col" className="row-num">#</th>
                  {COLUMNS.map((c) => (
                    <th key={c.by} scope="col"
                      aria-sort={sort?.by === c.by ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      <button type="button" className="th-sort" onClick={() => setSort((s) => nextSort(s, c.by))}
                        title={t('رتّب حسب هذا العمود', 'Sort by this column')}>
                        {pick(c.label)}
                        {sort?.by !== c.by ? <ArrowUpDown size={13} aria-hidden className="th-sort-idle" />
                          : sort.dir === 'asc' ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((product, index) => (
                  <tr key={product.id}>
                    <td className="num row-num">{formatNumber(rowNumber(Math.min(page, pages), perPage, index), lang)}</td>
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
          </div>
        )}
        {!loading && !error && rows.length > 0 && <Pagination page={Math.min(page, pages)} pages={pages} onPage={goTo} label={t('صفحات المنتجات', 'Product pages')} />}
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
