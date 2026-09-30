'use client';

// P8 — outgoing webhooks: the addresses your systems are told at, what each wants, and what was sent

import { useState, type FormEvent } from 'react';
import { Check, Copy, Lock, Send, Webhook } from 'lucide-react';
import { currentStore } from '@/lib/api-client';
import { AppLink } from '@/lib/app-env';
import { useAuth } from '@/lib/auth';
import { useData, useResource } from '@/lib/data';
import { formatRelative } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { planByCode } from '@/lib/plans';
import type { WebhookDeliveryView, WebhookEndpointView } from '@/lib/view-models';
import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS } from '@/lib/webhooks';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import { lockOf, useWriteLock } from '@/components/dashboard/write-lock';

type Event = (typeof WEBHOOK_EVENTS)[number];

export default function Webhooks() {
  const { t } = useLang();
  const { me } = useAuth();
  const store = currentStore(me);
  const included = store ? planByCode(store.plan).features.includes('public_api') : false;
  const crumbs = [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('الإعدادات', 'Settings'), href: '/dashboard/settings' }, { label: t('الإشعارات البرمجية', 'Webhooks') }];
  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('الإشعارات البرمجية', 'Webhooks')}
        lead={t(
          'نُخبر أنظمتك فور حدوث شيء في متجرك — منتج أُضيف أو عُدّل، نموذج نُشر، عمل للذكاء الاصطناعي انتهى — برسالة موقّعة إلى العنوان الذي تحدده.',
          'We tell your systems the moment something happens in your store — a product added or changed, a model published, an AI job finished — with a signed message to the address you choose.',
        )}
      />
      {included ? <Endpoints /> : (
        <Panel>
          <Empty icon={<Lock size={22} aria-hidden />}
            title={t('ضمن باقة المؤسسات', 'Part of the Enterprise plan')}
            body={t('الإشعارات البرمجية مع الواجهة البرمجية العامة في باقة المؤسسات.', 'Webhooks come with the public API on the Enterprise plan.')}
            action={<AppLink href="/dashboard/billing" className="btn btn-primary">{t('الباقات', 'Plans')}</AppLink>} />
        </Panel>
      )}
    </Shell>
  );
}

function SecretOnce({ title, secret, onDone }: { title: string; secret: string; onDone: () => void }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <Panel title={title} sub={t('انسخه الآن واحفظه في نظامك — لن يظهر مرة أخرى. به يتحقق نظامك أن الرسالة منّا.', 'Copy it now and keep it in your system — it will not be shown again. It is how your system checks a message came from us.')}>
      <pre className="code-block" dir="ltr" aria-label={t('سر التوقيع', 'Signing secret')}>{secret}</pre>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { /* select it by hand */ } }}>
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{copied ? t('نُسخ', 'Copied') : t('انسخ السر', 'Copy the secret')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>{t('حفظته', 'I have saved it')}</button>
      </div>
    </Panel>
  );
}

