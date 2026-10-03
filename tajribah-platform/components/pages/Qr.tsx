'use client';

// MD-110 — QR codes (P1.20)

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, QrCode } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import type { QrScreen } from '@/lib/contracts/hosted-page';
import { useResource } from '@/lib/data';
import { useLang } from '@/lib/i18n';
import { Shell } from '@/components/dashboard/chrome';
import { Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';

/**
 * A code per product with a live page of its own, opening that page (`?s=qr`, so Analytics shows the
 * visit came from a code). A printed code is permanent: until its address is final — the store's own
 * address, or Tajribah's short domain once it is set — each code is a marked preview that cannot be
 * scanned or downloaded, and the screen says why (DECISIONS P1.20).
 */
export default function Qr() {
  const { t } = useLang();
  const { data, loading, error } = useResource((source) => source.qrCodes());
  return (
    <Shell tenant={null} crumbs={[{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('رموز QR', 'QR codes') }]}>
      <PageHead
        title={t('رموز QR', 'QR codes')}
        lead={t('رمز لكل منتج تطبعه على الملصق أو في المتجر، يفتح صفحة المنتج الخاصة مباشرة — بالعرض ثلاثي الأبعاد أو التجربة.', 'A code for each product to print on a label or in-store, opening the product’s own page directly — with its 3D view or try-on.')}
      />
      {loading && !data && <Panel><Loading rows={3} /></Panel>}
      {error && <ErrorNote error={error} />}
      {data && <Codes screen={data} />}
    </Shell>
  );
}

function Codes({ screen }: { screen: QrScreen }) {
  const { t } = useLang();
  if (!screen.included) {
    return <Panel><Empty title={t('ليست في باقتك', 'Not in your plan')} body={t('رموز QR متاحة في كل الباقات المدفوعة.', 'QR codes come with every paid plan.')} /></Panel>;
  }
  return (
    <>
      {!screen.printable && (
        <Panel title={t('معاينة — لا تطبعها بعد', 'Preview — do not print yet')} actions={<QrCode size={20} aria-hidden style={{ color: 'var(--text-3)' }} />}>
          <p style={{ marginTop: 0 }}>{t(
            'الرمز المطبوع يبقى كما هو لسنوات، لذلك يجب أن يحمل عنوان تجربة القصير النهائي. هذا العنوان لم يُعتمد بعد، فالرموز هنا معاينة لا تُمسح ولا تُنزَّل. حين يُعتمد، تصبح جاهزة للطباعة هنا دون أي خطوة منك.',
            'A printed code stays as it is for years, so it must carry Tajribah’s final short address. That address is not set yet, so the codes here are previews that cannot be scanned or downloaded. Once it is set they become printable here, with nothing for you to do.',
          )}</p>
          <p className="hint" style={{ marginBottom: 0 }}>{t('إلى ذلك الحين شارك رابط صفحة المنتج من إعدادات العرض.', 'Until then, share the product page’s link from AR settings.')}</p>
        </Panel>
      )}
      {screen.products.length === 0 ? (
        <Panel>
          <Empty title={t('لا منتجات منشورة بعد', 'No published products yet')} body={t('لكل منتج منشور بصفحة خاصة مفعّلة رمزٌ هنا.', 'Each published product with its own page switched on gets a code here.')} />
          <div className="btn-row"><AppLink href="/dashboard/ar-settings" className="btn btn-ghost">{t('إعدادات العرض', 'AR settings')}</AppLink></div>
        </Panel>
      ) : (
        <ul className="qr-grid" style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {screen.products.map((p) => <Code key={p.id} product={p} printable={screen.printable} />)}
        </ul>
      )}
    </>
  );
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'product';

function Code({ product, printable }: { product: QrScreen['products'][number]; printable: boolean }) {
  const { t } = useLang();
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // Level M: survives a scuffed label; the quiet zone of 2 modules is part of the drawing.
    QRCode.toString(product.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }).then((s) => { if (live) setSvg(s); }, () => {});
    return () => { live = false; };
  }, [product.url]);
  const name = t(product.nameAr ?? product.name, product.name);

  const download = async (kind: 'svg' | 'png') => {
    const href = kind === 'svg'
      ? URL.createObjectURL(new Blob([svg ?? ''], { type: 'image/svg+xml' }))
      : await QRCode.toDataURL(product.url, { errorCorrectionLevel: 'M', margin: 2, width: 1200 });
    const a = document.createElement('a');
    a.href = href; a.download = `qr-${slugOf(product.name)}.${kind}`;
    a.click();
    if (kind === 'svg') setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return (
    <li className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative', aspectRatio: '1', background: '#fff', borderRadius: 8, overflow: 'hidden' }}
        role="img" aria-label={printable ? t(`رمز QR لصفحة ${name}`, `QR code for ${name}’s page`) : t(`معاينة رمز QR لصفحة ${name} — غير قابلة للمسح`, `Preview of the QR code for ${name}’s page — not scannable`)}>
        {svg && <div aria-hidden style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg width="100%" height="100%" ') }} />}
        {!printable && (
          // Covers the code's middle band: a preview that a screenshot could not turn into a working print.
          <div aria-hidden style={{ position: 'absolute', insetInline: 0, top: '38%', height: '24%', background: 'var(--surface, #fff)', display: 'grid', placeItems: 'center', borderBlock: '1px dashed var(--border, #ccc)' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-2)' }}>{t('معاينة', 'Preview')}</span>
          </div>
        )}
      </div>
      <strong style={{ fontSize: 14 }}>{name}</strong>
      <span className="hint" dir="ltr" style={{ margin: 0, wordBreak: 'break-all', fontSize: 12 }}>{product.url}</span>
      {printable && (
        <div className="btn-row" style={{ marginTop: 'auto' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => download('svg')} disabled={!svg}><Download size={14} aria-hidden />SVG</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => download('png')}><Download size={14} aria-hidden />PNG</button>
        </div>
      )}
    </li>
  );
}
