'use client';

import { FileUp, Link2, QrCode, ShoppingBag, Store } from 'lucide-react';
import { useLang } from '@site/lib/i18n';
import { COMPANY } from '@site/lib/site';
import { Shell } from '@site/components/site/chrome';
import { Checks, CtaBand, PageHero, SectionHead } from '@site/components/site/ui';

export default function Integrations() {
  const { t } = useLang();

  // T86: today a feed link or a file; linking each platform directly is version 2 (T81).
  const ways = [
    { icon: Link2, name: t('رابط ملف المنتجات', 'A product feed link'), how: t('رابط ملف منتجاتك كما تعطيه لـ Google Merchant Center. نقرؤه الآن، ثم كل 24 ساعة.', 'Your product feed link, as you give it to Google Merchant Center. We read it now, then every 24 hours.') },
    { icon: FileUp, name: t('ملف', 'A file'), how: t('ملف منتجاتك بصيغة الملف نفسه، ترفعه من لوحة التحكم.', 'Your products in the same format, as a file you upload in the dashboard.') },
  ];
  const platforms = ['Salla', 'Zid', 'Shopify', 'WooCommerce'];

  const syncs = [
    t('الاسم والصور والوصف', 'Name, pictures and description'),
    t('السعر', 'Price'),
    t('التصنيف، ومنه نوع المنتج: ساعة، مجوهرات، نظارة، حقيبة…', 'Category, and from it the product’s type: watch, jewelry, glasses, bag…'),
    t('المقاسات، إن كانت في الملف', 'Dimensions, when the feed has them'),
  ];

  // The same two lines the dashboard's install page gives (tajribah-platform `widget/src/snippet.ts`).
  const snippet = `<div data-tajribah-product="{{ product.id }}"></div>
<script src="${COMPANY.widgetSrc}" data-tajribah-store="your-store-key" async></script>`;

  return (
    <Shell current="/integrations">
      <PageHero eyebrow={t('التكاملات', 'Integrations')}
        title={t('منتجاتك من أي منصة، من رابط أو ملف', 'Your products from any platform, from a link or a file')}
        lead={t('أعطنا رابط ملف منتجاتك كما تعطيه لـ Google Merchant Center، أو ارفع الملف. لا تطبيق تثبّته ولا صلاحيات تمنحها.',
          'Give us your product feed link as you give it to Google Merchant Center, or upload the file. No app to install, no permissions to grant.')} />

      <section className="sec">
        <div className="wrap">
          <div className="grid-2">
            {ways.map((w) => (
              <article key={w.name} className="platform-card">
                <span className="f-icon"><w.icon size={20} aria-hidden /></span>
                <h3>{w.name}</h3>
                <p>{w.how}</p>
              </article>
            ))}
          </div>
          <div className="panel-card" style={{ marginTop: 24 }}>
            <h3><ShoppingBag size={18} aria-hidden /> {t('الربط المباشر بالمنصات — في الإصدار الثاني', 'Direct platform linking — in version 2')}</h3>
            <p>{t('ربط متجرك مباشرة بتطبيق من متجر تطبيقات منصتك، مع مزامنة تلقائية لكل تعديل، يأتي في الإصدار الثاني. حتى ذلك الحين، رابط ملف المنتجات يكفي.',
              'Linking your store directly, through an app from your platform’s app store, with every change synced automatically, comes in version 2. Until then, the product feed link is enough.')}</p>
            <ul className="platforms">{platforms.map((p) => <li key={p} dir="ltr">{p}</li>)}</ul>
          </div>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('ما نقرؤه', 'What we read')} title={t('كتالوجك يبقى مصدر الحقيقة', 'Your catalogue stays the source of truth')}
              lead={t('لا تُدخل منتجاتك مرتين. ما تغيّره في متجرك يصل مع قراءة الرابط التالية.', 'You never enter products twice. What you change in your store arrives with the link’s next reading.')} />
            <Checks items={syncs} />
          </div>
          <div className="panel-card">
            <h3><QrCode size={18} aria-hidden /> {t('كيف يراها عملاؤك', 'How your shoppers see it')}</h3>
            <p>{t('لكل منتج تنشره صفحة على تجربة ورمز QR — تشاركهما دون أي تركيب. وإن كان قالب متجرك يقبل كودًا، أضف هذين السطرين إلى قالب صفحة المنتج ليظهر زر «جرّبها» فيها: رمز المنتج مكان {{ product.id }}، ومفتاح متجرك مكان your-store-key.',
              'Each product you publish gets a page on Tajribah and a QR code — share them with nothing to install. And if your store’s theme takes code, add these two lines to your product-page template for a “Try it” button there: the product’s code in place of {{ product.id }}, and your store key in place of your-store-key.')}</p>
            <pre className="code" dir="ltr" tabIndex={0}><code>{snippet}</code></pre>
            <p className="fine">{t('تجد مفتاح متجرك والسطرين جاهزين في صفحة «التثبيت» في لوحة التحكم.', 'Your store key, and these two lines ready to copy, are on the dashboard’s Install page.')}</p>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap narrow center-text">
          <Store size={28} aria-hidden className="q-icon" />
          <h2 className="h2">{t('متجرك لا يعطي رابط ملف منتجات؟', 'Your store gives no product feed link?')}</h2>
          <p className="lead">{t('ارفع ملفًا، أو أضف منتجاتك يدويًا من لوحة التحكم. وأخبرنا بالمنصة التي تستخدمها لنعرف أين نبدأ في الإصدار الثاني.',
            'Upload a file, or add your products by hand in the dashboard. And tell us which platform you use, so we know where to start in version 2.')}</p>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}
