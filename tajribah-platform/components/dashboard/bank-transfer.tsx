'use client';

/**
 * T129 — paying by bank transfer, the store's screens: the transfer form inside the checkout (the account to send to,
 * with copy buttons; the receipt; who sent it; buying for a company), and the request's status card on the Billing
 * page (under review, more asked for — send it again, declined, approved), with its timeline and the history.
 *
 * Amounts, the account and the rules come from the server (`BillingSummary.checkout`, `.transfers`); nothing here is
 * trusted by it — the server prices the request and judges the receipt again.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Building2, CheckCircle2, Clock, Copy, FileText, Landmark, Paperclip, Receipt, Send, Trash2, Upload, X, XCircle } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { ApiError } from '@/lib/api-client';
import { RECEIPT_ACCEPT, RECEIPT_MAX_BYTES, TRANSFER_STATUS_LABEL, isOpen, receiptTypeOf, type TransferView } from '@/lib/contracts/bank-transfer';
import { useData, type TransferRequestInput } from '@/lib/data';
import { formatDate, formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import type { Lang } from '@/lib/lang';
import { formatMoney } from '@/lib/money';
import type { BankAccountView, CheckoutOptions } from '@/lib/payment-methods';
import { planByCode, type PlanCode } from '@/lib/plans';
import { inArabic } from '@/lib/problem-text';
import { Badge } from '@/components/dashboard/ui';

/** The server's words for transfer refusals, in Arabic. */
const TRANSFER_AR: [RegExp, string][] = [
  [/already has a transfer/, 'لديك طلب تحويل قيد المراجعة — تابعه في هذه الصفحة أو ألغه أولًا'],
  [/name on the account/, 'اكتب الاسم كما يظهر في الحساب الذي حُوّل منه المبلغ'],
  [/the day you sent it/, 'تاريخ التحويل: اليوم أو خلال آخر 60 يومًا'],
  [/attach the transfer receipt/, 'أرفق إيصال التحويل'],
  [/PNG, JPEG, WebP picture or a PDF/, 'الإيصال صورة (PNG أو JPEG أو WebP) أو ملف PDF'],
  [/10 MB at most/, 'حجم الإيصال 10 ميغابايت على الأكثر'],
  [/the file is empty/, 'الملف فارغ'],
  [/upload (it|the receipt) again|has not arrived yet|has expired/, 'ارفع الإيصال مرة أخرى'],
  [/legal name/, 'اكتب الاسم القانوني للمنشأة'],
  [/VAT number is 15 digits/, 'الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ 3'],
  [/CR number is 10 digits/, 'السجل التجاري 10 أرقام'],
  [/choose one of the accounts/, 'اختر أحد الحسابات المعروضة'],
  [/not offered at the moment/, 'التحويل البنكي غير متاح حاليًا'],
  [/not sold by transfer/, 'هذه الباقة لا تُشترى بالتحويل — تواصل معنا'],
  [/not waiting for anything/, 'هذا الطلب لا ينتظر شيئًا منك'],
  [/only a request under review/, 'يمكن إلغاء الطلب قيد المراجعة فقط'],
  [/Too many|rate/i, 'محاولات كثيرة، حاول بعد قليل'],
  [/did not reach storage/, 'لم يصل الإيصال، حاول مرة أخرى'],
];
const say = (message: string, lang: Lang) => (lang === 'ar' ? TRANSFER_AR.find(([p]) => p.test(message))?.[1] ?? inArabic(message) : message);

/** Field errors from a refusal, each in the reader's language; `form` holds the rest. */
function errorsOf(error: unknown, lang: Lang): Record<string, string> {
  if (error instanceof ApiError && error.fields && Object.keys(error.fields).length) {
    return Object.fromEntries(Object.entries(error.fields).map(([k, v]) => [k, say(v[0] ?? '', lang)]));
  }
  return { form: say((error as Error).message, lang) };
}

export function CopyField({ label, value, display, mono = true }: { label: string; value: string; display?: string; mono?: boolean }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the value can still be selected */ }
  };
  return (
    <div className="bt-field">
      <span className="bt-field-label">{label}</span>
      <span className="bt-field-value">
        <span dir="ltr" className={mono ? 'mm' : undefined}>{display ?? value}</span>
        <button type="button" className="icon-btn" onClick={() => void copy()} aria-label={t(`انسخ ${label}`, `Copy ${label}`)} title={copied ? t('نُسخ', 'Copied') : t('انسخ', 'Copy')}>
          {copied ? <CheckCircle2 size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
        </button>
      </span>
    </div>
  );
}

