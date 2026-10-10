'use client';

// T129 — Payment methods: which ways to pay stores see (on/off, order), bank transfer's settings, Tajribah's bank accounts

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CreditCard, Landmark, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { useAuth, type AdminBankAccount, type AdminBankAccountFields, type AdminPaymentSettings } from '@/lib/auth';
import { formatIban, ibanProblem } from '@/lib/contracts/bank-transfer';
import { formatDate } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { paymentMethod } from '@/lib/payment-methods';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

export default function AdminPaymentMethods() {
  const { t } = useLang();
  return <AdminShell title={t('طرق الدفع', 'Payment methods')}><Settings /></AdminShell>;
}

/** Staff changes need words for the staff trail; a quick prompt for one-click changes. */
function askReason(question: string, fallback: string): string | null {
  const r = window.prompt(question, fallback);
  return r && r.trim().length >= 5 ? r.trim() : r === null ? null : (window.alert('≥ 5'), null);
}

function Settings() {
  const { t, pick } = useLang();
  const auth = useAuth();
  const [data, setData] = useState<AdminPaymentSettings | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    auth.admin.paymentSettings().then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin]);

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Panel><Loading rows={5} /></Panel>;

  const act = async (fn: () => Promise<AdminPaymentSettings | unknown>, message: string) => {
    setError(null); setNotice(null);
    try {
      const next = await fn();
      setData(next && typeof next === 'object' && 'methods' in (next as object) ? next as AdminPaymentSettings : await auth.admin.paymentSettings());
      setNotice(message);
    } catch (e) { setError(e as Error); }
  };
  const toggle = (key: string, enabled: boolean) => {
    const name = pick(paymentMethod(key)!.label);
    const reason = askReason(enabled ? t(`سبب تفعيل «${name}»:`, `Why switch “${name}” on?`) : t(`سبب إيقاف «${name}»:`, `Why switch “${name}” off?`), enabled ? t('نفعّلها للمتاجر', 'Offering it to stores') : t('إيقاف مؤقت', 'Pausing it for now'));
    if (reason) void act(() => auth.admin.updatePaymentMethod(key, { enabled, reason }), enabled ? t(`فُعّلت «${name}».`, `“${name}” is on.`) : t(`أُوقفت «${name}».`, `“${name}” is off.`));
  };
  const move = (index: number, by: -1 | 1) => {
    const list = data.methods;
    const other = list[index + by];
    const me = list[index]!;
    if (!other) return;
    void act(async () => {
      await auth.admin.updatePaymentMethod(me.key, { sortOrder: other.sortOrder, reason: 'reordering payment methods' });
      return auth.admin.updatePaymentMethod(other.key, { sortOrder: me.sortOrder, reason: 'reordering payment methods' });
    }, t('تغيّر الترتيب.', 'Order changed.'));
  };

  return (
    <div className="ops">
      {notice && <p role="status" className="plan-notice">{notice}</p>}
      {error && <ErrorNote error={error} />}
      <Panel flush title={t('طرق الدفع المعروضة للمتاجر', 'Ways to pay shown to stores')}
        sub={t('تظهر للمتجر عند الاشتراك الطرق المفعّلة فقط، بهذا الترتيب. الطرق الإلكترونية تُفعَّل بعد ربط بوابتها (Moyasar، تمارا، تابي).', 'Stores see only the methods that are on, in this order. Online methods can be switched on once their gateway is connected (Moyasar, Tamara, Tabby).')}>
        <ul className="ops-list">
          {data.methods.map((m, i) => {
            const info = paymentMethod(m.key)!;
            return (
              <li key={m.key} className="pm-row">
                <span className="pm-icon">{info.kind === 'offline' ? <Landmark size={18} aria-hidden /> : <CreditCard size={18} aria-hidden />}</span>
                <span className="ops-what" style={{ flex: '1 1 220px' }}>
                  <span><strong>{pick(info.label)}</strong> {m.enabled ? <Badge tone="ok" dot>{t('مفعّلة', 'On')}</Badge> : <Badge tone="neutral">{t('موقفة', 'Off')}</Badge>}</span>
                  <span>{pick(info.blurb)}{!m.ready && <> · <strong>{t(`تحتاج ربط ${info.provider === 'moyasar' ? 'Moyasar' : info.provider === 'tamara' ? 'تمارا' : 'تابي'}`, `Needs ${info.provider} connected`)}</strong></>}{m.updatedAt ? ` · ${t('عُدّلت', 'changed')} ${formatDate(m.updatedAt)}` : ''}</span>
                </span>
                <span className="btn-row" style={{ margin: 0 }}>
                  <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('أعلى', 'Up')}><ArrowUp size={15} /></button>
                  <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === data.methods.length - 1} aria-label={t('أسفل', 'Down')}><ArrowDown size={15} /></button>
                  <button type="button" className={`btn btn-sm ${m.enabled ? 'btn-ghost' : 'btn-accent'}`} disabled={!m.ready && !m.enabled} onClick={() => toggle(m.key, !m.enabled)}
                    title={!m.ready ? t('بوابتها غير مربوطة بعد', 'Its gateway is not connected yet') : undefined}>
                    <Power size={14} aria-hidden />{m.enabled ? t('أوقف', 'Switch off') : t('فعّل', 'Switch on')}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <BankTransferSettings data={data} onSaved={(next) => { setData(next); setNotice(t('حُفظت إعدادات التحويل البنكي.', 'Bank transfer settings saved.')); }} />
      <Accounts accounts={data.accounts} onChanged={(message) => void act(() => auth.admin.paymentSettings(), message)} />
    </div>
  );
}

function BankTransferSettings({ data, onSaved }: { data: AdminPaymentSettings; onSaved: (next: AdminPaymentSettings) => void }) {
  const { t } = useLang();
  const auth = useAuth();
  const c = data.bankTransfer;
  const [grace, setGrace] = useState(String(c.graceDays));
  const [reminders, setReminders] = useState(c.reminderDays.join(', '));
  const [hours, setHours] = useState(String(c.reviewHours));
  const [receipt, setReceipt] = useState(c.receiptRequired);
  const [emails, setEmails] = useState(c.notifyEmails.join('\n'));
  const [insAr, setInsAr] = useState(c.instructions?.ar ?? '');
  const [insEn, setInsEn] = useState(c.instructions?.en ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      onSaved(await auth.admin.updatePaymentMethod('bank_transfer', {
        reason: reason.trim(),
        config: {
          graceDays: Number(grace), reviewHours: Number(hours), receiptRequired: receipt,
          reminderDays: reminders.split(/[\s,،]+/).filter(Boolean).map(Number),
          notifyEmails: emails.split(/[\s,،;]+/).filter(Boolean),
          instructions: insAr.trim() || insEn.trim() ? { ar: insAr.trim(), en: insEn.trim() } : null,
        },
      }));
      setReason('');
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  };
  return (
    <Panel title={t('إعدادات التحويل البنكي', 'Bank transfer settings')}
      sub={t('الاشتراك المدفوع بالتحويل لا يتجدد تلقائيًا: نذكّر المتجر قبل نهايته، ثم يبقى يعمل أيام السماح، ثم يصبح للاطلاع فقط حتى يجدد.', 'A plan paid by transfer does not renew by itself: the store is reminded before it ends, keeps working for the grace days, then becomes read-only until it renews.')}>
      <div className="pm-form">
        <label className="field"><span>{t('أيام السماح بعد نهاية المدة', 'Grace days after the period ends')}</span><input type="number" dir="ltr" min={0} max={30} value={grace} onChange={(e) => setGrace(e.target.value)} /></label>
        <label className="field"><span>{t('التذكير قبل النهاية بـ (أيام)', 'Remind this many days before the end')}</span><input dir="ltr" value={reminders} onChange={(e) => setReminders(e.target.value)} placeholder="7, 2" /></label>
        <label className="field"><span>{t('مدة المراجعة التي تُذكر للمتجر (ساعات)', 'Review time told to the store (hours)')}</span><input type="number" dir="ltr" min={1} max={240} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        <label className="check-row"><input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} /><span>{t('الإيصال مطلوب', 'A receipt is required')}</span></label>
        <label className="field pm-wide"><span>{t('عناوين إضافية تُبلَّغ بكل تحويل (غير حسابات الموظفين)', 'Extra addresses told of each transfer (besides staff accounts)')}</span><textarea rows={2} dir="ltr" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="finance@tajribah.org" /></label>
        <label className="field pm-wide"><span>{t('تعليمات تظهر فوق بيانات الحساب (عربي)', 'Instructions above the account details (Arabic)')}</span><textarea rows={2} dir="rtl" value={insAr} onChange={(e) => setInsAr(e.target.value)} maxLength={1000} /></label>
        <label className="field pm-wide"><span>{t('التعليمات (إنجليزي)', 'Instructions (English)')}</span><textarea rows={2} dir="ltr" value={insEn} onChange={(e) => setInsEn(e.target.value)} maxLength={1000} /></label>
        <label className="field pm-wide"><span>{t('سبب التغيير (سجل الموظفين)', 'Why (for the staff trail)')}</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
      </div>
      {error && <ErrorNote error={error} />}
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={busy || reason.trim().length < 5}>{busy ? t('لحظة…', 'One moment…') : t('احفظ الإعدادات', 'Save settings')}</button>
    </Panel>
  );
}

