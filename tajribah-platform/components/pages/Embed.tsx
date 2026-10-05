'use client';

// MD-100 — Install in your store

import { Check, Copy, SearchCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api-client';
import { AppLink } from '@/lib/app-env';
import { useData, useResource } from '@/lib/data';
import { inArabic } from '@/lib/problem-text';
import { useLang } from '@/lib/i18n';
import type { Bi } from '@/lib/lang';
import type { InstallCheck } from '@/lib/view-models';
import { CONSENT_LINE } from '@/widget/src/main';
import { embedSnippet } from '@/widget/src/snippet';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';

/** What each checker answer means, and what to do about it. */
const VERDICT: Record<InstallCheck['status'], { tone: 'ok' | 'warn' | 'bad'; title: Bi; fix: Bi }> = {
  installed: { tone: 'ok', title: { ar: 'مُركَّب بشكل صحيح', en: 'Installed correctly' },
    fix: { ar: 'يظهر الزر في صفحات المنتجات التي نشرتها.', en: 'The button shows on the pages of products you have published.' } },
  missing_script: { tone: 'bad', title: { ar: 'السطر غير موجود في الصفحة', en: 'The snippet is not on this page' },
    fix: { ar: 'تأكد أنك ألصقته في قالب صفحة المنتج، وليس في الصفحة الرئيسية، ثم احفظ القالب.', en: 'Check that you pasted it into the product page template (not the home page), and saved the template.' } },
  wrong_store: { tone: 'bad', title: { ar: 'السطر لمتجر آخر', en: 'The snippet is for a different store' },
    fix: { ar: 'انسخ السطر من هذه الصفحة من جديد وضعه مكان القديم.', en: 'Copy the snippet from this page again and replace the old one.' } },
  missing_placeholder: { tone: 'warn', title: { ar: 'مكان الزر غير موجود', en: 'The button’s place is missing' },
    fix: { ar: 'الصق السطرين معًا: سطر ‹div› يحدد مكان الزر، وسطر ‹script› يحمّله.', en: 'Paste both lines: the ‹div› marks where the button goes, the ‹script› loads it.' } },
  template_not_rendered: { tone: 'warn', title: { ar: 'رقم المنتج لم يُملأ', en: 'The product id was not filled in' },
    fix: { ar: 'السطر موجود لكن القالب لم يضع رقم المنتج مكان {{ product.id }}. تأكد أنه داخل قالب صفحة المنتج.', en: 'The line is there, but the template did not replace {{ product.id }}. Make sure it is inside the product page template.' } },
  unreachable: { tone: 'warn', title: { ar: 'تعذّر فتح الصفحة', en: 'We could not open the page' },
    fix: { ar: 'تأكد أن الرابط صحيح وأن المتجر مفتوح للزوار.', en: 'Check the address, and that the store is open to visitors.' } },
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

const URL_AR: [RegExp, string][] = [
  [/https:\/\//, 'يجب أن يبدأ الرابط بـ https://'],
  [/IP address/, 'يجب أن يكون اسم نطاق، لا عنوان IP'],
  [/public domain/, 'يجب أن يكون نطاقًا عامًا'],
  [/page of your store/, 'يجب أن تكون صفحة من متجرك المربوط'],
  [/web address/, 'هذا ليس رابطًا صحيحًا'],
];

export default function Embed() {
  const { t, pick, lang } = useLang();
  const source = useData();
  const { data, loading, error } = useResource((s) => s.embed());
  const [copied, setCopied] = useState(false);
  // T48: a shop that asks shoppers for consent gets the gated snippet and its banner's one line.
  const [asksConsent, setAsksConsent] = useState(false);
  const snippet = data ? (asksConsent ? embedSnippet(data.storeKey, undefined, { consent: true }) : data.snippet) : '';
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
      await navigator.clipboard.writeText(snippet);
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

  const steps = [
    { title: t('انسخ السطرين', 'Copy the two lines'),
      body: t('يُحمّلان من شبكة توصيل المحتوى بعد صفحتك، ولا يبطئانها.', 'They load from the CDN after your page, and do not slow it down.') },
    { title: t('ألصقهما في قالب صفحة المنتج', 'Paste them into your product page template'),
      body: t('حيث تريد أن يظهر الزر — عادةً تحت السعر.', 'Where you want the button — usually under the price.') },
    { title: t('تحقّق من صفحة منتج', 'Check a product page'),
      body: t('الصق رابط أي صفحة منتج أدناه، ونخبرك إن كان التركيب صحيحًا وما الذي ينقص.', 'Paste the address of any product page below, and we tell you whether the install is right, and what is missing.') },
  ];

  const productVerdict = result?.status === 'installed' ? PRODUCT_VERDICT[result.product?.state ?? 'unknown'] : null;
  const verdict = productVerdict ?? (result ? VERDICT[result.status] : null);
  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('التركيب في متجرك', 'Install in your store')}
        lead={t(
          'سطران داخل قالب صفحة المنتج. لا يغيّران تصميم متجرك، والزر لا يظهر إلا على المنتجات التي نشرتها.',
          'Two lines inside your product page template. They do not change your theme, and the button only appears on products you have published.',
        )}
      />
      {error && <ErrorNote error={error} />}
      <div className="grid grid-main">
        <div className="grid" style={{ gap: 18 }}>
          <Panel
            title={t('الكود', 'The snippet')}
            actions={data && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copied ? t('نُسخ', 'Copied') : t('انسخ', 'Copy')}
              </button>
            )}
          >
            {loading && !data && <Loading rows={2} />}
            {data && <pre className="code-block" dir="ltr" tabIndex={0}>{snippet}</pre>}
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
            <p className="hint">
              {t(
                'ضع مكان {{ product.id }} رقم المنتج المعروض كما في متجرك — وهو «id» في ملف المنتجات. إن كان قالبك يعرف رقم المنتج المعروض، فاكتب متغيّره هنا ليعمل السطر نفسه في كل صفحات المنتجات.',
                'Put the shown product’s id in place of {{ product.id }}, as your store has it — the “id” in your product feed. If your theme knows the shown product’s id, write its variable here, so the same line works on every product page.',
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
          <Panel title={t('تحقّق من التركيب', 'Check the install')}
            sub={data?.storeHost ? t(`صفحة من ${data.storeHost}`, `A page on ${data.storeHost}`) : t('رابط صفحة منتج في متجرك', 'The address of a product page in your store')}>
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
                {result.status === 'installed' && <p className="hint" style={{ margin: '4px 0 0' }}>{t('رقم المنتج في الصفحة', 'Product id on the page')}: <span className="mm" dir="ltr">{result.productRef}</span>
                  {result.product && <> · {lang === 'ar' ? result.product.nameAr ?? result.product.name : result.product.name}{result.product.state === 'live' ? t(` · نسخة ${result.product.version}`, ` · version ${result.product.version}`) : null}</>}</p>}
                {productVerdict?.link && <AppLink href={result.status === 'installed' && result.product ? `/dashboard/tryon/${encodeURIComponent(result.product.productId)}` : '/dashboard/tryon'} className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>{t('إعدادات التجربة', 'Try-on settings')}</AppLink>}
                {result.status !== 'installed' && result.detail && <p className="hint" style={{ margin: '4px 0 0' }} dir="auto">{lang === 'ar' ? inArabic(result.detail) : result.detail}</p>}
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
