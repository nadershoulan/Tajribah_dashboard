'use client';

// MD-133 — Invoice detail · MD-134 — Invoice print view (bilingual)

import type { ReactNode } from 'react';
import { Printer } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useResource } from '@/lib/data';
import { formatDate, formatHijri } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import type { InvoiceDocument, InvoiceParty } from '@/lib/contracts/invoices';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

/**
 * A Saudi invoice is read in both languages at once, whatever language the dashboard is in:
 * every label is Arabic and English side by side, as on the paper the merchant's accountant
 * files. The screen's own chrome (back, print) follows the dashboard language.
 */
export default function InvoiceView() {
  const { t } = useLang();
  const env = useEnv();
  const id = decodeURIComponent(env.path.split('/').filter(Boolean).pop() ?? '');
  const { data, loading, error } = useResource((source) => source.invoice(id), [id]);
  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('الاشتراك والفواتير', 'Billing'), href: '/dashboard/billing' },
    { label: data?.number ?? t('فاتورة', 'Invoice') },
  ];
  return (
    <Shell tenant={null} crumbs={crumbs}>
      {loading && <Panel><Loading rows={6} /></Panel>}
      {error && <ErrorNote error={error} />}
      {!loading && !error && !data && (
        <Panel><Empty title={t('الفاتورة غير موجودة', 'Invoice not found')} body={t('ربما الرابط خاطئ، أو أنها لمتجر آخر.', 'The link may be wrong, or it belongs to another store.')} /></Panel>
      )}
      {data && <Document invoice={data} sample={env.demo} />}
    </Shell>
  );
}