function Endpoints() {
  const { t, pick } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const { me } = useAuth();
  const staffView = lockOf(me) === 'staff_view';
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useResource((s) => s.webhookEndpoints(), [version]);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<Event[]>(['product.created', 'product.updated']);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);

  const refresh = () => setVersion((v) => v + 1);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setProblem(null);
    try { await fn(); refresh(); } catch (err) { setProblem((err as Error).message); } finally { setBusy(false); }
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const made = await source.createWebhookEndpoint({ url: url.trim(), events, description: description.trim() || null });
      setSecret({ title: t('سر التوقيع للعنوان الجديد', 'The new address’s signing secret'), value: made.secret });
      setUrl(''); setDescription('');
    });
  };

  return (
    <>
      {secret && <SecretOnce title={secret.title} secret={secret.value} onDone={() => setSecret(null)} />}

      <Panel title={t('عنوان جديد', 'New address')}>
        <form className="key-form" onSubmit={add}>
          <label className="field">
            <span>{t('العنوان (https)', 'Address (https)')}</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" inputMode="url" placeholder="https://erp.example.sa/hooks/tajribah" maxLength={2048} />
          </label>
          <label className="field">
            <span>{t('وصف (اختياري)', 'Description (optional)')}</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder={t('مثلًا: نظام المستودع', 'e.g. The warehouse system')} />
          </label>
          <fieldset>
            <legend>{t('ما نخبره به', 'What to tell it')}</legend>
            {WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="toggle">
                <input type="checkbox" checked={events.includes(event)} onChange={(e) => setEvents((s) => (e.target.checked ? [...s, event] : s.filter((x) => x !== event)))} />
                <span>{pick(WEBHOOK_EVENT_LABELS[event])}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || lock.locked || !url.trim() || !events.length} title={lock.title}>
            <Webhook size={14} aria-hidden />{t('أضف العنوان', 'Add the address')}
          </button>
          {problem && <p className="field-error" role="alert">{problem}</p>}
        </form>
      </Panel>

      <Panel flush title={t('العناوين', 'Addresses')}>
        {loading && !data && <Loading rows={2} />}
        {error && <ErrorNote error={error} />}
        {data && data.length === 0 && <p className="hint" style={{ margin: 18 }}>{t('لا عناوين بعد.', 'No addresses yet.')}</p>}
        {data && data.length > 0 && (
          <ul className="job-list">
            {data.map((endpoint) => (
              <EndpointItem key={endpoint.id} endpoint={endpoint} busy={busy} locked={lock.locked} lockTitle={lock.title} staffView={staffView}
                act={act} onSecret={(value) => setSecret({ title: t('سر التوقيع الجديد', 'The new signing secret'), value })} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('التحقق من الرسالة', 'Checking a message')}>
        <p className="hint" style={{ marginTop: 0 }}>{t('كل رسالة تحمل هذه الترويسة:', 'Every message carries this header:')}</p>
        <pre className="code-block" dir="ltr">tajribah-signature: t=&lt;unix time&gt;,v1=&lt;hex&gt;</pre>
        <p className="hint">{t('احسب HMAC-SHA256 لهذا النص بسرّ العنوان، وقارنه بـ v1، وارفض الوقت القديم:', 'Compute HMAC-SHA256 of this text with the address’s secret, compare it with v1, and refuse an old time:')}</p>
        <pre className="code-block" dir="ltr">&lt;t&gt;.&lt;the raw body, as received&gt;</pre>
        <p className="hint">{t(
          'أجب بـ 2xx خلال 10 ثوانٍ؛ غير ذلك نعيد المحاولة نحو 21 ساعة، ولا نتبع التحويلات. المعرّف id واحد في كل إعادة: تجاهل المكرر.',
          'Answer 2xx within 10 seconds; anything else is retried for about 21 hours, and redirects are not followed. The id is the same on every retry: drop a repeat.',
        )}</p>
        <p className="hint">{t('المرجع التقني:', 'The reference:')} <a href="/api/v1/openapi.json" dir="ltr" style={{ color: 'var(--aqua-ink)' }}>/api/v1/openapi.json</a></p>
      </Panel>
    </>
  );
}

const DELIVERY: Record<WebhookDeliveryView['status'], { tone: 'ok' | 'bad' | 'accent'; ar: string; en: string }> = {
  delivered: { tone: 'ok', ar: 'وصلت', en: 'Delivered' },
  pending: { tone: 'accent', ar: 'تُعاد المحاولة', en: 'Retrying' },
  failed: { tone: 'bad', ar: 'تعذّرت', en: 'Failed' },
};

function EndpointItem({ endpoint, busy, locked, lockTitle, staffView, act, onSecret }: {
  endpoint: WebhookEndpointView; busy: boolean; locked: boolean; lockTitle: string | undefined; staffView: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>; onSecret: (secret: string) => void;
}) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'rotate' | null>(null);
  const [seen, setSeen] = useState(0);
  const deliveries = useResource((s) => (open ? s.webhookDeliveries(endpoint.id) : Promise.resolve([] as WebhookDeliveryView[])), [open, seen]);
  const label = (event: string) => (event in WEBHOOK_EVENT_LABELS ? pick(WEBHOOK_EVENT_LABELS[event as Event]) : event);

  return (
    <li>
      <div className="job-main">
        <strong dir="ltr" style={{ overflowWrap: 'anywhere' }}>{endpoint.url}</strong>
        {endpoint.description && <span className="job-product">{endpoint.description}</span>}
        <Badge tone={endpoint.active ? 'ok' : endpoint.disabledReason ? 'bad' : undefined}>
          {endpoint.active ? t('يعمل', 'On') : endpoint.disabledReason ? t('أوقفناه', 'Turned off by us') : t('متوقف', 'Off')}
        </Badge>
      </div>
      <p className="hint" style={{ margin: '6px 0 0' }}>{endpoint.events.map(label).join(t('، ', ', '))}</p>
      {endpoint.disabledReason && (
        <p className="hint" style={{ margin: '6px 0 0', color: 'var(--bad)' }}>
          {t('أوقفناه لأن الإرسال إليه فشل مرارًا. أصلحه ثم شغّله.', 'We turned it off: sending to it kept failing. Fix it, then turn it on.')}{' '}
          <code dir="ltr">{endpoint.disabledReason}</code>
        </p>
      )}
      <div className="job-meta hint">
        <span>{endpoint.lastDeliveryAt ? t(`آخر إرسال ${formatRelative(endpoint.lastDeliveryAt, lang)} · ${endpoint.lastStatus ?? '—'}`, `Last sent ${formatRelative(endpoint.lastDeliveryAt, lang)} · ${endpoint.lastStatus ?? '—'}`) : t('لم يُرسل إليه شيء بعد', 'Nothing sent yet')}</span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void act(async () => { await source.testWebhookEndpoint(endpoint.id); setOpen(true); setSeen((v) => v + 1); })} disabled={busy || locked || !endpoint.active} title={lockTitle}>
          <Send size={13} aria-hidden />{t('أرسل رسالة تجربة', 'Send a test')}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void act(() => source.updateWebhookEndpoint(endpoint.id, { active: !endpoint.active }))}
          disabled={busy || staffView || (endpoint.active ? false : locked)} title={staffView ? lockTitle : undefined}>
          {endpoint.active ? t('أوقفه', 'Turn off') : t('شغّله', 'Turn on')}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? t('أخفِ الرسائل', 'Hide messages') : t('الرسائل', 'Messages')}</button>
        {confirm === null && <>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirm('rotate')} disabled={busy || locked} title={lockTitle}>{t('سر جديد', 'New secret')}</button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirm('delete')} disabled={busy || staffView} title={staffView ? lockTitle : undefined}>{t('احذف', 'Delete')}</button>
        </>}
        {confirm && (
          <span className="confirm-inline" role="alertdialog" aria-label={confirm === 'delete' ? t('حذف العنوان', 'Delete the address') : t('سر جديد', 'New secret')}>
            {confirm === 'delete' ? t('يُحذف العنوان ورسائله.', 'The address and its messages are deleted.') : t('يتوقف السر الحالي فورًا.', 'The current secret stops at once.')}{' '}
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void act(async () => {
              if (confirm === 'delete') await source.deleteWebhookEndpoint(endpoint.id);
              else onSecret((await source.rotateWebhookSecret(endpoint.id)).secret);
              setConfirm(null);
            })}>{confirm === 'delete' ? t('نعم، احذف', 'Yes, delete') : t('نعم، سر جديد', 'Yes, a new secret')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)} disabled={busy}>{t('تراجع', 'Keep it')}</button>
          </span>
        )}
      </div>
      {open && (
        <div className="hook-deliveries">
          {deliveries.loading && !deliveries.data && <Loading rows={2} />}
          {deliveries.data && deliveries.data.length === 0 && <p className="hint">{t('لا رسائل بعد.', 'No messages yet.')}</p>}
          {deliveries.data && deliveries.data.length > 0 && (
            <ul>
              {deliveries.data.map((d) => (
                <li key={d.id}>
                  <Badge tone={DELIVERY[d.status].tone}>{pick(DELIVERY[d.status])}</Badge>
                  <span>{d.event === 'ping' ? t('رسالة تجربة', 'Test message') : label(d.event)}</span>
                  <span className="hint">{formatRelative(d.deliveredAt ?? d.createdAt, lang)} · {t(`${d.attempts} محاولة`, `${d.attempts} ${d.attempts === 1 ? 'try' : 'tries'}`)}{d.responseStatus ? ` · ${d.responseStatus}` : ''}</span>
                  {d.error && <span className="hint" dir="auto">{d.error}</span>}
                  {d.status !== 'pending' && (
                    <button type="button" className="btn btn-quiet btn-sm" disabled={busy || locked || !endpoint.active} title={lockTitle}
                      onClick={() => void act(async () => { await source.redeliverWebhook(d.id); setSeen((v) => v + 1); })}>{t('أرسلها مجددًا', 'Send again')}</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