function AccountCard({ account, amount }: { account: BankAccountView; amount?: string }) {
  const { t, lang } = useLang();
  return (
    <div className="bt-account">
      <div className="bt-account-head"><Landmark size={18} aria-hidden /><strong>{lang === 'ar' ? account.bankNameAr : account.bankName}</strong></div>
      <div className="bt-account-grid">
        <CopyField label={t('صاحب الحساب', 'Account holder')} value={account.accountHolder} mono={false} />
        <CopyField label={t('رقم الحساب', 'Account number')} value={account.accountNumber} />
        <CopyField label={t('رقم الآيبان', 'IBAN')} value={account.iban} display={account.ibanDisplay} />
        {account.swift && <CopyField label="SWIFT / BIC" value={account.swift} />}
        {amount && <CopyField label={t('المبلغ المطلوب تحويله', 'Amount to transfer')} value={amount} mono={false} />}
      </div>
    </div>
  );
}

/** Pick a receipt: click or drop; a picture shows small, a PDF by its name. Checked here for type and size only. */
export function ReceiptPicker({ file, onFile, error, required }: { file: File | null; onFile: (file: File | null) => void; error?: string; required: boolean }) {
  const { t } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const id = useId();
  const take = (f: File | undefined | null) => {
    if (!f) return;
    if (!receiptTypeOf(f)) { setProblem(t('الإيصال صورة (PNG أو JPEG أو WebP) أو ملف PDF', 'A receipt is a PNG, JPEG, WebP picture or a PDF')); return; }
    if (f.size > RECEIPT_MAX_BYTES) { setProblem(t('حجم الإيصال 10 ميغابايت على الأكثر', 'A receipt is 10 MB at most')); return; }
    setProblem(null);
    onFile(f);
  };
  const shown = problem ?? error;
  return (
    <div className="bt-receipt">
      <span className="bt-field-label" id={`${id}-l`}>{t('إيصال التحويل', 'Transfer receipt')}{required && <span className="req" aria-hidden> *</span>}</span>
      {file ? (
        <div className="bt-receipt-file">
          {preview ? <img src={preview} alt={t('معاينة الإيصال', 'Receipt preview')} /> : <FileText size={34} aria-hidden />}
          <div>
            <strong dir="ltr">{file.name}</strong>
            <span className="hint" style={{ margin: 0 }}>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFile(null)}><Trash2 size={14} aria-hidden />{t('أزل', 'Remove')}</button>
        </div>
      ) : (
        <button type="button" className={`bt-drop${over ? ' is-over' : ''}`} aria-labelledby={`${id}-l`} aria-describedby={`${id}-h`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}>
          <Upload size={26} aria-hidden />
          <span>{t('اضغط لإرفاق صورة الإيصال أو اسحبها هنا', 'Click to attach the receipt, or drop it here')}</span>
          <span className="hint" id={`${id}-h`} style={{ margin: 0 }}>PNG · JPEG · WebP · PDF — {t('حتى 10 ميغابايت', 'up to 10 MB')}</span>
        </button>
      )}
      <input ref={input} type="file" accept={RECEIPT_ACCEPT} hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      {shown && <span className="field-error" role="alert">{shown}</span>}
    </div>
  );
}

