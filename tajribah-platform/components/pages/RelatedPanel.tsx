'use client';

/**
 * Recommendations, first version — on a product's page: the products shoppers looked at together with
 * this one in the last 30 days (a view, AR or the try-on in the same visit), recomputed every night.
 * Pro and up also show them to shoppers on the product's own page.
 */
import { Link2 } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useResource } from '@/lib/data';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { Badge, Panel } from '@/components/dashboard/ui';

export default function RelatedPanel({ productId }: { productId: string }) {
  const { t, lang } = useLang();
  const { data } = useResource((s) => s.relatedProducts(productId), [productId]);
  if (!data) return null;
  return (
    <Panel title={t('يشاهدها العملاء معه', 'Often viewed together')} sub={t('من زيارات آخر 30 يومًا، يُحدَّث كل ليلة', 'From the last 30 days of visits, updated every night')}
      actions={data.shownToShoppers ? <Badge tone="ok">{t('يظهر للعملاء', 'Shown to shoppers')}</Badge> : <Badge>{t('للاحترافية وما فوقها', 'Pro and up')}</Badge>}>
      {data.related.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>{t('لا يوجد بعد: نحتاج 3 زيارات على الأقل شاهدت هذا المنتج ومنتجًا آخر.', 'Nothing yet: it takes at least 3 visits that looked at this product and another one.')}</p>
      ) : (
        <ul className="plain-list" style={{ display: 'grid', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
          {data.related.map((r) => (
            <li key={r.productId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <AppLink href={`/dashboard/products/${r.productId}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <Link2 size={14} aria-hidden />{lang === 'ar' ? r.nameAr ?? r.name : r.name}
              </AppLink>
              <span className="hint num" style={{ margin: 0 }}>{t(`${formatNumber(r.sessions, 'ar')} زيارة`, `${formatNumber(r.sessions, 'en')} visits`)}</span>
            </li>
          ))}
        </ul>
      )}
      {data.computedAt && <p className="hint">{t(`آخر تحديث ${formatDateTime(data.computedAt, 'ar')}`, `Last updated ${formatDateTime(data.computedAt, 'en')}`)}</p>}
      {!data.shownToShoppers && <p className="hint" style={{ marginBottom: 0 }}>{t('في باقة «الاحترافية» تظهر هذه المنتجات للعملاء في صفحة المنتج الخاصة.', 'On Pro, these products are shown to shoppers on the product’s own page.')}</p>}
    </Panel>
  );
}
