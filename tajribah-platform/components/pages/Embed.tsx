'use client';

// MD-100 — Install in your store

import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, PageHead, Panel } from '@/components/dashboard/ui';

/** Served from the CDN, versioned, and under 60 KB gzipped — every KB is paid 100k times a day. */
const SNIPPET = (slug: string) => `<script
  src="https://cdn.tajribah.sa/v1/tajribah.js"
  data-store="${slug}"
  data-product="{{ product.id }}"
  defer
></script>`;

export default function Embed() {
  const { t } = useLang();
  const { data } = useResource((source) => source.dashboard());
  const [copied, setCopied] = useState(false);
  const slug = data?.tenant.slug ?? 'your-store';

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('التركيب في متجرك', 'Install') },
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SNIPPET(slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked; the merchant can still select the text */ }
  };

  const steps = [
    {
      title: t('انسخ السطر', 'Copy the snippet'),
      body: t('سطر واحد، يُحمّل من شبكة توصيل المحتوى ولا يبطئ صفحتك.', 'One line, served from the CDN, and it does not slow your page down.'),
    },
    {
      title: t('ألصقه في قالب صفحة المنتج', 'Paste it into your product page template'),
      body: t('في سلة: التصميم ← تحرير القالب ← صفحة المنتج، قبل نهاية الصفحة.', 'In Salla: Design → Edit template → Product page, before the end of the page.'),
    },
    {
      title: t('افتح أي منتج وجرّب', 'Open a product and try it'),
      body: t('سيظهر زر «شاهدها في مكانك» أسفل سعر المنتج مباشرة.', 'The “View in your space” button appears directly under the product price.'),
    },
  ];

  return (
    <Shell tenant={data?.tenant ?? null} crumbs={crumbs}>
      <PageHead
        title={t('التركيب في متجرك', 'Install in your store')}
        lead={t(
          'سطر واحد داخل قالب صفحة المنتج. لا يغيّر تصميم متجرك، ولا يعمل إلا على المنتجات التي فعّلت لها العرض.',
          'One line inside your product page template. It does not change your theme, and it only appears on products where you switched AR on.',
        )}
        actions={
          <a className="btn btn-ghost" href="https://failet.sa" target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden />{t('مثال حي', 'See a live example')}
          </a>
        }
      />

      <div className="grid grid-main">
        <div className="grid" style={{ gap: 18 }}>
          <Panel
            title={t('الكود', 'The snippet')}
            actions={
              <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copied ? t('نُسخ', 'Copied') : t('انسخ', 'Copy')}
              </button>
            }
          >
            <pre className="code-block" dir="ltr">{SNIPPET(slug)}</pre>
            <p className="hint">
              {t(
                '«data-product» يملؤه قالب متجرك تلقائيًا برقم المنتج المعروض. في سلة وزد الاسم جاهز كما هو أعلاه.',
                '`data-product` is filled in by your theme with the id of the product being shown. In Salla and Zid the placeholder above works as written.',
              )}
            </p>
          </Panel>

          <Panel flush title={t('ثلاث خطوات', 'Three steps')}>
            <div className="steps">
              {steps.map((step, index) => (
                <div className="step" key={step.title}>
                  <span className="mark" aria-hidden>{index + 1}</span>
                  <div className="step-body">
                    <strong>{step.title}</strong>
                    <p>{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="grid" style={{ gap: 18 }}>
          <Panel title={t('حالة التركيب', 'Install status')}>
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge tone="warn" dot>{t('لم يُكتشف بعد', 'Not detected yet')}</Badge>
            </p>
            <p className="hint">
              {t(
                'نتحقق تلقائيًا عند أول زيارة لصفحة منتج فيها السطر. إن لم تظهر الحالة خلال دقائق، تأكد أن السطر داخل قالب صفحة المنتج وليس الصفحة الرئيسية.',
                'We detect it on the first visit to a product page that carries the snippet. If nothing changes within a few minutes, check that the line is in the product page template rather than the home page.',
              )}
            </p>
          </Panel>

          <Panel title={t('لماذا سطر واحد فقط', 'Why only one line')}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
              {t(
                'الودجت يعمل داخل متجرك، لذلك لا يجوز أن يكسره. حجمه أقل من 60 كيلوبايت، ويُحمّل بعد صفحتك، وإذا تعطّلت خدمتنا تمامًا تبقى صفحة منتجك كما هي.',
                'The widget runs inside your store, so it must not be able to break it. It is under 60 KB, it loads after your page, and if our service went down entirely your product page would be unaffected.',
              )}
            </p>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
