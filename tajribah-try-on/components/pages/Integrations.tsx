'use client';

import { Code2, ShoppingBag, Store } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { COMPANY } from '@/lib/site';
import { Shell } from '@/components/site/chrome';
import { Checks, CtaBand, PageHero, SectionHead } from '@/components/site/ui';

export default function Integrations() {
  const { t } = useLang();

  const platforms = [
    { name: t('سلة', 'Salla'), latin: 'Salla', how: t('تطبيق من متجر تطبيقات سلة، بموافقة واحدة.', 'An app from the Salla app store, approved in one step.') },
    { name: t('زد', 'Zid'), latin: 'Zid', how: t('تطبيق من متجر تطبيقات زد، بموافقة واحدة.', 'An app from the Zid app market, approved in one step.') },
    { name: 'Shopify', latin: 'Shopify', how: t('تطبيق Shopify وكتلة جاهزة لقالب صفحة المنتج.', 'A Shopify app and a ready block for the product template.') },
    { name: 'WooCommerce', latin: 'WooCommerce', how: t('إضافة ووردبريس تضيف الزر إلى صفحات المنتجات.', 'A WordPress plugin that adds the button to product pages.') },
  ];

  const syncs = [
    t('المنتجات والصور والأوصاف', 'Products, images and descriptions'),
    t('الخيارات: المقاسات والألوان والخامات', 'Variants: sizes, colours and materials'),
    t('الأسعار والمخزون', 'Prices and stock'),
    t('إضافة إلى السلة من داخل الاستوديو', 'Add to cart from inside the studio'),
  ];

  const snippet = `<script src="https://${COMPANY.cdnHost}/v1/widget.js" defer></script>
<div data-tajribah-product="SKU-123"
     data-lang="ar"></div>`;

  return (
    <Shell current="/integrations">
      <PageHero eyebrow={t('التكاملات', 'Integrations')}
        title={t('تعمل مع المنصة التي يعمل عليها متجرك', 'Works with the platform your store runs on')}
        lead={t('تكاملات مباشرة مع المنصات الأكثر استخدامًا في السعودية، وسطر تضمين واحد لأي متجر آخر.',
          'Direct integrations with the platforms most used in Saudi Arabia, and a single embed line for any other store.')} />

      <section className="sec">
        <div className="wrap">
          <div className="grid-4">
            {platforms.map((p) => (
              <article key={p.latin} className="platform-card">
                <span className="f-icon"><ShoppingBag size={20} aria-hidden /></span>
                <h3>{p.name}{p.name !== p.latin && <small dir="ltr">{p.latin}</small>}</h3>
                <p>{p.how}</p>
              </article>
            ))}
          </div>
          <p className="fine">{t('نعمل حاليًا مع المتاجر الأولى بالتنسيق المباشر. تواصل معنا لمعرفة موعد إتاحة التكامل مع منصتك.',
            'We are currently onboarding our first stores directly. Contact us to find out when the integration for your platform opens.')}</p>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('ما يُزامَن', 'What syncs')} title={t('كتالوجك يبقى مصدر الحقيقة', 'Your catalogue stays the source of truth')}
              lead={t('لا تُدخل منتجاتك مرتين. ما تغيّره في متجرك يظهر في تجربة.', 'You never enter products twice. What you change in your store shows up in Tajribah.')} />
            <Checks items={syncs} />
          </div>
          <div className="panel-card">
            <h3><Code2 size={18} aria-hidden /> {t('أي متجر آخر', 'Any other store')}</h3>
            <p>{t('متجر مخصص أو منصة غير مدرجة؟ أضف هذين السطرين إلى قالب صفحة المنتج، وضع رمز المنتج مكان SKU-123.',
              'A custom store or an unlisted platform? Add these two lines to your product-page template and put the product code in place of SKU-123.')}</p>
            <pre className="code" dir="ltr"><code>{snippet}</code></pre>
            <p className="fine">{t('يصلك الرابط النهائي للسكربت من لوحة التحكم عند تفعيل حسابك.', 'Your final script URL is issued from the dashboard when your account is activated.')}</p>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap narrow center-text">
          <Store size={28} aria-hidden className="q-icon" />
          <h2 className="h2">{t('منصتك غير موجودة هنا؟', 'Platform not listed?')}</h2>
          <p className="lead">{t('أخبرنا بالمنصة التي تستخدمها. سطر التضمين يعمل في أي صفحة تستطيع إضافة سكربت إليها.',
            'Tell us which platform you use. The embed line works on any page you can add a script to.')}</p>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}