function Field({ label, error, hint, children, required, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; required?: boolean; htmlFor: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

const riyadhToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/**
 * The transfer form, inside the checkout: everything the store needs to send the money, then what staff need to
 * find it. `quote` is the checkout's (the server prices it again).
 */
export function BankTransferForm({ options, plan, cycle, couponCode, totalMinor, currency, onSent }: {
  options: NonNullable<CheckoutOptions['bankTransfer']>; plan: PlanCode; cycle: 'monthly' | 'annual'; couponCode: string | null;
  totalMinor: number; currency: string; onSent: (transfer: TransferView) => void;
}) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [accountId, setAccountId] = useState(options.accounts[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [sender, setSender] = useState('');
  const [senderBank, setSenderBank] = useState('');
  const [day, setDay] = useState('');
  const [note, setNote] = useState('');
  const [company, setCompany] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [vat, setVat] = useState('');
  const [cr, setCr] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const id = useId();
  const account = options.accounts.find((a) => a.id === accountId) ?? options.accounts[0];
  const total = formatMoney(totalMinor, currency, lang);
  if (!account) return null;

  const send = async () => {
    const local: Record<string, string> = {};
    if (sender.trim().length < 3) local.senderName = t('اكتب الاسم كما يظهر في الحساب الذي حُوّل منه المبلغ', 'The name on the account the money came from');
    if (options.config.receiptRequired && !file) local.receipt = t('أرفق إيصال التحويل', 'Attach the transfer receipt');
    if (company && companyName.trim().length < 2) local.companyName = t('اكتب الاسم القانوني للمنشأة', 'The company’s legal name');
    if (Object.keys(local).length) { setErrors(local); return; }
    setSending(true); setErrors({});
    try {
      const input: TransferRequestInput = {
        plan, cycle, couponCode, bankAccountId: account.id, senderName: sender.trim(), senderBank: senderBank.trim() || null,
        transferredOn: day || null, note: note.trim() || null,
        company: company ? { name: companyName.trim(), vatNumber: vat.trim() || null, crNumber: cr.trim() || null } : null,
      };
      onSent(await source.submitTransfer(input, file));
    } catch (error) {
      setErrors(errorsOf(error, lang));
    } finally { setSending(false); }
  };

  return (
    <div className="bt-form">
      {options.config.instructions && (pick(options.config.instructions).trim()) && <p className="bt-instructions">{pick(options.config.instructions)}</p>}
      <ol className="bt-steps">
        <li><strong>{t('حوّل المبلغ', 'Send the money')}</strong> — {t(`حوّل ${total} إلى الحساب أدناه. اكتب اسم متجرك في ملاحظة التحويل إن أمكن.`, `Transfer ${total} to the account below. Put your store’s name in the transfer note if you can.`)}</li>
        <li><strong>{t('أرفق الإيصال', 'Attach the receipt')}</strong> — {t('صورة أو PDF من تطبيق البنك.', 'A screenshot or PDF from your bank’s app.')}</li>
        <li><strong>{t('أرسل الطلب', 'Send the request')}</strong> — {t(`نراجعه خلال ${options.config.reviewHours} ساعة عمل تقريبًا ونفعّل اشتراكك ونرسل الفاتورة.`, `We check it within about ${options.config.reviewHours} working hours, switch your plan on and send the invoice.`)}</li>
      </ol>

      {options.accounts.length > 1 && (
        <Field label={t('اختر حساب تجربة', 'Choose Tajribah’s account')} htmlFor={`${id}-acc`} error={errors.bankAccountId}>
          <select id={`${id}-acc`} value={account.id} onChange={(e) => setAccountId(e.target.value)}>
            {options.accounts.map((a) => <option key={a.id} value={a.id}>{lang === 'ar' ? a.bankNameAr : a.bankName} — {a.accountHolder}</option>)}
          </select>
        </Field>
      )}
      <AccountCard account={account} amount={total} />

      <div className="bt-form-grid">
        <ReceiptPicker file={file} onFile={(f) => { setFile(f); setErrors((e) => ({ ...e, receipt: '' })); }} error={errors.receipt} required={options.config.receiptRequired} />
        <div className="bt-form-fields">
          <Field label={t('اسم صاحب الحساب الذي حُوّل منه', 'Name on the account you sent from')} htmlFor={`${id}-sender`} error={errors.senderName} required
            hint={t('كما يظهر في كشف حساب البنك، لنطابق التحويل.', 'As your bank statement shows it, so we can match the transfer.')}>
            <input id={`${id}-sender`} value={sender} onChange={(e) => { setSender(e.target.value); if (errors.senderName) setErrors((x) => ({ ...x, senderName: '' })); }} maxLength={140} autoComplete="name" placeholder={t('أدخل الاسم', 'Enter the name')} />
          </Field>
          <div className="bt-two">
            <Field label={t('البنك المحوِّل (اختياري)', 'Your bank (optional)')} htmlFor={`${id}-bank`} error={errors.senderBank}>
              <input id={`${id}-bank`} value={senderBank} onChange={(e) => setSenderBank(e.target.value)} maxLength={80} />
            </Field>
            <Field label={t('تاريخ التحويل (اختياري)', 'Transfer date (optional)')} htmlFor={`${id}-day`} error={errors.transferredOn}>
              <input id={`${id}-day`} type="date" dir="ltr" value={day} max={riyadhToday()} onChange={(e) => setDay(e.target.value)} />
            </Field>
          </div>
        </div>
      </div>

      <div className="bt-company">
        <label className="check-row">
          <input type="checkbox" checked={company} onChange={(e) => setCompany(e.target.checked)} />
          <span><strong>{t('الشراء لمنشأة', 'Buying for a company')}</strong>
            <span className="hint" style={{ display: 'block', margin: 0 }}>{t('تصدر الفاتورة الضريبية باسم المنشأة ورقمها الضريبي وسجلها التجاري.', 'The tax invoice is issued to the company’s name, VAT number and CR number.')}</span></span>
        </label>
        {company && (
          <div className="bt-company-fields">
            <Field label={t('الاسم القانوني للمنشأة', 'Company legal name')} htmlFor={`${id}-co`} error={errors.companyName} required>
              <input id={`${id}-co`} value={companyName} onChange={(e) => { setCompanyName(e.target.value); if (errors.companyName) setErrors((x) => ({ ...x, companyName: '' })); }} maxLength={200} autoComplete="organization" />
            </Field>
            <div className="bt-two">
              <Field label={t('الرقم الضريبي', 'VAT number')} htmlFor={`${id}-vat`} error={errors.companyVat} hint={t('15 رقمًا', '15 digits')}>
                <input id={`${id}-vat`} dir="ltr" inputMode="numeric" value={vat} onChange={(e) => setVat(e.target.value)} maxLength={20} />
              </Field>
              <Field label={t('السجل التجاري', 'CR number')} htmlFor={`${id}-cr`} error={errors.companyCr} hint={t('10 أرقام', '10 digits')}>
                <input id={`${id}-cr`} dir="ltr" inputMode="numeric" value={cr} onChange={(e) => setCr(e.target.value)} maxLength={14} />
              </Field>
            </div>
          </div>
        )}
      </div>

      <Field label={t('ملاحظة لفريق تجربة (اختياري)', 'A note for the Tajribah team (optional)')} htmlFor={`${id}-note`} error={errors.note}>
        <textarea id={`${id}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>

      {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
      {errors.plan && <p className="field-error" role="alert">{errors.plan}</p>}
      <button type="button" className="btn btn-primary bt-submit" onClick={() => void send()} disabled={sending}>
        <Send size={16} aria-hidden />{sending ? t('جارٍ الإرسال…', 'Sending…') : t(`أرسل طلب التحويل — ${total}`, `Send the transfer request — ${total}`)}
      </button>
    </div>
  );
}

const STATUS_TONE: Record<TransferView['status'], 'warn' | 'ok' | 'bad' | 'neutral' | 'accent'> = {
  pending: 'warn', info_requested: 'accent', approved: 'ok', rejected: 'bad', cancelled: 'neutral',
};

const EVENT_LABEL: Record<TransferView['events'][number]['type'], { ar: string; en: string }> = {
  submitted: { ar: 'أُرسل الطلب', en: 'Request sent' },
  info_requested: { ar: 'طلب فريق تجربة معلومة إضافية', en: 'Tajribah asked for more' },
  resubmitted: { ar: 'أُعيد إرسال الطلب', en: 'Sent again' },
  approved: { ar: 'قُبل التحويل وفُعّل الاشتراك', en: 'Approved — plan switched on' },
  rejected: { ar: 'رُفض التحويل', en: 'Declined' },
  cancelled: { ar: 'أُلغي الطلب', en: 'Cancelled' },
  note: { ar: 'ملاحظة', en: 'Note' },
};

export function TransferTimeline({ transfer }: { transfer: TransferView }) {
  const { pick, lang } = useLang();
  return (
    <ol className="bt-timeline">
      {transfer.events.map((e) => (
        <li key={e.id} className={`bt-event is-${e.type}`}>
          <span className="bt-event-dot" aria-hidden />
          <div>
            <strong>{pick(EVENT_LABEL[e.type])}</strong>
            <span className="hint" style={{ margin: 0 }}> · {formatDateTime(e.at, lang)}</span>
            {e.message && <p className="bt-event-message">{e.message}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Opens the store's own receipt in a new tab (fetched with the session, never a public link). */
function ReceiptButton({ transfer }: { transfer: TransferView }) {
  const { t } = useLang();
  const source = useData();
  const [busy, setBusy] = useState(false);
  if (!transfer.receipt) return null;
  const open = async () => {
    setBusy(true);
    const tab = window.open('', '_blank');
    try {
      const blob = await source.transferReceipt(transfer.id);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url; else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { tab?.close(); } finally { setBusy(false); }
  };
  return <button type="button" className="btn btn-ghost btn-sm" onClick={() => void open()} disabled={busy}><Paperclip size={14} aria-hidden />{t('الإيصال', 'Receipt')}</button>;
}

/** After staff asked for more: correct the sender, attach a new receipt, add a note — and send it again. */
function Resubmit({ transfer, onDone }: { transfer: TransferView; onDone: () => void }) {
  const { t, lang } = useLang();
  const source = useData();
  const [file, setFile] = useState<File | null>(null);
  const [sender, setSender] = useState(transfer.senderName);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const id = useId();
  const send = async () => {
    setBusy(true); setErrors({});
    try {
      await source.resubmitTransfer(transfer.id, { senderName: sender.trim() !== transfer.senderName ? sender.trim() : undefined, note: note.trim() || null }, file);
      onDone();
    } catch (error) { setErrors(errorsOf(error, lang)); } finally { setBusy(false); }
  };
  return (
    <div className="bt-resubmit">
      <ReceiptPicker file={file} onFile={setFile} error={errors.receipt} required={false} />
      <div className="bt-form-fields">
        <Field label={t('اسم صاحب الحساب الذي حُوّل منه', 'Name on the account you sent from')} htmlFor={`${id}-s`} error={errors.senderName}>
          <input id={`${id}-s`} value={sender} onChange={(e) => setSender(e.target.value)} maxLength={140} />
        </Field>
        <Field label={t('ردّك على فريق تجربة', 'Your reply to the Tajribah team')} htmlFor={`${id}-n`} error={errors.note}>
          <textarea id={`${id}-n`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
        <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy || (!file && !note.trim() && sender.trim() === transfer.senderName)}>
          <Send size={15} aria-hidden />{busy ? t('جارٍ الإرسال…', 'Sending…') : t('أعد إرسال الطلب', 'Send it again')}
        </button>
      </div>
    </div>
  );
}

/** The request that matters now (open, or decided in the last two weeks), on the Billing page. */
export function TransferStatus({ transfer, onChanged, onNew }: { transfer: TransferView; onChanged: () => void; onNew: () => void }) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = planByCode(transfer.plan).name;
  const money = (minor: number) => formatMoney(minor, transfer.currency, lang);
  const cancel = async () => {
    if (!window.confirm(t('إلغاء طلب التحويل؟ إن كنت حوّلت المبلغ فتواصل معنا لاسترداده.', 'Cancel this transfer request? If you already sent the money, contact us to get it back.'))) return;
    setBusy(true); setError(null);
    try { await source.cancelTransfer(transfer.id); onChanged(); } catch (e) { setError(say((e as Error).message, lang)); } finally { setBusy(false); }
  };
  const icon = transfer.status === 'approved' ? <CheckCircle2 size={20} aria-hidden /> : transfer.status === 'rejected' ? <XCircle size={20} aria-hidden /> : transfer.status === 'cancelled' ? <X size={20} aria-hidden /> : <Clock size={20} aria-hidden />;

  return (
    <section className={`panel bt-status is-${transfer.status}`} aria-labelledby={`bt-${transfer.id}`}>
      <div className="bt-status-head">
        {icon}
        <h2 id={`bt-${transfer.id}`}>{t('طلب الاشتراك بالتحويل البنكي', 'Bank transfer request')}</h2>
        <Badge tone={STATUS_TONE[transfer.status]}>{pick(TRANSFER_STATUS_LABEL[transfer.status])}</Badge>
      </div>
      <div className="bt-status-body">
        <dl className="bt-facts">
          <div><dt>{t('المرجع', 'Reference')}</dt><dd><CopyField label={t('المرجع', 'Reference')} value={transfer.reference} /></dd></div>
          <div><dt>{t('الباقة', 'Plan')}</dt><dd>{pick(plan)} · {transfer.cycle === 'annual' ? t('سنوي', 'annual') : t('شهري', 'monthly')}</dd></div>
          <div><dt>{t('المبلغ', 'Amount')}</dt><dd className="num">{money(transfer.totalMinor)} <span className="hint">{t('شامل الضريبة', 'incl. VAT')}</span></dd></div>
          <div><dt>{t('إلى', 'To')}</dt><dd>{lang === 'ar' ? transfer.bank.bankNameAr : transfer.bank.bankName} · <span dir="ltr" className="mm">{transfer.bank.ibanDisplay}</span></dd></div>
          <div><dt>{t('من', 'From')}</dt><dd>{transfer.senderName}{transfer.transferredOn ? ` · ${transfer.transferredOn}` : ''}</dd></div>
          {transfer.company && <div><dt>{t('الفاتورة باسم', 'Invoice to')}</dt><dd><Building2 size={14} aria-hidden /> {transfer.company.name}</dd></div>}
        </dl>

        {transfer.status === 'pending' && <p className="bt-say">{t('نراجع التحويل الآن، ونفعّل اشتراكك فور التحقق من وصول المبلغ — ستصلك رسالة.', 'We are checking the transfer and switch your plan on as soon as the money is confirmed — you will get a message.')}</p>}
        {transfer.status === 'info_requested' && (
          <>
            <div className="bt-ask" role="note"><strong>{t('يحتاج فريق تجربة:', 'The Tajribah team needs:')}</strong><p>{transfer.decisionMessage}</p></div>
            <Resubmit transfer={transfer} onDone={onChanged} />
          </>
        )}
        {transfer.status === 'rejected' && (
          <div className="bt-ask is-bad" role="note"><strong>{t('سبب الرفض:', 'Why it was declined:')}</strong><p>{transfer.decisionMessage}</p></div>
        )}
        {transfer.status === 'approved' && (
          <p className="bt-say">{t('فُعّل اشتراكك', 'Your plan is on')}{transfer.periodEnd ? t(` حتى ${formatDate(transfer.periodEnd, lang)}`, ` until ${formatDate(transfer.periodEnd, lang)}`) : ''}. {t('شكرًا لك.', 'Thank you.')}</p>
        )}

        <div className="btn-row">
          <ReceiptButton transfer={transfer} />
          {transfer.invoiceId && <AppLink href={`/dashboard/billing/invoices/${encodeURIComponent(transfer.invoiceId)}`} className="btn btn-ghost btn-sm"><Receipt size={14} aria-hidden />{t('الفاتورة', 'Invoice')}</AppLink>}
          {isOpen(transfer.status) && <button type="button" className="btn btn-quiet btn-sm" onClick={() => void cancel()} disabled={busy}><X size={14} aria-hidden />{t('ألغِ الطلب', 'Cancel the request')}</button>}
          {(transfer.status === 'rejected' || transfer.status === 'cancelled') && <button type="button" className="btn btn-accent btn-sm" onClick={onNew}><Send size={14} aria-hidden />{t('أرسل طلبًا جديدًا', 'Send a new request')}</button>}
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <details className="bt-details">
          <summary>{t('سجل الطلب', 'Request history')}</summary>
          <TransferTimeline transfer={transfer} />
        </details>
      </div>
    </section>
  );
}

/** Earlier requests, one line each. */
export function TransferHistory({ transfers }: { transfers: TransferView[] }) {
  const { t, pick, lang } = useLang();
  if (!transfers.length) return null;
  return (
    <details className="panel bt-history">
      <summary>{t(`طلبات التحويل السابقة (${transfers.length})`, `Earlier transfer requests (${transfers.length})`)}</summary>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th scope="col">{t('المرجع', 'Reference')}</th><th scope="col">{t('التاريخ', 'Date')}</th><th scope="col">{t('الباقة', 'Plan')}</th><th scope="col">{t('المبلغ', 'Amount')}</th><th scope="col">{t('الحالة', 'Status')}</th></tr></thead>
          <tbody>
            {transfers.map((x) => (
              <tr key={x.id}>
                <td className="num" dir="ltr">{x.reference}</td>
                <td>{formatDate(x.createdAt, lang)}</td>
                <td>{pick(planByCode(x.plan).name)}</td>
                <td className="num">{formatMoney(x.totalMinor, x.currency, lang)}</td>
                <td><Badge tone={STATUS_TONE[x.status]}>{pick(TRANSFER_STATUS_LABEL[x.status])}</Badge>{x.invoiceId && <> <AppLink href={`/dashboard/billing/invoices/${encodeURIComponent(x.invoiceId)}`}>{t('الفاتورة', 'Invoice')}</AppLink></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
