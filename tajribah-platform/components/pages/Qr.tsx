'use client';

// MD-110 — QR codes (P1.20)

import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { useData } from '@/lib/data';
import { inArabic } from '@/lib/problem-text';
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
  const [version, setVersion] = useState(0); // T99: read again after linking the pages
  const { data, loading, error } = useResource((source) => source.qrCodes(), [version]);
  return (
    <Shell tenant={null} crumbs={[{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('رموز QR', 'QR codes') }]}>
      <PageHead
        title={t('رموز QR', 'QR codes')}
        lead={t('رمز لكل منتج تطبعه على الملصق أو في المتجر، يفتح صفحة المنتج الخاصة مباشرة — بالعرض ثلاثي الأبعاد أو التجربة.', 'A code for each product to print on a label or in-store, opening the product’s own page directly — with its 3D view or try-on.')}
      />
      {loading && !data && <Panel><Loading rows={3} /></Panel>}
      {error && <ErrorNote error={error} />}
      {data && !!data.withoutBuyLink && <StorePages count={data.withoutBuyLink} onDone={() => setVersion((v) => v + 1)} />}
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
      {screen.testOnly && (
        <Panel title={t('للتجربة على شبكتك فقط', 'For testing on your network only')} actions={<QrCode size={20} aria-hidden style={{ color: 'var(--text-3)' }} />}>
          <p style={{ margin: 0 }}>{t(
            'هذه الرموز تشير إلى جهازك هذا. امسحها بجوال متصل بنفس شبكة الواي فاي لتجرّب صفحة المنتج. لا تُطبع ولا تُنزَّل: الرمز المطبوع يحمل عنوان تجربة النهائي.',
            'These codes point at this computer. Scan one with a phone on the same Wi-Fi to try the product’s page. They cannot be printed or downloaded: a printed code carries Tajribah’s final address.',
          )}</p>
        </Panel>
      )}
      {!screen.printable && !screen.testOnly && (
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
          {screen.products.map((p) => <Code key={p.id} product={p} printable={screen.printable} scannable={screen.printable || !!screen.testOnly} />)}
        </ul>
      )}
    </>
  );
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'product';

function Code({ product, printable, scannable }: { product: QrScreen['products'][number]; printable: boolean; scannable: boolean }) {
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
        {!scannable && (
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

/**
 * T99 — the pages these codes open can take the shopper to the product in the store. The feed already knows
 * each product's page there: one click links every page that has no buy link yet (one the owner set stays).
 */
function StorePages({ count, onDone }: { count: number; onDone: () => void }) {
  const { t, lang } = useLang();
  const source = useData();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const apply = async () => {
    setBusy(true); setProblem(null);
    try { await source.applyStorePages(); onDone(); }
    catch (e) { const m = (e as Error).message; setProblem(lang === 'ar' ? inArabic(m) : m); }
    finally { setBusy(false); }
  };
  return (
    <Panel title={t('رابط الشراء في صفحات المنتجات', 'The buy link on product pages')} actions={<Link2 size={20} aria-hidden style={{ color: 'var(--text-3)' }} />}>
      <p style={{ marginTop: 0 }}>{count === 1 ? t(
        'صفحة واحدة تفتحها هذه الرموز بلا رابط شراء. نعرف صفحتها في متجرك من ملف منتجاتك: اربطها، فيجد المتسوّق زر «اشترها» يأخذه إلى المنتج في متجرك.',
        'One page these codes open has no buy link. We know its page in your store from your product feed: link it, and shoppers get a “Buy it” button that takes them to the product in your store.',
      ) : t(
        `${count} من الصفحات التي تفتحها هذه الرموز بلا رابط شراء. نعرف صفحة كل منها في متجرك من ملف منتجاتك: اربطها، فيجد المتسوّق زر «اشترها» يأخذه إلى المنتج في متجرك.`,
        `${count} of the pages these codes open have no buy link. We know each one's page in your store from your product feed: link them, and shoppers get a “Buy it” button that takes them to the product in your store.`,
      )}</p>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply()}>
          {busy ? t('جارٍ الربط…', 'Linking…') : t('اربطها بصفحاتها في متجرك', 'Link them to their pages in your store')}
        </button>
        <span className="hint" style={{ margin: 0 }}>{t('الروابط التي وضعتها بنفسك تبقى كما هي.', 'Links you set yourself stay as they are.')}</span>
      </div>
      {problem && <p className="field-error" role="alert">{problem}</p>}
    </Panel>
  );
}
