'use client';

// MD-100 — Install in your store. T95: a Salla store adds one tag in Google Tag Manager (linked from Salla's
// own app) and the button finds every published product's page by itself; the theme template is the other way.

import { Check, Copy, SearchCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { AppLink } from '@/lib/app-env';
import { useData, useResource } from '@/lib/data';
import { inArabic } from '@/lib/problem-text';
import { useLang } from '@/lib/i18n';
import type { Bi } from '@/lib/lang';
import type { EmbedInfo, InstallCheck } from '@/lib/view-models';
import { CONSENT_LINE } from '@/widget/src/main';
import { embedSnippet, tagManagerSnippet } from '@/widget/src/snippet';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';

type Method = 'tags' | 'template';

/** What each checker answer means, and what to do about it. */
const VERDICT: Record<InstallCheck['status'], { tone: 'ok' | 'warn' | 'bad'; title: Bi; fix: Bi }> = {
  installed: { tone: 'ok', title: { ar: 'مُركَّب بشكل صحيح', en: 'Installed correctly' },
    fix: { ar: 'يظهر الزر في صفحات المنتجات التي نشرتها.', en: 'The button shows on the pages of products you have published.' } },
  missing_script: { tone: 'bad', title: { ar: 'لم نجد تجربة في هذه الصفحة', en: 'Tajribah is not on this page' },
    fix: { ar: 'عبر Google Tag Manager: تأكد أنك ربطت الحاوية في تطبيق سلة ونشرتها (Submit ثم Publish). عبر القالب: تأكد أنك ألصقت السطرين في قالب صفحة المنتج، وليس في الصفحة الرئيسية، ثم احفظ القالب.',
      en: 'Through Google Tag Manager: check that the container is linked in Salla’s app and published (Submit, then Publish). Through the template: check that you pasted the two lines into the product page template (not the home page), and saved it.' } },
  wrong_store: { tone: 'bad', title: { ar: 'الكود لمتجر آخر', en: 'The code is for a different store' },
    fix: { ar: 'انسخ الكود من هذه الصفحة من جديد وضعه مكان القديم (وفي Tag Manager انشر الحاوية بعدها).', en: 'Copy the code from this page again and replace the old one (in Tag Manager, publish the container afterwards).' } },
  missing_placeholder: { tone: 'warn', title: { ar: 'مكان الزر غير موجود', en: 'The button’s place is missing' },
    fix: { ar: 'الصق السطرين معًا: سطر ‹div› يحدد مكان الزر، وسطر ‹script› يحمّله.', en: 'Paste both lines: the ‹div› marks where the button goes, the ‹script› loads it.' } },
  template_not_rendered: { tone: 'warn', title: { ar: 'رقم المنتج لم يُملأ', en: 'The product id was not filled in' },
    fix: { ar: 'السطر موجود لكن القالب لم يضع رقم المنتج مكان {{ product.id }}. تأكد أنه داخل قالب صفحة المنتج.', en: 'The line is there, but the template did not replace {{ product.id }}. Make sure it is inside the product page template.' } },
  unreachable: { tone: 'warn', title: { ar: 'تعذّر فتح الصفحة', en: 'We could not open the page' },
    fix: { ar: 'تأكد أن الرابط صحيح وأن المتجر مفتوح للزوار.', en: 'Check the address, and that the store is open to visitors.' } },
  tag_manager_missing: { tone: 'bad', title: { ar: 'Google Tag Manager مربوط، لكن بلا وسم تجربة', en: 'Google Tag Manager is linked, but has no Tajribah tag' },
    fix: { ar: 'أضف الوسم في حاويتك (الخطوة 3)، ثم اضغط Submit ثم Publish (الخطوة 4). لا يصل إلى متجرك إلا ما نشرته.', en: 'Add the tag to your container (step 3), then press Submit, then Publish (step 4). Only what you publish reaches your store.' } },
  tag_needs_update: { tone: 'warn', title: { ar: 'الوسم في حاويتك نسخة قديمة', en: 'The tag in your container is an older copy' },
    fix: { ar: 'انسخ الوسم من هذه الصفحة من جديد، وضعه مكان القديم في Tag Manager، ثم انشر الحاوية.', en: 'Copy the tag from this page again, replace the old one in Tag Manager, then publish the container.' } },
  not_product_page: { tone: 'warn', title: { ar: 'الوسم منشور، لكن هذه ليست صفحة منتج', en: 'The tag is published — but this is not a product page' },
    fix: { ar: 'الصق رابط صفحة منتج: الرابط الذي ينتهي بـ ‎/p‎ ورقم المنتج.', en: 'Paste the address of a product page: the one that ends in /p and the product’s number.' } },
};

/** T37: installed right — and this product's own state, which is why a button shows or not. */
const PRODUCT_VERDICT: Record<'live' | 'not_published' | 'withdrawn' | 'unknown', { tone: 'ok' | 'warn'; title: Bi; fix: Bi; link: boolean }> = {
  live: { tone: 'ok', title: { ar: 'مُركَّب، والزر ظاهر لهذا المنتج', en: 'Installed, and this product’s button is live' },
    fix: { ar: 'إن لم تره بعد فانتظر دقيقة ثم حدّث الصفحة.', en: 'If you do not see it yet, wait a minute and reload the page.' }, link: false },
  not_published: { tone: 'warn', title: { ar: 'مُركَّب، لكن هذا المنتج لم يُنشر بعد', en: 'Installed — but this product is not published yet' },
    fix: { ar: 'انشره من إعدادات تجربته («انشر في المتجر»)، ويظهر الزر خلال دقيقة تقريبًا.', en: 'Publish it from its try-on settings (Publish to the store); the button appears within about a minute.' }, link: true },
  withdrawn: { tone: 'warn', title: { ar: 'مُركَّب، لكن زر هذا المنتج أُزيل', en: 'Installed — but this product’s button was taken down' },
    fix: { ar: 'لم يعد لدى المنتج ما يفتحه الزر (أُوقف العرض أو التجربة، أو أُرشف المنتج)، أو المتجر موقوف. يعود تلقائيًا حين يكتمل من جديد.', en: 'The product no longer has anything for the button to open (AR or try-on switched off, or the product archived), or the store is paused. It comes back by itself once that is fixed.' }, link: true },
  unknown: { tone: 'warn', title: { ar: 'مُركَّب، لكن لا يوجد منتج بهذا الرقم', en: 'Installed — but no product has this id' },
    fix: { ar: 'إن كان المنتج جديدًا فزامن متجرك أولًا؛ وإلا فتأكد من الرقم الذي يضعه القالب.', en: 'If the product is new, sync your store first; otherwise check the id your theme fills in.' }, link: false },
};

/** T95: through Tag Manager, an unknown product means its page is not known yet — the feed tells us. */
const UNKNOWN_PAGE = { tone: 'warn' as const, title: { ar: 'الوسم منشور، لكن لا نعرف منتج هذه الصفحة', en: 'The tag is published — but we do not know this page’s product' },
  fix: { ar: 'نتعرّف على صفحة كل منتج من رابطه في ملف منتجاتك. اضغط «مزامنة الآن» في ربط المتجر، ثم انشر المنتج إن لم يكن منشورًا.', en: 'We learn each product’s page from its link in your product feed. Press “Sync now” on Store connections, then publish the product if it is not published.' } };

const URL_AR: [RegExp, string][] = [
  [/https:\/\//, 'يجب أن يبدأ الرابط بـ https://'],
  [/IP address/, 'يجب أن يكون اسم نطاق، لا عنوان IP'],
  [/public domain/, 'يجب أن يكون نطاقًا عامًا'],
  [/page of your store/, 'يجب أن تكون صفحة من متجرك المربوط'],
  [/web address/, 'هذا ليس رابطًا صحيحًا'],
];

/** A name as Google Tag Manager or Salla shows it — kept in its own direction inside an Arabic sentence. */
const Ui = ({ children }: { children: ReactNode }) => <bdi className="ui-name">{children}</bdi>;

export default function Embed() {
  const { t, pick, lang } = useLang();
  const source = useData();
  const { data, loading, error } = useResource((s) => s.embed());
  const [method, setMethod] = useState<Method>('tags');
  const [copied, setCopied] = useState(false);
  // T48: a shop that asks shoppers for consent gets the gated code and its banner's one line.
  const [asksConsent, setAsksConsent] = useState(false);
  const [anchor, setAnchor] = useState('');
  const code = !data ? '' : method === 'tags'
    ? tagManagerSnippet(data.storeKey, { consent: asksConsent, anchor })
    : (asksConsent ? embedSnippet(data.storeKey, undefined, { consent: true }) : data.snippet);
  const [url, setUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<InstallCheck | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('التركيب في متجرك', 'Install') },
  ];

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked; the merchant can still select the text */ }
  };

  const check = async (event: FormEvent) => {
    event.preventDefault();
    setResult(null); setUrlError(null); setFailure(null);
    setChecking(true);
    try {
      setResult(await source.checkInstall(url.trim()));
    } catch (e) {
      if (e instanceof ApiError && e.fields?.url) {
        const reason = e.fields.url[0];
        setUrlError(lang === 'ar' ? URL_AR.find(([p]) => p.test(reason))?.[1] ?? reason : reason);
      } else setFailure(e as Error);
    } finally {
      setChecking(false);
    }
  };

  const viaTags = result?.status === 'installed' && result.via === 'tag_manager';
  const productState = result?.status === 'installed' ? result.product?.state ?? 'unknown' : null;
  const productVerdict = productState ? (viaTags && productState === 'unknown' ? { ...UNKNOWN_PAGE, link: false } : PRODUCT_VERDICT[productState]) : null;
  const verdict = productVerdict ?? (result ? VERDICT[result.status] : null);
  const sallaNumber = result?.status === 'installed' && viaTags ? /^page:p(\d+)$/.exec(result.productRef)?.[1] ?? null : null;
  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('التركيب في متجرك', 'Install in your store')}
        lead={t(
          'مرة واحدة لكل صفحات منتجاتك. لا يغيّر تصميم متجرك، والزر لا يظهر إلا على المنتجات التي نشرتها.',
          'Once, for every product page. It does not change your theme, and the button only appears on products you have published.',
        )}
      />
      {error && <ErrorNote error={error} />}
      <div className="seg" role="tablist" aria-label={t('طريقة التركيب', 'How to install')} style={{ marginBottom: 16 }}>
        <button type="button" role="tab" aria-selected={method === 'tags'} className={method === 'tags' ? 'on' : ''} onClick={() => setMethod('tags')}>
          {t('سلة: عبر Google Tag Manager', 'Salla: through Google Tag Manager')}
        </button>
        <button type="button" role="tab" aria-selected={method === 'template'} className={method === 'template' ? 'on' : ''} onClick={() => setMethod('template')}>
          {t('في قالب صفحة المنتج', 'In the product page template')}
        </button>
      </div>
      <div className="grid grid-main">
        <div className="grid" style={{ gap: 18 }}>
          {method === 'tags' && data && <Readiness data={data} />}

          <Panel
            title={method === 'tags' ? t('وسم Google Tag Manager', 'The Google Tag Manager tag') : t('الكود', 'The snippet')}
            sub={method === 'tags' ? t('وسم واحد لكل متجرك — لا يتغيّر حين تنشر منتجات جديدة.', 'One tag for your whole store — it does not change when you publish more products.') : undefined}
            actions={data && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copied ? t('نُسخ', 'Copied') : t('انسخ', 'Copy')}
              </button>
            )}
          >
            {loading && !data && <Loading rows={2} />}
            {data && <pre className="code-block" dir="ltr" tabIndex={0} style={method === 'tags' ? { whiteSpace: 'pre-wrap', wordBreak: 'break-all' } : undefined}>{code}</pre>}
            <label className="toggle" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={asksConsent} onChange={(e) => setAsksConsent(e.target.checked)} />
              <span>{t('متجري يطلب موافقة الزائر على ملفات تعريف الارتباط', 'My store asks shoppers for cookie consent')}</span>
            </label>
            {asksConsent && (
              <>
                <p className="hint" style={{ marginBottom: 6 }}>{t(
                  'لن نقيس أي شيء قبل الموافقة. أضف هذا السطر إلى ما يحدث عند ضغط الزائر «موافق» في نافذة الموافقة (يعمل قبل تحميل الزر وبعده):',
                  'Nothing is measured before consent. Add this line to what runs when a shopper presses “Accept” in your consent banner (it works before and after the button loads):',
                )}</p>
                <pre className="code-block" dir="ltr" tabIndex={0}>{CONSENT_LINE}</pre>
              </>
            )}
            {method === 'tags' ? (
              <p className="hint">{t(
                'يعمل في صفحات المنتجات فقط: يعرف المنتج من رابط صفحته في سلة (الذي ينتهي بـ ‎/p‎ ورقم المنتج)، ويضع الزر تحت خيارات المنتج فوق زر «أضف للسلة».',
                'It works on product pages only: it knows the product from its Salla page address (the one ending in /p and the product’s number), and puts the button under the product’s options, above “Add to cart”.',
              )}</p>
            ) : (
              <p className="hint">{t(
                'ضع مكان {{ product.id }} رقم المنتج المعروض كما في متجرك — وهو «id» في ملف المنتجات. إن كان قالبك يعرف رقم المنتج المعروض، فاكتب متغيّره هنا ليعمل السطر نفسه في كل صفحات المنتجات.',
                'Put the shown product’s id in place of {{ product.id }}, as your store has it — the “id” in your product feed. If your theme knows the shown product’s id, write its variable here, so the same line works on every product page.',
              )}</p>
            )}
            {method === 'tags' && (
              <details style={{ marginTop: 10 }}>
                <summary className="hint" style={{ cursor: 'pointer' }}>{t('متقدّم: مكان آخر للزر', 'Advanced: another spot for the button')}</summary>
                <div className="field" style={{ marginTop: 8 }}>
                  <label htmlFor="tag-anchor">{t('العنصر الذي يأتي الزر بعده (محدد CSS)', 'The element the button comes after (a CSS selector)')}</label>
                  <input id="tag-anchor" dir="ltr" placeholder=".product-price" value={anchor} maxLength={200} onChange={(e) => setAnchor(e.target.value)} aria-describedby="tag-anchor-hint" />
                  <span id="tag-anchor-hint" className="hint">{t('اتركه فارغًا ليختار الزر مكانه بنفسه. إن غيّرته فانسخ الوسم من جديد.', 'Leave it empty and the button picks its spot itself. If you change it, copy the tag again.')}</span>
                </div>
              </details>
            )}
          </Panel>

          {method === 'tags' ? <TagManagerGuide storeHost={data?.storeHost ?? null} /> : <TemplateSteps />}
        </div>

        <div className="grid" style={{ gap: 18 }}>
          <Panel title={t('تحقّق من التركيب', 'Check the install')}
            sub={data?.storeHost ? t(`صفحة منتج من ${data.storeHost}`, `A product page on ${data.storeHost}`) : t('رابط صفحة منتج في متجرك', 'The address of a product page in your store')}>
            <form onSubmit={check}>
              <div className="field">
                <label htmlFor="check-url">{t('رابط صفحة المنتج', 'Product page address')}</label>
                <input id="check-url" type="url" dir="ltr" required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)}
                  aria-invalid={!!urlError} aria-describedby={urlError ? 'check-url-error' : undefined} />
                {urlError && <span id="check-url-error" className="field-error">{urlError}</span>}
              </div>
              <button type="submit" className="btn btn-primary" disabled={checking || !url.trim()}>
                <SearchCheck size={16} aria-hidden />{checking ? t('جارٍ الفحص…', 'Checking…') : t('افحص', 'Check')}
              </button>
            </form>
            {failure && <ErrorNote error={failure} />}
            {result && verdict && (
              <div className="check-result" role="status">
                <Badge tone={verdict.tone} dot>{pick(verdict.title)}</Badge>
                <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>{pick(verdict.fix)}</p>
                {viaTags && <p className="hint" style={{ margin: '4px 0 0' }}>{t('وجدنا الوسم في حاوية Google Tag Manager المنشورة.', 'We found the tag in your published Google Tag Manager container.')}</p>}
                {result.status === 'installed' && <p className="hint" style={{ margin: '4px 0 0' }}>
                  {sallaNumber ? <>{t('رقم المنتج في سلة', 'Product number on Salla')}: <span className="mm" dir="ltr">{sallaNumber}</span></> : <>{t('رقم المنتج في الصفحة', 'Product id on the page')}: <span className="mm" dir="ltr">{result.productRef}</span></>}
                  {result.product && <> · {lang === 'ar' ? result.product.nameAr ?? result.product.name : result.product.name}{result.product.state === 'live' ? t(` · نسخة ${result.product.version}`, ` · version ${result.product.version}`) : null}</>}</p>}
                {productVerdict?.link && <AppLink href={result.status === 'installed' && result.product ? `/dashboard/tryon/${encodeURIComponent(result.product.productId)}` : '/dashboard/tryon'} className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>{t('إعدادات التجربة', 'Try-on settings')}</AppLink>}
                {viaTags && productState === 'unknown' && <AppLink href="/dashboard/connections" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>{t('ربط المتجر', 'Store connections')}</AppLink>}
                {result.status === 'tag_manager_missing' && result.detail && <p className="hint" style={{ margin: '4px 0 0' }}>{t('الحاويات في الصفحة', 'Containers on the page')}: {result.detail.split(', ').map((id, i) => <span key={id}>{i > 0 && ' · '}<span className="mm" dir="ltr" style={{ whiteSpace: 'nowrap' }}>{id}</span></span>)}</p>}
                {result.status === 'wrong_store' && result.detail && <p className="hint" style={{ margin: '4px 0 0' }}>{t('رمز المتجر في الكود', 'Store key in the code')}: <span className="mm" dir="ltr">{result.detail}</span></p>}
                {result.status !== 'installed' && result.status !== 'tag_manager_missing' && result.status !== 'wrong_store' && result.detail && <p className="hint" style={{ margin: '4px 0 0' }} dir="auto">{lang === 'ar' ? inArabic(result.detail) : result.detail}</p>}
              </div>
            )}
          </Panel>

          <Panel title={t('لماذا لا يمكنه كسر متجرك', 'Why it cannot break your shop')}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
              {t(
                'الزر معزول عن تصميم متجرك، وحجمه نحو 6 كيلوبايت مضغوطًا، ويُحمّل بعد صفحتك. إن حدث أي خطأ لا يظهر الزر فقط — وصفحتك تبقى كما هي حتى لو تعطّلت خدمتنا تمامًا.',
                'The button is isolated from your theme, about 6 KB compressed, and loads after your page. If anything goes wrong the button simply does not appear — and your page stays exactly as it is, even if our service were down entirely.',
              )}
            </p>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}

