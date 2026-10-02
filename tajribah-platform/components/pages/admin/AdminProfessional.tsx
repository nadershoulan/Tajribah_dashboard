'use client';

// P3.10 — Professional models: every store's requests for a model made by Tajribah's team; quote each one

import { useEffect, useState } from 'react';
import { PenTool, Send } from 'lucide-react';
import { useAuth, type AdminProfessionalQueue, type AdminProfessionalRow } from '@/lib/auth';
import { STATUS_LABEL, type ProfessionalStatus } from '@/lib/contracts/professional';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { foldDigits, formatMoney } from '@/lib/money';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

export default function AdminProfessionalPage() {
  const { t } = useLang();
  return <AdminShell title={t('النماذج الاحترافية', 'Professional models')}><Queue /></AdminShell>;
}

const TABS: ProfessionalStatus[] = ['requested', 'quoted', 'accepted', 'delivered', 'cancelled'];

function Queue() {
  const { t, pick } = useLang();
  const auth = useAuth();
  const [status, setStatus] = useState<ProfessionalStatus>('requested');
  const [data, setData] = useState<AdminProfessionalQueue | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    auth.admin.professionalQueue(status).then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, status, version]);

  return (
    <div className="qa">
      <p className="hint" style={{ margin: 0 }}>
        {t('طلبات المتاجر لنموذج يصنعه فريق تجربة لمنتج واحد. انظر إلى المنتج ومقاساته وصوره، ثم أرسل سعرًا قبل الضريبة — يراه التاجر مع الضريبة والإجمالي. الدفع يُفتح مع بوابة الدفع.',
          'Stores’ requests for a model made by Tajribah’s team for one product. Look at the product, its measurements and photos, then send a price before VAT — the merchant sees it with the VAT and the total. Paying opens with the payment gateway.')}
      </p>
      <div className="qa-tabs" role="tablist" aria-label={t('حالة الطلب', 'Order status')}>
        {TABS.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={status === key} className={`btn btn-sm ${status === key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { if (key !== status) { setData(null); setStatus(key); } }}>
            {pick(STATUS_LABEL[key])}{data && <span className="num"> · {formatNumber(data.counts[key], 'en')}</span>}
          </button>
        ))}
      </div>
      {error && <ErrorNote error={error} />}
      {!data && !error && <Panel><Loading rows={4} /></Panel>}
      {data && data.rows.length === 0 && (
        <Panel><Empty icon={<PenTool size={22} />} title={status === 'requested' ? t('لا طلبات بانتظار سعر', 'No requests waiting for a price') : t('لا طلبات هنا', 'No orders here')}
          body={t('تظهر الطلبات هنا حين يطلب تاجر نموذجًا من صفحة المنتج.', 'Requests appear here when a merchant asks from a product’s page.')} /></Panel>
      )}
      {data?.rows.map((row) => <Order key={`${row.id}:${row.status}:${row.quote?.quotedAt ?? ''}`} row={row} onQuoted={() => setVersion((v) => v + 1)} />)}
    </div>
  );
}

function Order({ row, onQuoted }: { row: AdminProfessionalRow; onQuoted: () => void }) {
  const { t, lang, pick } = useLang();
  const auth = useAuth();
  const [riyals, setRiyals] = useState(row.quote ? String(row.quote.priceMinor / 100) : '');
  const [note, setNote] = useState(row.quote?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = lang === 'ar' ? row.productNameAr ?? row.productName : row.productName;
  const store = lang === 'ar' ? row.store.nameAr ?? row.store.name : row.store.name;
  const d = row.product.dimensions;
  const size = d && (d.widthMm || d.heightMm) ? `${d.widthMm ?? '—'} × ${d.heightMm ?? '—'} × ${d.depthMm ?? '—'}` : null;
  const quotable = row.status === 'requested' || row.status === 'quoted';
  const money = (minor: number) => formatMoney(minor, 'SAR', lang === 'ar' ? 'ar' : 'en');

  const send = async () => {
    const value = Number(foldDigits(riyals).replace(',', '.'));
    if (!Number.isFinite(value) || value < 1) { setProblem(t('سعر بالريال، 1 على الأقل', 'A price in riyals, at least 1')); return; }
    setBusy(true);
    setProblem(null);
    try { await auth.admin.quoteProfessional(row.id, { priceMinor: Math.round(value * 100), note: note.trim() || null }); onQuoted(); } catch (e) {
      setProblem((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Panel title={name} sub={`${store} · ${formatDateTime(row.createdAt, lang === 'ar' ? 'ar' : 'en')}`} actions={<Badge tone={row.status === 'quoted' ? 'accent' : undefined}>{pick(STATUS_LABEL[row.status])}</Badge>}>
      <table className="qa-sizes" style={{ marginBottom: 12 }}>
        <tbody>
          <tr><th scope="row">{t('المقاس (مم)', 'Size (mm)')}</th><td className="num" dir="ltr">{size ?? t('لا مقاسات', 'No measurements')}</td></tr>
          <tr><th scope="row">{t('صور المرجع', 'Reference photos')}</th><td className="num">{formatNumber(row.product.photos, 'en')}</td></tr>
          {row.quote && <tr><th scope="row">{t('السعر الحالي', 'Current quote')}</th><td className="num">{money(row.quote.priceMinor)} + {money(row.quote.vatMinor)} = {money(row.quote.totalMinor)}</td></tr>}
        </tbody>
      </table>
      {row.note && <p style={{ margin: '0 0 12px', fontSize: 14 }}><strong>{t('ملاحظة التاجر: ', 'The merchant’s note: ')}</strong>{row.note}</p>}
      {quotable && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="brand-row">
            <div className="field">
              <label htmlFor={`price-${row.id}`}>{t('السعر قبل الضريبة (ريال)', 'Price before VAT (SAR)')}</label>
              <input id={`price-${row.id}`} dir="ltr" inputMode="decimal" value={riyals} onChange={(e) => setRiyals(e.target.value)} placeholder="450" />
            </div>
            <div className="field">
              <label htmlFor={`qnote-${row.id}`}>{t('ملاحظة للتاجر (اختياري)', 'A note for the merchant (optional)')}</label>
              <input id={`qnote-${row.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t('مثل: جاهز خلال 5 أيام عمل', 'Like: ready in 5 working days')} />
            </div>
          </div>
          <div><button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy}>
            <Send size={15} aria-hidden />{busy ? t('جارٍ الإرسال…', 'Sending…') : row.status === 'quoted' ? t('عدّل السعر', 'Revise the quote') : t('أرسل السعر', 'Send the quote')}
          </button></div>
        </div>
      )}
      {problem && <p className="field-error" role="alert" style={{ marginTop: 10 }}>{problem}</p>}
    </Panel>
  );
}
