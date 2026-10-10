'use client';

// T129 — Bank transfers: every store's requests to pay by transfer, newest first; open one to see the receipt and decide

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, MessageSquare, Search, StickyNote, XCircle } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useAuth, type AdminTransferDetail, type AdminTransferList, type AdminTransferStatus } from '@/lib/auth';
import { REJECTION_PRESETS, TRANSFER_STATUS_LABEL } from '@/lib/contracts/bank-transfer';
import { formatDate, formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { planByCode } from '@/lib/plans';
import { AdminShell } from '@/components/admin/shell';
import { CopyField, TransferTimeline } from '@/components/dashboard/bank-transfer';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

type Filter = AdminTransferStatus | 'all';
const TONE: Record<AdminTransferStatus, 'warn' | 'ok' | 'bad' | 'neutral' | 'accent'> = { pending: 'warn', info_requested: 'accent', approved: 'ok', rejected: 'bad', cancelled: 'neutral' };
/** The menu's count listens for this, so it changes the moment a request is decided. */
export const TRANSFERS_CHANGED = 'tajribah:transfers-changed';
const SUB_STATUS: Record<string, { ar: string; en: string }> = {
  trialing: { ar: 'تجربة', en: 'trial' }, active: { ar: 'نشط', en: 'active' }, past_due: { ar: 'متأخر', en: 'past due' },
  paused: { ar: 'موقوف', en: 'paused' }, cancelled: { ar: 'ملغى', en: 'cancelled' }, expired: { ar: 'منتهٍ', en: 'ended' },
};
const STORE_STATUS: Record<string, { ar: string; en: string }> = {
  trial: { ar: 'تجربة', en: 'trial' }, active: { ar: 'نشط', en: 'active' }, past_due: { ar: 'متأخر', en: 'past due' },
  suspended: { ar: 'معلّق', en: 'suspended' }, cancelled: { ar: 'للاطلاع فقط', en: 'read-only' },
};

export default function AdminBankTransfers() {
  const { t } = useLang();
  return <AdminShell title={t('التحويلات البنكية', 'Bank transfers')}><Transfers /></AdminShell>;
}

function Transfers() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  // a link from the staff email opens its request: /admin/bank-transfers?open=<id> (this screen mounts only in the browser, after the staff check)
  const [linked] = useState(() => { const id = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('open'); return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null; });
  const [filter, setFilter] = useState<Filter>(linked ? 'all' : 'pending');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<AdminTransferList | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [open, setOpen] = useState<string | null>(linked);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    auth.admin.bankTransfers({ status: filter, q: query || undefined }).then((data) => { if (live) { setList(data); setError(null); } }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, filter, query, version]);

  if (error && !list) return <ErrorNote error={error} />;
  if (!list) return <Panel><Loading rows={4} /></Panel>;

  const tabs: { id: Filter; label: string }[] = [
    { id: 'pending', label: t('بانتظار المراجعة', 'To review') },
    { id: 'info_requested', label: t('بانتظار المتجر', 'Waiting for the store') },
    { id: 'approved', label: t('مقبولة', 'Approved') },
    { id: 'rejected', label: t('مرفوضة', 'Declined') },
    { id: 'cancelled', label: t('ملغاة', 'Cancelled') },
    { id: 'all', label: t('الكل', 'All') },
  ];

  return (
    <div className="ops">
      <Panel flush title={t('طلبات الاشتراك بالتحويل البنكي', 'Plan requests paid by bank transfer')}
        sub={t('تحقق من وصول المبلغ في كشف الحساب ثم اقبل الطلب: يُفعَّل الاشتراك وتصدر الفاتورة الضريبية ويُبلَّغ المتجر بالبريد. كل قرار يُسجَّل.', 'Check the money arrived on the bank statement, then approve: the plan switches on, the tax invoice is issued and the store is emailed. Every decision is logged.')}>
        <div className="bt-admin-bar">
          <div role="tablist" aria-label={t('حالة الطلب', 'Request status')} className="bt-tabs">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={filter === tab.id} className={`btn btn-sm ${filter === tab.id ? 'btn-accent' : 'btn-ghost'}`}
                onClick={() => { setOpen(null); setFilter(tab.id); }}>
                {tab.label} <bdi>({list.counts[tab.id] ?? 0})</bdi>
              </button>
            ))}
          </div>
          <form className="bt-search" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('المرجع أو المتجر أو المحوِّل', 'Reference, store or sender')} aria-label={t('بحث', 'Search')} maxLength={80} />
            <button type="submit" className="btn btn-ghost btn-sm" aria-label={t('بحث', 'Search')}><Search size={15} aria-hidden /></button>
          </form>
        </div>
        {list.items.length === 0 ? (
          list.counts.all === 0
            ? <Empty title={t('لا طلبات تحويل بعد', 'No transfer requests yet')} body={t('حين يختار متجر «تحويل بنكي» عند الاشتراك يظهر طلبه هنا ويصلك بريد.', 'When a store chooses “Bank transfer” at checkout, its request appears here and you get an email.')} />
            : <Empty title={t('لا شيء هنا', 'Nothing here')} body={filter === 'pending' ? t('لا تحويلات تنتظر المراجعة.', 'No transfers are waiting for review.') : t('لا طلبات في هذا القسم.', 'No requests in this section.')} />
        ) : (
          <ul className="ops-list">
            {list.items.map((r) => (
              <li key={r.id} style={{ display: 'block' }}>
                <div className="bt-row">
                  <button type="button" className="ops-what bt-row-main" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <span><strong>{r.storeName}</strong> · <bdi dir="ltr" className="mm">{r.reference}</bdi></span>
                    <span>{formatDateTime(r.createdAt, lang)} · {pick(planByCode(r.plan).name)} {r.cycle === 'annual' ? t('سنوي', 'annual') : t('شهري', 'monthly')} · <bdi className="num">{formatMoney(r.totalMinor, r.currency, lang)}</bdi> · {r.senderName}{r.hasReceipt ? '' : ` · ${t('بلا إيصال', 'no receipt')}`}</span>
                  </button>
                  <Badge tone={TONE[r.status]}>{pick(TRANSFER_STATUS_LABEL[r.status])}</Badge>
                </div>
                {open === r.id && <Detail id={r.id} onChanged={() => {
                  // the decided request leaves the "to review" list: show it under All, still open
                  setFilter('all'); setVersion((v) => v + 1);
                  window.dispatchEvent(new Event(TRANSFERS_CHANGED));
                }} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** The receipt inline: a picture shown, a PDF behind a button; both downloadable. Fetched with the staff session. */
function ReceiptView({ detail }: { detail: AdminTransferDetail }) {
  const { t } = useLang();
  const auth = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!detail.receipt) return;
    let live = true;
    let made: string | null = null;
    auth.admin.transferReceipt(detail.id).then((blob) => { if (live) { made = URL.createObjectURL(blob); setUrl(made); } }, () => { if (live) setFailed(true); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [auth.admin, detail.id, detail.receipt]);
  if (!detail.receipt) return <p className="bt-say is-warn"><AlertTriangle size={15} aria-hidden /> {t('لم يُرفق إيصال — تحقق من كشف الحساب بالمبلغ واسم المحوِّل.', 'No receipt attached — check the statement for the amount and the sender’s name.')}</p>;
  if (failed) return <p className="field-error">{t('تعذّر فتح الإيصال.', 'The receipt could not be opened.')}</p>;
  if (!url) return <Loading rows={2} />;
  const isPdf = detail.receipt.type === 'application/pdf';
  return (
    <div className="bt-receipt-view">
      {isPdf
        ? <div className="bt-receipt-pdf"><FileText size={40} aria-hidden /><span>PDF · {(detail.receipt.bytes / 1024).toFixed(0)} KB</span></div>
        // eslint-disable-next-line @next/next/no-img-element -- a private blob fetched with the staff session, not a public image
        : <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={t('إيصال التحويل', 'Transfer receipt')} /></a>}
      <div className="btn-row">
        <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden />{t('افتح', 'Open')}</a>
        <a className="btn btn-ghost btn-sm" href={url} download={`${detail.reference}-receipt.${isPdf ? 'pdf' : detail.receipt.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'}`}><Download size={14} aria-hidden />{t('حمّل', 'Download')}</a>
      </div>
    </div>
  );
}

type Mode = 'approve' | 'reject' | 'request_info' | 'note' | null;

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [detail, setDetail] = useState<AdminTransferDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    auth.admin.bankTransfer(id).then((d) => { if (live) setDetail(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, id]);

  if (error) return <div style={{ marginTop: 12 }}><ErrorNote error={error} /></div>;
  if (!detail) return <div style={{ marginTop: 12 }}><Loading rows={3} /></div>;

  const money = (minor: number) => formatMoney(minor, detail.currency, lang);
  const open = detail.status === 'pending' || detail.status === 'info_requested';
  const choose = (m: Mode) => { setMode(m); setMessage(''); setNote(''); setConfirmed(false); setError(null); };
  const decide = async () => {
    if (!mode) return;
    setBusy(true); setError(null);
    try {
      const next = mode === 'approve'
        ? await auth.admin.decideTransfer(id, { action: 'approve', confirmed, note: note.trim() || null })
        : mode === 'reject'
          ? await auth.admin.decideTransfer(id, { action: 'reject', message: message.trim(), note: note.trim() || null })
          : mode === 'request_info'
            ? await auth.admin.decideTransfer(id, { action: 'request_info', message: message.trim() })
            : await auth.admin.decideTransfer(id, { action: 'note', note: note.trim() });
      setDetail(next);
      setDone(mode === 'approve' ? t('قُبل التحويل: فُعّل الاشتراك وصدرت الفاتورة وأُبلغ المتجر.', 'Approved: the plan is on, the invoice issued and the store told.')
        : mode === 'reject' ? t('رُفض الطلب وأُبلغ المتجر بالسبب.', 'Declined; the store was told why.')
          : mode === 'request_info' ? t('أُرسل طلبك إلى المتجر.', 'Your request was sent to the store.') : t('حُفظت الملاحظة.', 'Note saved.'));
      setMode(null);
      onChanged();
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  };

  return (
    <div className="bt-detail">
      {done && <p role="status" className="plan-notice">{done}</p>}
      <div className="bt-detail-grid">
        <section aria-label={t('الطلب', 'The request')}>
          <h3 className="bt-h">{t('الطلب', 'The request')}</h3>
          <dl className="bt-facts">
            <div><dt>{t('المرجع', 'Reference')}</dt><dd><CopyField label={t('المرجع', 'Reference')} value={detail.reference} /></dd></div>
            <div><dt>{t('المتجر', 'Store')}</dt><dd><AppLink href={`/admin/stores/${detail.store.id}`}>{detail.store.name}</AppLink> <span className="hint">({detail.store.slug} · {pick(STORE_STATUS[detail.store.status] ?? { ar: detail.store.status, en: detail.store.status })})</span></dd></div>
            <div><dt>{t('الباقة الحالية', 'Current plan')}</dt><dd>{detail.current.plan ? `${pick(planByCode(detail.current.plan).name)} · ${detail.current.status ? pick(SUB_STATUS[detail.current.status] ?? { ar: detail.current.status, en: detail.current.status }) : ''}${detail.current.periodEnd ? ` · ${t('حتى', 'until')} ${formatDate(detail.current.periodEnd, lang)}` : ''}` : t('تجربة / لا اشتراك', 'Trial / none')}</dd></div>
            <div><dt>{t('المطلوب', 'Requested')}</dt><dd><strong>{pick(planByCode(detail.plan).name)}</strong> · {detail.cycle === 'annual' ? t('سنوي', 'annual') : t('شهري', 'monthly')}</dd></div>
            <div><dt>{t('السعر', 'Price')}</dt><dd className="num">{money(detail.unitPriceMinor)}{detail.discountMinor ? ` − ${money(detail.discountMinor)} (${detail.couponCode})` : ''}{detail.freeMonths ? ` · ${t(`${detail.freeMonths} أشهر مجانًا`, `${detail.freeMonths} free months`)}` : ''}</dd></div>
            <div><dt>{t('الضريبة', 'VAT')}</dt><dd className="num">{money(detail.vatMinor)}</dd></div>
            <div className="bt-total"><dt>{t('المبلغ المتوقع في الحساب', 'Amount expected in the account')}</dt><dd className="num"><strong>{money(detail.totalMinor)}</strong></dd></div>
            <div><dt>{t('إلى حساب', 'To account')}</dt><dd>{lang === 'ar' ? detail.bank.bankNameAr : detail.bank.bankName} · <span dir="ltr" className="mm">{detail.bank.ibanDisplay}</span></dd></div>
            <div><dt>{t('المحوِّل', 'Sent by')}</dt><dd>{detail.senderName}{detail.senderBank ? ` · ${detail.senderBank}` : ''}{detail.transferredOn ? ` · ${detail.transferredOn}` : ''}</dd></div>
            {detail.company && <div><dt>{t('الفاتورة باسم', 'Invoice to')}</dt><dd>{detail.company.name} · {t('ضريبي', 'VAT')} <span dir="ltr">{detail.company.vatNumber ?? '—'}</span> · {t('سجل', 'CR')} <span dir="ltr">{detail.company.crNumber ?? '—'}</span></dd></div>}
            {detail.note && <div><dt>{t('ملاحظة المتجر', 'Store’s note')}</dt><dd dir="auto">{detail.note}</dd></div>}
            {detail.staffNote && <div><dt>{t('ملاحظة الموظفين', 'Staff note')}</dt><dd dir="auto">{detail.staffNote}</dd></div>}
            {detail.invoiceNumber && <div><dt>{t('الفاتورة', 'Invoice')}</dt><dd><AppLink href={`/admin/invoices/${detail.invoiceId}`} dir="ltr">{detail.invoiceNumber}</AppLink></dd></div>}
          </dl>
          {detail.preview && (
            <p className="bt-say">{detail.preview.extends
              ? t(`القبول يمدّ الاشتراك من نهاية المدة الحالية حتى ${formatDate(detail.preview.end, lang)}.`, `Approving extends the plan from the end of the current period to ${formatDate(detail.preview.end, lang)}.`)
              : t(`القبول يفعّل الباقة من اليوم حتى ${formatDate(detail.preview.end, lang)}${detail.preview.carriedDays ? ` (يشمل ${detail.preview.carriedDays} يومًا منقولة من الباقة السابقة)` : ''}.`, `Approving starts the plan today until ${formatDate(detail.preview.end, lang)}${detail.preview.carriedDays ? ` (including ${detail.preview.carriedDays} days carried from the previous plan)` : ''}.`)}</p>
          )}
        </section>
        <section aria-label={t('الإيصال', 'Receipt')}>
          <h3 className="bt-h">{t('الإيصال', 'Receipt')}</h3>
          <ReceiptView detail={detail} />
          <h3 className="bt-h">{t('السجل', 'Timeline')}</h3>
          <TransferTimeline transfer={detail} />
        </section>
      </div>

      <div className="btn-row">
        {open && <button type="button" className={`btn btn-sm ${mode === 'approve' ? 'btn-primary' : 'btn-accent'}`} onClick={() => choose('approve')}><CheckCircle2 size={15} aria-hidden />{t('اقبل التحويل', 'Approve')}</button>}
        {open && <button type="button" className="btn btn-ghost btn-sm" onClick={() => choose('reject')}><XCircle size={15} aria-hidden />{t('ارفض', 'Decline')}</button>}
        {detail.status === 'pending' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => choose('request_info')}><MessageSquare size={15} aria-hidden />{t('اطلب معلومة', 'Ask for more')}</button>}
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => choose('note')}><StickyNote size={15} aria-hidden />{t('ملاحظة داخلية', 'Staff note')}</button>
      </div>

      {mode && (
        <div className="bt-decide">
          {mode === 'approve' && (
            <>
              <label className="check-row">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>{t(`تحققت من وصول ${money(detail.totalMinor)} إلى حساب ${lang === 'ar' ? detail.bank.bankNameAr : detail.bank.bankName} من «${detail.senderName}».`, `I checked that ${money(detail.totalMinor)} reached the ${detail.bank.bankName} account from “${detail.senderName}”.`)}</span>
              </label>
              <label className="field"><span>{t('ملاحظة داخلية (اختياري)', 'Staff note (optional)')}</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={t('مثال: ظهر في كشف 10 أكتوبر', 'e.g. seen on the 10 Oct statement')} /></label>
            </>
          )}
          {mode === 'reject' && (
            <>
              <div className="bt-presets" aria-label={t('أسباب شائعة', 'Common reasons')}>
                {REJECTION_PRESETS.map((p) => <button key={p.key} type="button" className="btn btn-ghost btn-sm" onClick={() => setMessage(pick(p.text))}>{pick(p.text)}</button>)}
              </div>
              <label className="field"><span>{t('السبب كما سيقرؤه المتجر (يُرسل بالبريد)', 'The reason, as the store will read it (emailed)')}</span><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} /></label>
              <label className="field"><span>{t('ملاحظة داخلية (اختياري)', 'Staff note (optional)')}</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></label>
            </>
          )}
          {mode === 'request_info' && (
            <label className="field"><span>{t('ما الذي تحتاجه من المتجر؟ (يُرسل بالبريد)', 'What do you need from the store? (emailed)')}</span><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder={t('مثال: الإيصال مقصوص — أرفق الصفحة كاملة.', 'e.g. The receipt is cut off — attach the whole page.')} /></label>
          )}
          {mode === 'note' && (
            <label className="field"><span>{t('ملاحظة للموظفين فقط — لا يراها المتجر', 'For staff only — the store never sees it')}</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></label>
          )}
          {error && <ErrorNote error={error} />}
          <div className="btn-row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void decide()}
              disabled={busy || (mode === 'approve' && !confirmed) || ((mode === 'reject' || mode === 'request_info') && message.trim().length < 5) || (mode === 'note' && note.trim().length < 2)}>
              {busy ? t('لحظة…', 'One moment…') : mode === 'approve' ? t('اقبل وفعّل الاشتراك', 'Approve and switch the plan on') : mode === 'reject' ? t('ارفض وأبلغ المتجر', 'Decline and tell the store') : mode === 'request_info' ? t('أرسل الطلب إلى المتجر', 'Send to the store') : t('احفظ الملاحظة', 'Save the note')}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setMode(null)}>{t('إلغاء', 'Cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