/**
 * T95 — whether the tag has anything to show: published products, and of those the ones whose store page is
 * known (from the feed's link). A product without one is not found by a page-wide tag until the feed is read again.
 */
function Readiness({ data }: { data: EmbedInfo }) {
  const { t } = useLang();
  const missing = data.publishedFromStore - data.publishedWithPage;
  if (data.published === 0) {
    return (
      <div className="check-result" role="status">
        <Badge tone="warn" dot>{t('لم تنشر أي منتج بعد', 'You have not published any product yet')}</Badge>
        <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>{t('الزر يظهر على المنتجات المنشورة فقط. جهّز تجربة منتج وانشره، ثم أضف الوسم.', 'The button shows on published products only. Set up a product’s try-on and publish it, then add the tag.')}</p>
        <AppLink href="/dashboard/tryon" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>{t('إعدادات التجربة', 'Try-on settings')}</AppLink>
      </div>
    );
  }
  if (missing > 0) {
    return (
      <div className="check-result" role="status">
        <Badge tone="warn" dot>{t(`${missing} من ${data.publishedFromStore} منتجات منشورة لا نعرف صفحتها في متجرك بعد`, `${missing} of ${data.publishedFromStore} published products have no known store page yet`)}</Badge>
        <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>{t(
          'نتعرّف على صفحة كل منتج من رابطه («link») في ملف منتجاتك. اضغط «مزامنة الآن» في ربط المتجر، وتتحدّث منتجاتك المنشورة تلقائيًا.',
          'We learn each product’s page from its link in your product feed. Press “Sync now” on Store connections, and your published products update by themselves.',
        )}</p>
        <AppLink href="/dashboard/connections" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>{t('ربط المتجر', 'Store connections')}</AppLink>
      </div>
    );
  }
  if (data.publishedWithPage === 0) {
    return (
      <div className="check-result" role="status">
        <Badge tone="warn" dot>{t('منتجاتك المنشورة لم تُستورد من متجرك', 'Your published products were not imported from your store')}</Badge>
        <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>{t(
          'أُضيفت في تجربة مباشرة، فلا نعرف صفحاتها في سلة. استورد منتجاتك من رابط ملف المنتجات، ثم جهّز تجربتها وانشرها.',
          'They were added in Tajribah directly, so we do not know their pages on Salla. Import your products from your product feed link, then set up their try-on and publish them.',
        )}</p>
        <AppLink href="/dashboard/connections" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>{t('ربط المتجر', 'Store connections')}</AppLink>
      </div>
    );
  }
  return (
    <div className="check-result" role="status">
      <Badge tone="ok" dot>{t(`${data.publishedWithPage} منتجات منشورة جاهزة للوسم`, `${data.publishedWithPage} published products ready for the tag`)}</Badge>
      {data.published > data.publishedWithPage && <p className="hint" style={{ margin: '6px 0 0' }}>{t('المنتجات التي أضفتها في تجربة مباشرة ليس لها صفحة في متجرك، فلا يظهر زرها عبر الوسم.', 'Products you added in Tajribah directly have no page in your store, so the tag shows no button for them.')}</p>}
    </div>
  );
}

