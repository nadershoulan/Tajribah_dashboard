'use client';

// P8 — for developers: keys, the API, webhooks — everything an integration needs, in one page

import { Code2, KeyRound, Webhook } from 'lucide-react';
import { useLang, pick } from '@/lib/i18n';
import { API, CURL_EXAMPLE, ENDPOINTS, EVENTS, VERIFY_EXAMPLE } from '@/lib/developers';
import { Shell } from '@/components/site/chrome';
import { CtaBand, PageHero, SectionHead } from '@/components/site/ui';

/** Text whose `code` parts (API names, headers) read left-to-right inside an Arabic sentence. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i} dir="ltr">{part}</code> : part))}</>;
}

export default function DevelopersPage() {
  const { t, lang } = useLang();
  return (
    <Shell current="/developers">
      <PageHero eyebrow={t('للمطوّرين', 'For developers')} title={t('اربط أنظمتك بتجربة', 'Connect your systems to Tajribah')}
        lead={t(
          'واجهة برمجية لقراءة منتجاتك ونماذجك وأرقامك، وإشعارات فورية حين يتغيّر شيء — في باقة المؤسسات.',
          'An API to read your products, models and figures, and instant webhooks when something changes — on the Enterprise plan.',
        )} />

      <section className="sec">
        <div className="wrap narrow">
          <SectionHead eyebrow={t('1', '1')} title={<><KeyRound size={22} aria-hidden /> {t('مفتاح', 'A key')}</>}
            lead={t(
              `من لوحة التحكم: الإعدادات ← مفاتيح الواجهة البرمجية. سمِّ المفتاح، واختر ما يسمح له به، ومدته. يظهر المفتاح (يبدأ بـ ${API.keyPrefix}) مرة واحدة. يعمل باسم من أنشأه وضمن صلاحياته: إن غادر المتجر توقف.`,
              `In the dashboard: Settings → API keys. Name the key, choose what it may do, and how long it lives. The key (it starts with ${API.keyPrefix}) is shown once. It works as the person who made it, within their permissions: if they leave the store, it stops.`,
            )} />
          <pre className="code" dir="ltr"><code>{CURL_EXAMPLE}</code></pre>
          <p className="fine"><Rich text={t(
            `حتى ${API.ratePerMinute} طلب في الدقيقة لكل مفتاح؛ كل جواب يحمل \`x-ratelimit-remaining\`. الأخطاء بصيغة \`application/problem+json\`، وتجاوز الحد \`429\` مع \`retry-after\`.`,
            `Up to ${API.ratePerMinute} requests a minute per key; every answer carries \`x-ratelimit-remaining\`. Errors are \`application/problem+json\`; over the limit is \`429\` with \`retry-after\`.`,
          )} /></p>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap narrow">
          <SectionHead eyebrow={t('2', '2')} title={<><Code2 size={22} aria-hidden /> {t('الواجهة البرمجية، الإصدار 1', 'The API, version 1')}</>}
            lead={t('كل جواب بصيغة ثابتة موثّقة: تُضاف حقول ولا تتغيّر أسماؤها ولا تُحذف ما دام الإصدار 1 قائمًا.', 'Every answer has a fixed, documented shape: fields are added, never renamed or removed, while version 1 lives.')} />
          <div className="table-scroll">
            <table className="matrix dev-table">
              <thead><tr><th scope="col">{t('الطلب', 'Request')}</th><th scope="col">{t('الصلاحية', 'Scope')}</th><th scope="col">{t('ما يعيده', 'Returns')}</th></tr></thead>
              <tbody>
                {ENDPOINTS.map((e) => (
                  <tr key={e.path}>
                    <td dir="ltr"><code>{e.method} {e.path}</code></td>
                    <td dir="ltr"><code>{e.scope}</code></td>
                    <td>{pick(e.what, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine">{t('المرجع الكامل بصيغة OpenAPI 3.1 (تقرؤه أدوات المطوّرين مباشرة):', 'The full reference, in OpenAPI 3.1 (developer tools read it directly):')} <a href={API.reference} dir="ltr">{API.reference}</a></p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap narrow">
          <SectionHead eyebrow={t('3', '3')} title={<><Webhook size={22} aria-hidden /> {t('الإشعارات البرمجية', 'Webhooks')}</>}
            lead={t(
              'من لوحة التحكم: الإعدادات ← الإشعارات البرمجية. أضف عنوان https واختر ما يُخبَر به؛ يظهر سر التوقيع مرة واحدة.',
              'In the dashboard: Settings → Webhooks. Add an https address and choose what it hears about; its signing secret is shown once.',
            )} />
          <ul className="dev-events">
            {EVENTS.map((e) => <li key={e.name}><code dir="ltr">{e.name}</code> — {pick(e.what, lang)}</li>)}
          </ul>
          <p><Rich text={t(
            `كل رسالة موقّعة في الترويسة \`${API.signatureHeader}\`. تحقّق منها قبل أن تثق بها — بهذه الدالة في \`Node.js\` مثلًا:`,
            `Every message is signed in the \`${API.signatureHeader}\` header. Check it before you trust it — with this function in \`Node.js\`, for example:`,
          )} /></p>
          <pre className="code" dir="ltr"><code>{VERIFY_EXAMPLE}</code></pre>
          <p className="fine"><Rich text={t(
            `أجب بـ \`2xx\` خلال ${API.timeoutSeconds} ثوانٍ. غير ذلك نعيد المحاولة نحو ${API.retryHours} ساعة، ولا نتبع التحويلات. المعرّف \`id\` واحد في كل إعادة: تجاهل المكرر. العنوان الذي يفشل مرارًا يُوقَف ويُخبَر المتجر.`,
            `Answer \`2xx\` within ${API.timeoutSeconds} seconds. Anything else is retried for about ${API.retryHours} hours, and redirects are not followed. The \`id\` is the same on every retry: drop a repeat. An address that keeps failing is turned off and the store is told.`,
          )} /></p>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}
