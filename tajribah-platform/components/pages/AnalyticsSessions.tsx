'use client';

// MD-121 — Visits (P4.10: the session explorer)

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatNumber } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { SESSIONS_MAX_OFFSET, type SessionListView, type SessionPathView, type ShopEventType } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, PageSizePicker, Pagination, Panel } from '@/components/dashboard/ui';
import { DEFAULT_PAGE_SIZE, rowNumber, type PageSize } from '@/lib/pagination';

const EVENT_LABEL: Record<ShopEventType, { ar: string; en: string }> = {
  product_view: { ar: 'مشاهدة منتج', en: 'Product view' },
  ar_open: { ar: 'فتح العرض', en: 'AR opened' },
  ar_place: { ar: 'وضع المنتج في المكان', en: 'Placed in the room' },
  ar_close: { ar: 'إغلاق العرض', en: 'AR closed' },
  tryon_start: { ar: 'بدء تجربة افتراضية', en: 'Try-on started' },
  tryon_capture: { ar: 'حفظ إطلالة', en: 'Look saved' },
  tryon_share: { ar: 'مشاركة إطلالة', en: 'Look shared' },
  add_to_cart: { ar: 'إضافة للسلة', en: 'Added to cart' },
  purchase: { ar: 'شراء', en: 'Purchase' },
};
const FILTERS: SessionListView['filter'][] = ['all', 'opened', 'bought'];

/** `14:05:09` in Riyadh, ASCII digits in both languages. */
const clock = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));

/**
 * The visits of one day, latest first, and — opened — one visit's path. A visit is not a person: its
 * id is a daily hash, so the same shopper tomorrow is another visit, and nothing here names anyone.
 */
