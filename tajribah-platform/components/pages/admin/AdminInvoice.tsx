'use client';

// ADM-19 — Invoice detail, as the store sees it (A7)

import { useEffect, useState } from 'react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useAuth, type AdminApi } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { ErrorNote, Loading, Panel } from '@/components/dashboard/ui';
import { Document as InvoicePaper } from '@/components/pages/InvoiceView';

export default function AdminInvoice() {
  const { t } = useLang();
  return <AdminShell title={t('فاتورة', 'Invoice')}><Detail /></AdminShell>;
}

function Detail() {
  const { t, lang } = useLang();
  const auth = useAuth();
  const env = useEnv();
  const id = env.path.split('/').filter(Boolean).pop() ?? '';
  const [data, setData] = useState<{ id: string; found: Awaited<ReturnType<AdminApi['invoice']>> } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.invoice(id).then((found) => { if (live) setData({ id, found }); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, id]);

  if (error) return <ErrorNote error={error} />;
  if (!data || data.id !== id) return <Panel><Loading rows={6} /></Panel>;
  const { store, invoice } = data.found;
  return (
    <>
      <p style={{ marginTop: 0 }} className="no-print">
        {t('فاتورة متجر ', 'An invoice of ')}<AppLink href={`/admin/stores/${store.id}`}>{lang === 'ar' ? store.nameAr ?? store.name : store.name}</AppLink>{t(' — كما يراها المتجر.', ', as the store sees it.')}
      </p>
      <InvoicePaper invoice={invoice} sample={false} backHref="/admin/billing" />
    </>
  );
}