/** T95 — the owner's manual: a container, linked in Salla, the tag in it, published — then check a product page. */
function TagManagerGuide({ storeHost }: { storeHost: string | null }) {
  const { lang, t } = useLang();
  const domain = storeHost ?? 'yourstore.com';
  const ar = lang === 'ar';
  const steps: { title: string; body: ReactNode }[] = [
    {
      title: t('أنشئ حاوية في Google Tag Manager', 'Create a Google Tag Manager container'),
      body: ar
        ? <>ادخل <a href="https://tagmanager.google.com" target="_blank" rel="noopener noreferrer"><bdi>tagmanager.google.com</bdi></a> بحساب Google، وأنشئ حسابًا باسم متجرك وحاوية باسم نطاقه (<bdi>{domain}</bdi>) واختر <Ui>Web</Ui>. انسخ رقم الحاوية الذي يبدأ بـ <Ui>GTM-</Ui>. إن كانت لديك حاوية مربوطة بسلة فانتقل إلى الخطوة 3.</>
        : <>Go to <a href="https://tagmanager.google.com" target="_blank" rel="noopener noreferrer">tagmanager.google.com</a> with a Google account, create an account named after your store and a container named after its domain (<bdi>{domain}</bdi>), and choose <Ui>Web</Ui>. Copy the container id that starts with <Ui>GTM-</Ui>. If a container is already linked in Salla, go to step 3.</>,
    },
    {
      title: t('اربطها بمتجرك في سلة', 'Link it to your Salla store'),
      body: ar
        ? <>في لوحة تحكم سلة، ثبّت تطبيق <Ui>Google Tags Manager</Ui> من متجر تطبيقات سلة، ثم افتح <Ui>خيارات التطبيق</Ui>. في تبويب <Ui>بيانات الربط</Ui> الصق رقم الحاوية (<bdi>GTM-…</bdi>) واضغط <Ui>حفظ</Ui>.</>
        : <>In your Salla dashboard, install the <Ui>Google Tags Manager</Ui> app from Salla’s app store, then open its <Ui>App options</Ui> (خيارات التطبيق). On the <Ui>Connection details</Ui> tab (بيانات الربط), paste the container id (<bdi>GTM-…</bdi>) and press <Ui>Save</Ui> (حفظ).</>,
    },
    {
      title: t('أضف وسم تجربة في الحاوية', 'Add the Tajribah tag to the container'),
      body: ar
        ? <>في Tag Manager افتح <Ui>Tags</Ui> ثم <Ui>New</Ui>، وسمِّ الوسم «تجربة · زر التجربة». اضغط <Ui>Tag Configuration</Ui> واختر <Ui>Custom HTML</Ui>، والصق الوسم المنسوخ من هذه الصفحة. ثم اضغط <Ui>Triggering</Ui> واختر <Ui>All Pages</Ui>، واحفظ بـ <Ui>Save</Ui>. لا حاجة إلى مشغّل خاص: الوسم لا يعمل إلا في صفحات المنتجات.</>
        : <>In Tag Manager, open <Ui>Tags</Ui>, then <Ui>New</Ui>, and name it “Tajribah · try-on button”. Press <Ui>Tag Configuration</Ui>, choose <Ui>Custom HTML</Ui>, and paste the tag copied from this page. Then press <Ui>Triggering</Ui>, choose <Ui>All Pages</Ui>, and <Ui>Save</Ui>. No special trigger is needed: the tag only works on product pages.</>,
    },
    {
      title: t('انشر الحاوية', 'Publish the container'),
      body: ar
        ? <>اضغط <Ui>Submit</Ui> أعلى الصفحة، ثم <Ui>Publish</Ui>. ما لم تنشرها لا يصل شيء إلى متجرك — وكل تعديل لاحق في الحاوية يحتاج نشرًا جديدًا.</>
        : <>Press <Ui>Submit</Ui> at the top of the page, then <Ui>Publish</Ui>. Until you publish, nothing reaches your store — and every later change to the container needs a new publish.</>,
    },
    {
      title: t('انشر منتجاتك في تجربة', 'Publish your products in Tajribah'),
      body: <>{t('يظهر الزر على كل منتج نشرته من إعدادات تجربته، خلال دقيقة تقريبًا. المنتجات التي تنشرها لاحقًا يظهر زرها تلقائيًا، دون أي تعديل في الوسم.', 'The button shows on every product you published from its try-on settings, within about a minute. Products you publish later get their button by themselves, with no change to the tag.')}{' '}
        <AppLink href="/dashboard/tryon">{t('إعدادات التجربة', 'Try-on settings')}</AppLink></>,
    },
    {
      title: t('تحقّق من صفحة منتج', 'Check a product page'),
      body: t('الصق رابط صفحة منتج في «تحقّق من التركيب». نقرأ حاويتك المنشورة من Google، ونخبرك إن كان الوسم فيها، وأي منتج في الصفحة، وهل زرّه ظاهر.', 'Paste a product page’s address into “Check the install”. We read your published container from Google and tell you whether the tag is in it, which product the page shows, and whether its button is live.'),
    },
  ];
  return (
    <Panel flush title={t('دليل الربط خطوة بخطوة', 'Step-by-step linking guide')}>
      <ol className="steps" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {steps.map((step, index) => (
          <li className="step" key={step.title}>
            <span className="mark" aria-hidden>{index + 1}</span>
            <div className="step-body">
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function TemplateSteps() {
  const { t } = useLang();
  const steps = [
    { title: t('انسخ السطرين', 'Copy the two lines'),
      body: t('يُحمّلان من شبكة توصيل المحتوى بعد صفحتك، ولا يبطئانها.', 'They load from the CDN after your page, and do not slow it down.') },
    { title: t('ألصقهما في قالب صفحة المنتج', 'Paste them into your product page template'),
      body: t('حيث تريد أن يظهر الزر — عادةً تحت السعر.', 'Where you want the button — usually under the price.') },
    { title: t('تحقّق من صفحة منتج', 'Check a product page'),
      body: t('الصق رابط أي صفحة منتج، ونخبرك إن كان التركيب صحيحًا وما الذي ينقص.', 'Paste the address of any product page, and we tell you whether the install is right, and what is missing.') },
  ];
  return (
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
  );
}