export default function AnalyticsSessions() {
  const { t, lang } = useLang();
  const [day, setDay] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<SessionListView['filter']>('all');
  const [offset, setOffset] = useState(0);
  const [perPage, setPerPage] = useState<PageSize>(DEFAULT_PAGE_SIZE); // T76: rows per page
  const { data, loading, error } = useResource((source) => source.sessionList({ day, filter, offset, limit: perPage }), [day, filter, offset, perPage]);
  // T76: numbered pages, as far as the server reads into a day (its offset cap).
  const page = Math.floor(offset / perPage) + 1;
  const pages = data ? Math.min(Math.max(1, Math.ceil(data.total / perPage)), Math.floor(SESSIONS_MAX_OFFSET / perPage) + 1) : 1;
  const [open, setOpen] = useState<string | null>(null);
  const planRequired = error instanceof ApiError && error.code === 'plan_required';

  const device = (d: SessionListView['sessions'][number]['device']) => (d === 'mobile' ? t('جوال', 'Mobile') : d === 'tablet' ? t('لوحي', 'Tablet') : d === 'desktop' ? t('حاسب', 'Desktop') : '—');
  const filterLabel = (f: SessionListView['filter']) => (f === 'all' ? t('الكل', 'All') : f === 'opened' ? t('فتحت العرض أو التجربة', 'Opened AR or try-on') : t('اشترت', 'Bought'));
  const choose = (change: () => void) => { setOpen(null); setOffset(0); change(); };

  return (
    <Shell tenant={null} crumbs={[{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('التحليلات', 'Analytics'), href: '/dashboard/analytics' }, { label: t('الزيارات', 'Visits') }]}>
      <PageHead
        title={t('الزيارات', 'Visits')}
        lead={t(
          'زيارات يوم واحد لصفحات منتجاتك، الأحدث أولًا، ومسار كل زيارة: ماذا شاهدت وماذا فتحت وهل اشترت. الزيارة ليست شخصًا — لا نعرف من هو، والمتسوّق نفسه غدًا زيارة أخرى.',
          'One day’s visits to your product pages, latest first, and each visit’s path: what it saw, what it opened, whether it bought. A visit is not a person — we do not know who it is, and the same shopper tomorrow is another visit.',
        )}
        actions={
          <>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="sr-only">{t('اليوم', 'Day')}</span>
              <input type="date" className="input" dir="ltr" value={day ?? data?.day ?? ''} min={data?.oldest} max={data?.today}
                onChange={(e) => { const next = e.target.value; if (next) choose(() => setDay(next)); }} />
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {FILTERS.map((f) => (
                <button key={f} type="button" className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={filter === f} onClick={() => choose(() => setFilter(f))}>{filterLabel(f)}</button>
              ))}
            </div>
          </>
        }
      />

      {planRequired && (
        <Panel>
          <p style={{ margin: 0 }}>
            {t('مسار الزيارات ضمن التحليلات الكاملة، في باقة النمو فأعلى.', 'Visit paths are part of full analytics, in the Growth plan and up.')}{' '}
            <AppLink href="/dashboard/billing">{t('الباقات', 'Plans')}</AppLink>
          </p>
        </Panel>
      )}
      {error && !planRequired && <ErrorNote error={error} />}

      {!planRequired && (
        <Panel flush title={data ? t(`زيارات ${formatDate(`${data.day}T12:00:00Z`, 'ar')}`, `Visits on ${formatDate(`${data.day}T12:00:00Z`, 'en')}`) : t('الزيارات', 'Visits')}
          sub={t('تُحفظ تفاصيل الزيارات 90 يومًا؛ الأرقام اليومية تبقى.', 'Visit details are kept for 90 days; the daily figures stay.')}
          actions={<PageSizePicker id="visits-page-size" value={perPage} onChange={(n) => choose(() => setPerPage(n))} />}>
          {loading && <Loading rows={5} />}
          {!loading && data && !data.kept && (
            <p style={{ margin: 0, padding: 18 }}>{t('تفاصيل هذا اليوم لم تعد محفوظة (أو لم يأتِ بعد). اختر يومًا ضمن آخر 90 يومًا.', 'This day’s details are no longer kept (or it has not come yet). Choose a day within the last 90 days.')}</p>
          )}
          {!loading && data && data.kept && data.sessions.length === 0 && (
            <p style={{ margin: 0, padding: 18 }}>{offset > 0 ? t('لا زيارات أخرى.', 'No more visits.') : filter === 'all' ? t('لا زيارات مسجّلة في هذا اليوم.', 'No visits recorded on this day.') : t('لا زيارات بهذا الوصف في هذا اليوم.', 'No visits like that on this day.')}</p>
          )}
          {!loading && data && data.sessions.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col" className="row-num">#</th>
                    <th scope="col">{t('الوقت', 'Time')}</th>
                    <th scope="col">{t('الأحداث', 'Events')}</th>
                    <th scope="col">{t('المنتجات', 'Products')}</th>
                    <th scope="col">{t('الجهاز', 'Device')}</th>
                    <th scope="col">{t('البلد', 'Country')}</th>
                    <th scope="col">{t('ما حدث', 'What happened')}</th>
                    <th scope="col"><span className="sr-only">{t('المسار', 'Path')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map((s, index) => (
                    <Fragment key={s.id}>
                      <tr>
                        <td className="num row-num">{formatNumber(rowNumber(page, perPage, index), lang)}</td>
                        <td className="num" dir="ltr">{clock(s.firstAt)}{clock(s.lastAt) !== clock(s.firstAt) && <> – {clock(s.lastAt)}</>}</td>
                        <td className="num">{formatNumber(s.events, lang)}</td>
                        <td className="num">{formatNumber(s.products, lang)}</td>
                        <td>{device(s.device)}</td>
                        <td>{s.country ?? '—'}</td>
                        <td>
                          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                            {s.opened && <Badge tone="accent">{t('فتحت العرض أو التجربة', 'Opened AR or try-on')}</Badge>}
                            {s.carted && <Badge tone="neutral">{t('أضافت للسلة', 'Added to cart')}</Badge>}
                            {s.bought && <Badge tone="ok">{t('اشترت', 'Bought')}</Badge>}
                            {!s.opened && !s.carted && !s.bought && <span className="hint" style={{ margin: 0 }}>{t('شاهدت فقط', 'Looked only')}</span>}
                          </span>
                        </td>
                        <td>
                          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                            {open === s.id ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}{t('المسار', 'Path')}
                          </button>
                        </td>
                      </tr>
                      {open === s.id && <tr><td colSpan={8} style={{ background: 'var(--tint)' }}><VisitPath id={s.id} /></td></tr>}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && data && data.sessions.length > 0 && (
            <Pagination page={page} pages={pages} onPage={(next) => { setOpen(null); setOffset((next - 1) * perPage); }} label={t('صفحات الزيارات', 'Visit pages')} />
          )}
        </Panel>
      )}
    </Shell>
  );
}

/** One visit's events in order, with what each row holds — and nothing else. */
function VisitPath({ id }: { id: string }) {
  const { t, lang } = useLang();
  const { data, loading, error } = useResource<SessionPathView | null>((s) => s.sessionPath(id), [id]);
  if (loading) return <Loading rows={3} />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <p style={{ margin: 0 }}>{t('لم تعد تفاصيل هذه الزيارة محفوظة.', 'This visit’s details are no longer kept.')}</p>;
  const about = [data.os, data.browser, data.country && (data.region ? `${data.country}-${data.region}` : data.country), data.page].filter(Boolean).join(' · ');
  return (
    <div data-visit-path>
      {about && <p className="hint" style={{ margin: '0 0 10px' }} dir="ltr">{about}</p>}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {data.events.map((e, i) => (
          <li key={`${e.at}-${i}`} style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="num" dir="ltr" style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{clock(e.at)}</span>
            <strong style={{ fontWeight: 600 }}>{EVENT_LABEL[e.type][lang]}</strong>
            {e.product ? <bdi>{e.product}</bdi> : e.type !== 'purchase' && <span className="hint" style={{ margin: 0 }}>{t('منتج غير معروف في متجرك', 'a product not in your store')}</span>}
            {e.type === 'purchase' && e.valueMinor != null && <span dir="ltr">{e.currency && e.currency !== 'SAR' ? `${(e.valueMinor / 100).toFixed(2)} ${e.currency}` : formatMoney(e.valueMinor, 'SAR', lang)}</span>}
            {e.durationMs != null && <span className="hint" style={{ margin: 0 }}>{t(`${formatNumber(Math.round(e.durationMs / 1000), lang)} ث`, `${formatNumber(Math.round(e.durationMs / 1000), lang)} s`)}</span>}
            {Object.entries(e.properties).map(([k, v]) => <code key={k} dir="ltr" style={{ fontSize: 12 }}>{k}={v}</code>)}
          </li>
        ))}
      </ol>
      {data.truncated && <p className="hint">{t('تُعرض أول 500 حدث من هذه الزيارة.', 'The first 500 events of this visit are shown.')}</p>}
    </div>
  );
}
