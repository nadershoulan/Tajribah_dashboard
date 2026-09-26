'use client';

// A12 — Support lookup: any id, email, invoice number, name, or request id

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useAuth, type AdminLookup } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { TrailTable } from '@/components/admin/trail';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';
import { STATUS as INVOICE_STATUS } from '@/components/pages/InvoiceView';
import { STATUS_LABEL } from './AdminStores';

export default function AdminSupport() {
  const { t } = useLang();
  const env = useEnv();
  // A link to a request id (from any trail) opens here with it filled in; a new link starts afresh.
  const initial = new URLSearchParams(env.search).get('q') ?? '';
  return <AdminShell title={t('الدعم', 'Support')}><Lookup key={initial} initial={initial} /></AdminShell>;
}

function Lookup({ initial }: { initial: string }) {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [q, setQ] = useState(initial);
  const [asked, setAsked] = useState(initial.trim());
  const [result, setResult] = useState<{ q: string; found: AdminLookup } | null>(null);
  const [error, setError] = useState<{ q: string; error: Error } | null>(null);

  useEffect(() => {
    if (asked.length < 2) return;
    let live = true;
    auth.admin.lookup(asked).then((found) => { if (live) setResult({ q: asked, found }); }, (e: Error) => { if (live) setError({ q: asked, error: e }); });
    return () => { live = false; };
  }, [auth.admin, asked]);

  const found = result?.q === asked ? result.found : null;
  const failed = error?.q === asked ? error.error : null;
  const nothing = found && !found.stores.length && !found.people.length && !found.invoices.length && !found.jobs.length && !found.deliveries.length && !found.request.length;
  const name = (s: { name: string; nameAr: string | null }) => (lang === 'ar' ? s.nameAr ?? s.name : s.name);

  return (
    <div className="ops">
      <Panel title={t('ابحث', 'Look up')} sub={t('معرّف متجر أو شخص أو فاتورة أو مهمة أو إشعار، بريد، رقم فاتورة، اسم أو عنوان متجر — أو رقم الطلب الذي تعرضه رسالة الخطأ.', 'A store, person, invoice, job or delivery id; an email; an invoice number; a name or store address — or the request id an error message shows.')}>
        <form className="support-box" onSubmit={(e) => { e.preventDefault(); setAsked(q.trim()); }}>
          <label className="search">
            <Search size={15} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} dir="auto" placeholder={t('الصق هنا', 'Paste here')} aria-label={t('بحث', 'Search')} maxLength={200} />
          </label>
          <button type="submit" className="btn btn-accent" disabled={q.trim().length < 2}>{t('ابحث', 'Look up')}</button>
        </form>
      </Panel>

      {failed && <ErrorNote error={failed} />}
      {asked.length >= 2 && !found && !failed && <Panel><Loading rows={3} /></Panel>}
      {nothing && <Panel><Empty title={t('لا شيء', 'Nothing found')} body={t('لا متجر ولا شخص ولا فاتورة ولا طلب بهذا.', 'No store, person, invoice or request matches that.')} /></Panel>}

      {found && found.stores.length > 0 && (
        <Panel flush title={t('متاجر', 'Stores')}>
          <ul className="support-hits">{found.stores.map((s) => <li key={s.id}><AppLink href={`/admin/stores/${s.id}`}>{name(s)}</AppLink> <span dir="ltr" className="muted">{s.slug}</span> <Badge>{pick(STATUS_LABEL[s.status as keyof typeof STATUS_LABEL] ?? { ar: s.status, en: s.status })}</Badge></li>)}</ul>
        </Panel>
      )}
      {found && found.people.length > 0 && (
        <Panel flush title={t('أشخاص', 'People')}>
          <ul className="support-hits">{found.people.map((p) => <li key={p.id}><AppLink href={`/admin/people/${p.id}`}>{p.fullName || p.email}</AppLink> <span dir="ltr" className="muted">{p.email}</span></li>)}</ul>
        </Panel>
      )}
      {found && found.invoices.length > 0 && (
        <Panel flush title={t('فواتير', 'Invoices')}>
          <ul className="support-hits">{found.invoices.map((i) => <li key={i.id}><AppLink href={`/admin/invoices/${i.id}`}><span dir="ltr">{i.number}</span></AppLink> · {name(i.store)} <Badge>{pick(INVOICE_STATUS[i.status as keyof typeof INVOICE_STATUS] ?? { ar: i.status, en: i.status })}</Badge></li>)}</ul>
        </Panel>
      )}
      {found && (found.jobs.length > 0 || found.deliveries.length > 0) && (
        <Panel flush title={t('مهام وإشعارات', 'Jobs and deliveries')} sub={t('تُدار من صفحة التشغيل', 'Handled on the Operations page')}>
          <ul className="support-hits">
            {found.jobs.map((j) => <li key={j.id}><span className="mm" dir="ltr">{j.queue}</span> <Badge tone={j.state === 'dead' ? 'bad' : 'neutral'}>{j.state}</Badge> <AppLink href="/admin/operations">{t('التشغيل', 'Operations')}</AppLink></li>)}
            {found.deliveries.map((d) => <li key={d.id}><span className="mm" dir="ltr">{d.provider} · {d.topic}</span> <Badge tone={d.status === 'failed' ? 'bad' : 'neutral'}>{d.status}</Badge> <AppLink href="/admin/operations">{t('التشغيل', 'Operations')}</AppLink></li>)}
          </ul>
        </Panel>
      )}
      {found && found.request.length > 0 && (
        <Panel flush title={t('ما فعله هذا الطلب', 'What this request did')} sub={t('من سجلات المتاجر وسجل الموظفين، بالترتيب — أسماء الحقول دون قيمها', 'From the store trails and the staff trail, in order — field names, not values')}>
          <TrailTable entries={found.request} showStore />
        </Panel>
      )}
    </div>
  );
}