function Document({ invoice, sample }: { invoice: InvoiceDocument; sample: boolean }) {
  const { t, lang } = useLang();
  const money = (minor: number) => formatMoney(minor, invoice.currency, lang);
  const title = invoice.kind === 'standard'
    ? { ar: 'فاتورة ضريبية', en: 'Tax invoice' }
    : { ar: 'فاتورة ضريبية مبسطة', en: 'Simplified tax invoice' };
  const vatPct = `${invoice.vatRateBp / 100}%`;

  return (
    <>
      <div className="invoice-actions no-print">
        <AppLink href="/dashboard/billing" className="btn btn-ghost">{t('رجوع إلى الفواتير', 'Back to invoices')}</AppLink>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden />{t('طباعة أو حفظ PDF', 'Print or save as PDF')}
        </button>
      </div>

      <article className="invoice" aria-label={`${title.en} ${invoice.number}`}>
        {sample && (
          <p className="invoice-sample" role="note">
            نموذج للمعاينة — ليست فاتورة صادرة · Preview sample — not an issued invoice
          </p>
        )}
        <header className="invoice-head">
          <div>
            <h1><span>{title.ar}</span><span dir="ltr">{title.en}</span></h1>
            <dl className="invoice-meta">
              <Pair ar="رقم الفاتورة" en="Invoice number"><span dir="ltr" className="mm">{invoice.number}</span></Pair>
              <Pair ar="تاريخ الإصدار" en="Issue date">
                <span dir="ltr">{formatDate(invoice.issuedAt, 'en')}</span><br /><span dir="rtl">{formatHijri(invoice.issuedAt, 'ar')}</span>
              </Pair>
              {invoice.paidAt && <Pair ar="تاريخ الدفع" en="Paid on"><span dir="ltr">{formatDate(invoice.paidAt, 'en')}</span></Pair>}
            </dl>
          </div>
          <Badge tone={invoice.status === 'paid' ? 'ok' : invoice.status === 'void' || invoice.status === 'refunded' ? 'bad' : 'warn'}>
            {STATUS[invoice.status].ar} · {STATUS[invoice.status].en}
          </Badge>
        </header>

        <div className="invoice-parties">
          <PartyBlock ar="البائع" en="Seller" party={invoice.seller} />
          <PartyBlock ar="المشتري" en="Buyer" party={invoice.buyer} />
        </div>

        <div className="table-wrap">
          <table className="data invoice-lines">
            <thead>
              <tr>
                <Head ar="الوصف" en="Description" />
                <Head ar="الكمية" en="Qty" end />
                <Head ar="سعر الوحدة" en="Unit price" end />
                <Head ar="المبلغ دون الضريبة" en="Excl. VAT" end />
                <Head ar={`الضريبة ${vatPct}`} en={`VAT ${vatPct}`} end />
                <Head ar="المبلغ شامل الضريبة" en="Incl. VAT" end />
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, i) => (
                <tr key={i}>
                  <td>{line.descriptionAr && <>{line.descriptionAr}<br /></>}<span dir="ltr" className="invoice-en">{line.description}</span></td>
                  <td className="num">{line.quantity}</td>
                  <td className="num">{money(line.unitPriceMinor)}</td>
                  <td className="num">{money(line.amountMinor)}</td>
                  <td className="num">{money(line.taxMinor)}</td>
                  <td className="num">{money(line.amountMinor + line.taxMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="invoice-foot">
          <div className="invoice-qr">
            {invoice.zatca.qr
              ? <p className="mm" dir="ltr">{invoice.zatca.qr}</p>
              : <p><span dir="rtl">رمز الاستجابة من هيئة الزكاة يُضاف عند ربط الفوترة الإلكترونية.</span><br /><span dir="ltr">The ZATCA QR code is added once e-invoicing is connected.</span></p>}
          </div>
          <dl className="invoice-totals">
            <Pair ar="الإجمالي دون الضريبة" en="Total excl. VAT"><span className="num">{money(invoice.subtotalMinor)}</span></Pair>
            <Pair ar={`ضريبة القيمة المضافة ${vatPct}`} en={`VAT ${vatPct}`}><span className="num">{money(invoice.vatMinor)}</span></Pair>
            <Pair ar="الإجمالي شامل الضريبة" en="Total incl. VAT" strong><span className="num">{money(invoice.totalMinor)}</span></Pair>
          </dl>
        </div>
      </article>
    </>
  );
}

const STATUS: Record<InvoiceDocument['status'], { ar: string; en: string }> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  issued: { ar: 'مستحقة', en: 'Due' },
  paid: { ar: 'مدفوعة', en: 'Paid' },
  void: { ar: 'ملغاة', en: 'Void' },
  refunded: { ar: 'مستردة', en: 'Refunded' },
};

/** A column heading in both languages, each in its own direction (numbers in Arabic stay put). */
function Head({ ar, en, end }: { ar: string; en: string; end?: boolean }) {
  return <th scope="col" className={end ? 'end' : undefined}><span dir="rtl">{ar}</span><br /><span dir="ltr">{en}</span></th>;
}

function Pair({ ar, en, strong, children }: { ar: string; en: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={strong ? 'strong' : undefined}>
      <dt><span dir="rtl">{ar}</span> <span dir="ltr">{en}</span></dt>
      <dd>{children}</dd>
    </div>
  );
}

function PartyBlock({ ar, en, party }: { ar: string; en: string; party: InvoiceParty }) {
  const missing = '—';
  return (
    <section className="invoice-party">
      <h2><span dir="rtl">{ar}</span> <span dir="ltr">{en}</span></h2>
      {party.nameAr && <p className="invoice-name">{party.nameAr}</p>}
      <p className="invoice-name" dir="ltr">{party.name}</p>
      <dl>
        <Pair ar="السجل التجاري" en="CR number"><span dir="ltr" className="mm">{party.crNumber ?? missing}</span></Pair>
        <Pair ar="الرقم الضريبي" en="VAT number"><span dir="ltr" className="mm">{party.vatNumber ?? missing}</span></Pair>
        {party.address && <Pair ar="العنوان" en="Address"><span>{party.address}</span></Pair>}
      </dl>
    </section>
  );
}
