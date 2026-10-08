'use client';

// A15 — Contact messages: what the website's contact form kept (T115), newest first

import { useEffect, useState } from 'react';
import { useAuth, type AdminContact as Message, type AdminContactInbox, type AdminContactStatus } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

type Filter = AdminContactStatus | 'all';

export default function AdminContact() {
  const { t } = useLang();
  return <AdminShell title={t('رسائل التواصل', 'Contact messages')}><Inbox /></AdminShell>;
}

const PLATFORM: Record<string, { ar: string; en: string }> = {
  salla: { ar: 'سلة', en: 'Salla' }, zid: { ar: 'زد', en: 'Zid' }, shopify: { ar: 'Shopify', en: 'Shopify' },
  woocommerce: { ar: 'WooCommerce', en: 'WooCommerce' }, custom: { ar: 'متجر مخصص', en: 'Custom store' }, other: { ar: 'أخرى', en: 'Other' },
};

function Inbox() {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [filter, setFilter] = useState<Filter>('new');
  const [inbox, setInbox] = useState<AdminContactInbox | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    auth.admin.contactInbox({ status: filter }).then((data) => { if (live) { setInbox(data); setError(null); } }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, filter, version]);

  if (error) return <ErrorNote error={error} />;
  if (!inbox) return <Panel><Loading rows={4} /></Panel>;

  const refresh = (message?: string) => { if (message) setNotice(message); setVersion((v) => v + 1); };
  const move = async (m: Message, status: AdminContactStatus, message?: string) => {
    try { await auth.admin.setContactStatus(m.id, status); refresh(message); } catch (e) { setError(e as Error); }
  };
  const toggle = (m: Message) => {
    const opening = open !== m.id;
    setOpen(opening ? m.id : null);
    // Opening a new message reads it.
    if (opening && m.status === 'new') void move(m, 'read');
  };
  const remove = async (m: Message) => {
    const reason = window.prompt(t('سبب الحذف (يُحفظ في سجل الموظفين):', 'Why delete it? (kept in the staff trail)'), t('رسالة مزعجة', 'Spam'));
    if (!reason) return;
    try { await auth.admin.deleteContact(m.id, reason); setOpen(null); refresh(t('حُذفت الرسالة.', 'Message deleted.')); } catch (e) { setError(e as Error); }
  };

  const tabs: { id: Filter; label: string; n?: number }[] = [
    { id: 'new', label: t('جديدة', 'New'), n: inbox.counts.new },
    { id: 'read', label: t('مقروءة', 'Read'), n: inbox.counts.read },
    { id: 'archived', label: t('مؤرشفة', 'Archived'), n: inbox.counts.archived },
    { id: 'all', label: t('الكل', 'All'), n: inbox.counts.new + inbox.counts.read + inbox.counts.archived },
  ];

  return (
    <div className="ops">
      {notice && <p role="status" className="plan-notice">{notice}</p>}
      <Panel flush title={t('رسائل نموذج التواصل', 'Contact form messages')}
        sub={t('ما يرسله الزوار من صفحة «تواصل معنا»، بعد التحقق من Cloudflare. افتح الرسالة لقراءتها، ورُد على المرسل من بريدك.', 'What visitors send from the Contact page, after Cloudflare’s check. Open a message to read it, and reply from your own email.')}>
        <div role="tablist" aria-label={t('حالة الرسالة', 'Message status')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 16px' }}>
          {tabs.map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={filter === tab.id} className={`btn btn-sm ${filter === tab.id ? 'btn-accent' : 'btn-ghost'}`}
              onClick={() => { setNotice(null); setOpen(null); setFilter(tab.id); }}>
              {tab.label} <bdi>({tab.n ?? 0})</bdi>
            </button>
          ))}
        </div>
        {inbox.items.length === 0 ? (
          <Empty title={t('لا رسائل هنا', 'No messages here')} body={filter === 'new' ? t('كل الرسائل الجديدة قُرئت.', 'Every new message has been read.') : t('لا شيء في هذا القسم.', 'Nothing in this section.')} />
        ) : (
          <ul className="ops-list">
            {inbox.items.map((m) => (
              <li key={m.id} style={{ display: 'block' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <button type="button" className="ops-what" aria-expanded={open === m.id} onClick={() => toggle(m)}
                    style={{ background: 'none', border: 0, padding: 0, textAlign: 'start', cursor: 'pointer', color: 'inherit', flex: '1 1 260px' }}>
                    <span style={{ fontWeight: m.status === 'new' ? 700 : 500 }}>{m.name} · <bdi dir="ltr">{m.email}</bdi></span>
                    <span>{formatDateTime(m.createdAt, lang)}{m.platform ? ` · ${PLATFORM[m.platform]?.[lang] ?? m.platform}` : ''}{m.message ? ` · ${m.message.slice(0, 80)}${m.message.length > 80 ? '…' : ''}` : ''}</span>
                  </button>
                  <Badge tone={m.status === 'new' ? 'accent' : m.status === 'read' ? 'ok' : 'neutral'}>
                    {m.status === 'new' ? t('جديدة', 'New') : m.status === 'read' ? t('مقروءة', 'Read') : t('مؤرشفة', 'Archived')}
                  </Badge>
                </div>
                {open === m.id && (
                  <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                    <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0 }}>
                      <dt>{t('الاسم', 'Name')}</dt><dd style={{ margin: 0 }}>{m.name}</dd>
                      <dt>{t('البريد', 'Email')}</dt><dd style={{ margin: 0 }}><a href={`mailto:${m.email}`} dir="ltr">{m.email}</a></dd>
                      {m.phone && <><dt>{t('الجوال', 'Phone')}</dt><dd style={{ margin: 0 }}><a href={`tel:${m.phone.replace(/[^+0-9]/g, '')}`} dir="ltr">{m.phone}</a></dd></>}
                      {m.storeUrl && <><dt>{t('المتجر', 'Store')}</dt><dd style={{ margin: 0 }}><a href={m.storeUrl} target="_blank" rel="noopener noreferrer nofollow" dir="ltr">{m.storeUrl}</a></dd></>}
                      {m.platform && <><dt>{t('المنصة', 'Platform')}</dt><dd style={{ margin: 0 }}>{PLATFORM[m.platform]?.[lang] ?? m.platform}</dd></>}
                      <dt>{t('لغة النموذج', 'Form language')}</dt><dd style={{ margin: 0 }}>{m.lang === 'ar' ? 'العربية' : 'English'}</dd>
                      <dt>{t('وصلت', 'Received')}</dt><dd style={{ margin: 0 }}>{formatDateTime(m.createdAt, lang)}</dd>
                    </dl>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0, padding: 12, borderRadius: 8, background: 'var(--surface-2, rgba(127,127,127,.08))' }} dir="auto">
                      {m.message || t('(بلا نص)', '(no text)')}
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a className="btn btn-accent btn-sm" href={`mailto:${m.email}?subject=${encodeURIComponent(t('ردّ من تجربة', 'Reply from Tajribah'))}`}>{t('الرد بالبريد', 'Reply by email')}</a>
                      {m.status !== 'archived' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void move(m, 'archived', t('أُرشفت الرسالة.', 'Message archived.'))}>{t('أرشفة', 'Archive')}</button>}
                      {m.status !== 'new' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void move(m, 'new', t('عادت الرسالة إلى «جديدة».', 'Marked as new again.'))}>{t('اجعلها جديدة', 'Mark as new')}</button>}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(m)}>{t('حذف', 'Delete')}</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
