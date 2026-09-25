'use client';

// MD-100 — Install in your store

import { Check, Copy, SearchCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api-client';
import { useData, useResource } from '@/lib/data';
import { useLang } from '@/lib/i18n';
import type { Bi } from '@/lib/lang';
import type { InstallCheck } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';

/** What each checker answer means, and what to do about it. */
const VERDICT: Record<InstallCheck['status'], { tone: 'ok' | 'warn' | 'bad'; title: Bi; fix: Bi }> = {
  installed: { tone: 'ok', title: { ar: 'مُركَّب بشكل صحيح', en: 'Installed correctly' },
    fix: { ar: 'يظهر الزر في هذه الصفحة للمنتجات التي فعّلت لها العرض.', en: 'The button shows on this page for products with AR switched on.' } },
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
      await navigator.clipboard.writeText(data.snippet);
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

  const verdict = result ? VERDICT[result.status] : null;
  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('التركيب في متجرك', 'Install in your store')}
        lead={t(
          'سطران داخل قالب صفحة المنتج. لا يغيّران تصميم متجرك، والزر لا يظهر إلا على المنتجات التي فعّلت لها العرض.',
          'Two lines inside your product page template. They do not change your theme, and the button only appears on products where you switched AR on.',
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
            {data && <pre className="code-block" dir="ltr">{data.snippet}</pre>}
            <p className="hint">
              {t(
                '{{ product.id }} يملؤه قالب متجرك برقم المنتج المعروض. صيغة القالب في سلة وزد تُؤكَّد عند اعتماد تطبيقنا لدى كل منهما.',
                '{{ product.id }} is filled in by your theme with the product being shown. The exact template syntax for Salla and Zid is confirmed once our app is approved on each.',
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
                {result.status === 'installed' && <p className="hint" style={{ margin: '4px 0 0' }}>{t('رقم المنتج في الصفحة', 'Product id on the page')}: <span className="mm" dir="ltr">{result.productRef}</span></p>}
                {result.status !== 'installed' && result.detail && <p className="hint" style={{ margin: '4px 0 0' }} dir="auto">{result.detail}</p>}
              </div>
            )}
          </Panel>

          <Panel title={t('لماذا لا يمكنه كسر متجرك', 'Why it cannot break your shop')}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
              {t(
                'الزر معزول عن تصميم متجرك، وحجمه أقل من 3 كيلوبايت، ويُحمّل بعد صفحتك. إن حدث أي خطأ لا يظهر الزر فقط — وصفحتك تبقى كما هي حتى لو تعطّلت خدمتنا تمامًا.',
                'The button is isolated from your theme, under 3 KB, and loads after your page. If anything goes wrong the button simply does not appear — and your page stays exactly as it is, even if our service were down entirely.',
              )}
            </p>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