const EMPTY: AdminBankAccountFields = { bankName: '', bankNameAr: '', accountHolder: '', accountNumber: '', iban: '', swift: '', note: '' };

function AccountForm({ initial, onSave, onCancel, busy }: { initial: AdminBankAccountFields; onSave: (fields: AdminBankAccountFields, reason: string) => void; onCancel: () => void; busy: boolean }) {
  const { t } = useLang();
  const [f, setF] = useState<AdminBankAccountFields>(initial);
  const [reason, setReason] = useState('');
  const set = (k: keyof AdminBankAccountFields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ibanIssue = f.iban.trim() ? ibanProblem(f.iban) : null;
  const ready = f.bankName.trim().length >= 2 && f.bankNameAr.trim().length >= 2 && f.accountHolder.trim().length >= 2 && /^\d{6,24}$/.test(f.accountNumber.replace(/[\s-]/g, '')) && !ibanIssue && !!f.iban.trim() && reason.trim().length >= 5;
  return (
    <div className="pm-form">
      <label className="field"><span>{t('اسم البنك (عربي)', 'Bank name (Arabic)')}</span><input dir="rtl" value={f.bankNameAr} onChange={set('bankNameAr')} placeholder="مصرف الراجحي" /></label>
      <label className="field"><span>{t('اسم البنك (إنجليزي)', 'Bank name (English)')}</span><input dir="ltr" value={f.bankName} onChange={set('bankName')} placeholder="Al Rajhi Bank" /></label>
      <label className="field pm-wide"><span>{t('اسم صاحب الحساب كما يكتبه البنك', 'Account holder, exactly as the bank writes it')}</span><input value={f.accountHolder} onChange={set('accountHolder')} /></label>
      <label className="field"><span>{t('رقم الحساب', 'Account number')}</span><input dir="ltr" inputMode="numeric" value={f.accountNumber} onChange={set('accountNumber')} /></label>
      <label className="field"><span>{t('رقم الآيبان', 'IBAN')}</span><input dir="ltr" value={f.iban} onChange={set('iban')} placeholder="SA00 0000 0000 0000 0000 0000" aria-invalid={!!ibanIssue} />
        {ibanIssue ? <span className="field-error" role="alert">{t('رقم الآيبان غير صحيح — تحقق من كل خانة (SA ثم 22 رقمًا).', `This IBAN is not valid: ${ibanIssue}.`)}</span> : f.iban.trim() ? <span className="field-hint" dir="ltr">✓ {formatIban(f.iban)}</span> : null}</label>
      <label className="field"><span>SWIFT / BIC ({t('اختياري', 'optional')})</span><input dir="ltr" value={f.swift ?? ''} onChange={set('swift')} /></label>
      <label className="field"><span>{t('ملاحظة للموظفين (لا يراها المتجر)', 'Staff note (never shown to stores)')}</span><input value={f.note ?? ''} onChange={set('note')} maxLength={500} /></label>
      <label className="field pm-wide"><span>{t('سبب التغيير (سجل الموظفين)', 'Why (for the staff trail)')}</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
      <div className="btn-row pm-wide">
        <button type="button" className="btn btn-primary btn-sm" disabled={!ready || busy} onClick={() => onSave({ ...f, swift: f.swift?.trim() || null, note: f.note?.trim() || null }, reason.trim())}>{busy ? t('لحظة…', 'One moment…') : t('احفظ الحساب', 'Save the account')}</button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>{t('إلغاء', 'Cancel')}</button>
      </div>
    </div>
  );
}

function Accounts({ accounts, onChanged }: { accounts: AdminBankAccount[]; onChanged: (message: string) => void }) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(null);
    try { await fn(); setEditing(null); onChanged(message); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  };
  return (
    <Panel title={t('حسابات تجربة البنكية', 'Tajribah’s bank accounts')}
      sub={t('يحوّل المتجر إلى أحد الحسابات المفعّلة. يُفحص رقم الآيبان قبل الحفظ. الحساب الذي استُخدم في تحويل لا يُحذف — أوقفه بدلًا من ذلك.', 'Stores transfer to one of the active accounts. The IBAN is checked before it is saved. An account a transfer used cannot be deleted — switch it off instead.')}
      actions={editing !== 'new' ? <button type="button" className="btn btn-accent btn-sm" onClick={() => setEditing('new')}><Plus size={14} aria-hidden />{t('أضف حسابًا', 'Add an account')}</button> : undefined}>
      {error && <ErrorNote error={error} />}
      {editing === 'new' && <AccountForm initial={EMPTY} busy={busy} onCancel={() => setEditing(null)} onSave={(f, reason) => void run(() => auth.admin.createBankAccount({ ...f, reason }), t('أُضيف الحساب.', 'Account added.'))} />}
      {accounts.length === 0 && editing !== 'new' && <Empty title={t('لا حسابات بعد', 'No accounts yet')} body={t('أضف حساب تجربة البنكي ليظهر خيار «تحويل بنكي» للمتاجر.', 'Add Tajribah’s bank account so stores see the “Bank transfer” option.')} />}
      <div className="pm-accounts">
        {accounts.map((a) => editing === a.id ? (
          <AccountForm key={a.id} initial={{ bankName: a.bankName, bankNameAr: a.bankNameAr, accountHolder: a.accountHolder, accountNumber: a.accountNumber, iban: a.iban, swift: a.swift ?? '', note: a.note ?? '' }} busy={busy}
            onCancel={() => setEditing(null)} onSave={(f, reason) => void run(() => auth.admin.updateBankAccount(a.id, { ...f, reason }), t('حُفظ الحساب.', 'Account saved.'))} />
        ) : (
          <article key={a.id} className={`pm-account${a.active ? '' : ' is-off'}`}>
            <header><Landmark size={16} aria-hidden /><strong>{lang === 'ar' ? a.bankNameAr : a.bankName}</strong>{a.active ? <Badge tone="ok" dot>{t('مفعّل', 'Active')}</Badge> : <Badge tone="neutral">{t('موقف', 'Off')}</Badge>}</header>
            <dl>
              <div><dt>{t('صاحب الحساب', 'Holder')}</dt><dd>{a.accountHolder}</dd></div>
              <div><dt>{t('رقم الحساب', 'Account')}</dt><dd dir="ltr" className="mm">{a.accountNumber}</dd></div>
              <div><dt>IBAN</dt><dd dir="ltr" className="mm">{a.ibanDisplay}</dd></div>
              {a.swift && <div><dt>SWIFT</dt><dd dir="ltr" className="mm">{a.swift}</dd></div>}
              {a.note && <div><dt>{t('ملاحظة', 'Note')}</dt><dd>{a.note}</dd></div>}
              <div><dt>{t('استُخدم في', 'Used by')}</dt><dd>{t(`${a.used} تحويل`, `${a.used} transfers`)}</dd></div>
            </dl>
            <div className="btn-row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(a.id)}><Pencil size={14} aria-hidden />{t('عدّل', 'Edit')}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
                const reason = askReason(a.active ? t('سبب إيقاف الحساب:', 'Why switch this account off?') : t('سبب تفعيل الحساب:', 'Why switch this account on?'), a.active ? t('أُغلق الحساب لدى البنك', 'Closed at the bank') : t('الحساب يعمل من جديد', 'The account works again'));
                if (reason) void run(() => auth.admin.updateBankAccount(a.id, { active: !a.active, reason }), a.active ? t('أُوقف الحساب.', 'Account switched off.') : t('فُعّل الحساب.', 'Account switched on.'));
              }}><Power size={14} aria-hidden />{a.active ? t('أوقف', 'Switch off') : t('فعّل', 'Switch on')}</button>
              {a.used === 0 && <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => {
                const reason = askReason(t('سبب حذف الحساب:', 'Why delete this account?'), t('أُضيف بالخطأ', 'Added by mistake'));
                if (reason) void run(() => auth.admin.deleteBankAccount(a.id, reason), t('حُذف الحساب.', 'Account deleted.'));
              }}><Trash2 size={14} aria-hidden />{t('احذف', 'Delete')}</button>}
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
