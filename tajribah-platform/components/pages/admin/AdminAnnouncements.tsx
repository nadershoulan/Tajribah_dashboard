'use client';

// A13 — Announcements: platform notices on every store's dashboard (T23)

import { useEffect, useState } from 'react';
import { useAuth, type AdminAnnouncement, type AdminAnnouncementFields } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

export default function AdminAnnouncements() {
  const { t } = useLang();
  return <AdminShell title={t('الإعلانات', 'Announcements')}><Announcements /></AdminShell>;
}

type Editing = { mode: 'new' } | { mode: 'edit'; item: AdminAnnouncement } | null;

function Announcements() {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [loaded, setLoaded] = useState<{ items: AdminAnnouncement[]; loads: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.announcements().then((items) => { if (live) setLoaded((prev) => ({ items, loads: (prev?.loads ?? 0) + 1 })); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, version]);
  if (error) return <ErrorNote error={error} />;
  if (!loaded) return <Panel><Loading rows={3} /></Panel>;
  const saved = (message: string) => { setNotice(message); setEditing(null); setVersion((v) => v + 1); };
  return (
    <div className="ops">
      {notice && <p role="status" className="plan-notice">{notice}</p>}
      {editing && <Form key={editing.mode === 'edit' ? `${editing.item.id}:${loaded.loads}` : 'new'} item={editing.mode === 'edit' ? editing.item : null} onCancel={() => setEditing(null)} onSaved={saved} />}
      <Panel flush title={t('كل الإعلانات', 'Every announcement')} sub={t('تظهر لكل المتاجر في لوحة التحكم بين وقتي البداية والنهاية، بالعربية والإنجليزية.', 'Shown on every store dashboard between its start and end, in Arabic and English.')}
        actions={!editing ? <button type="button" className="btn btn-accent btn-sm" onClick={() => { setNotice(null); setEditing({ mode: 'new' }); }}>{t('إعلان جديد', 'New announcement')}</button> : undefined}>
        {loaded.items.length === 0 ? <Empty title={t('لا إعلانات', 'No announcements')} body={t('لم يُنشر أي إعلان بعد.', 'Nothing has been announced yet.')} /> : (
          <ul className="ops-list">
            {loaded.items.map((a) => (
              <li key={a.id}>
                <div className="ops-what">
                  <span>{lang === 'ar' ? a.titleAr : a.titleEn}</span>
                  <span>{formatDateTime(a.startsAt, lang)} – {formatDateTime(a.endsAt, lang)}{a.link ? <> · <span dir="ltr">{a.link}</span></> : null}</span>
                </div>
                <div>
                  <Badge tone={a.level === 'warning' ? 'warn' : 'accent'}>{a.level === 'warning' ? t('تنبيه', 'Warning') : t('معلومة', 'Info')}</Badge>
                  {' '}<Badge tone={a.live ? 'ok' : 'neutral'}>{a.live ? t('ظاهر الآن', 'Live now') : a.active ? t('خارج وقته', 'Not in its window') : t('متوقف', 'Off')}</Badge>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNotice(null); setEditing({ mode: 'edit', item: a }); }}>{t('تعديل', 'Edit')}</button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** `datetime-local` values are Riyadh wall-clock time (UTC+3, no DST). */
const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 16);
const fromLocal = (local: string) => (local ? new Date(`${local}:00+03:00`).toISOString() : '');

function Form({ item, onCancel, onSaved }: { item: AdminAnnouncement | null; onCancel: () => void; onSaved: (message: string) => void }) {
  const { t } = useLang();
  const auth = useAuth();
  const [f, setF] = useState(() => ({
    titleAr: item?.titleAr ?? '', titleEn: item?.titleEn ?? '', bodyAr: item?.bodyAr ?? '', bodyEn: item?.bodyEn ?? '',
    level: item?.level ?? 'info', link: item?.link ?? '', startsAt: item ? toLocal(item.startsAt) : '', endsAt: item ? toLocal(item.endsAt) : '',
    active: item?.active ?? true, reason: '',
  }));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const fields: AdminAnnouncementFields = {
    titleAr: f.titleAr, titleEn: f.titleEn, bodyAr: f.bodyAr.trim() || null, bodyEn: f.bodyEn.trim() || null,
    level: f.level as 'info' | 'warning', link: f.link.trim() || null, startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), active: f.active,
  };
  const ready = !!f.titleAr.trim() && !!f.titleEn.trim() && !!f.startsAt && !!f.endsAt && f.reason.trim().length >= 5;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setProblem(null);
    try {
      if (item) await auth.admin.updateAnnouncement(item.id, { ...fields, reason: f.reason.trim() });
      else await auth.admin.createAnnouncement({ ...fields, reason: f.reason.trim() });
      onSaved(item ? t('حُفظ الإعلان.', 'Announcement saved.') : t('نُشر الإعلان.', 'Announcement published.'));
    } catch (err) { setProblem((err as Error).message); setBusy(false); }
  };
  return (
    <Panel title={item ? t('تعديل إعلان', 'Edit announcement') : t('إعلان جديد', 'New announcement')} sub={t('بالعربية والإنجليزية معًا — لا يرى متجر إعلانًا بلغة واحدة.', 'In Arabic and English together — no store sees a one-language notice.')}>
      <form onSubmit={save} noValidate>
        <div className="coupon-grid">
          <div className="field"><label htmlFor="an-tar">{t('العنوان بالعربية', 'Title (Arabic)')}</label><input id="an-tar" dir="rtl" value={f.titleAr} onChange={(e) => set({ titleAr: e.target.value })} maxLength={120} /></div>
          <div className="field"><label htmlFor="an-ten">{t('العنوان بالإنجليزية', 'Title (English)')}</label><input id="an-ten" dir="ltr" value={f.titleEn} onChange={(e) => set({ titleEn: e.target.value })} maxLength={120} /></div>
          <div className="field"><label htmlFor="an-bar">{t('النص بالعربية (اختياري)', 'Text (Arabic, optional)')}</label><input id="an-bar" dir="rtl" value={f.bodyAr} onChange={(e) => set({ bodyAr: e.target.value })} maxLength={500} /></div>
          <div className="field"><label htmlFor="an-ben">{t('النص بالإنجليزية', 'Text (English)')}</label><input id="an-ben" dir="ltr" value={f.bodyEn} onChange={(e) => set({ bodyEn: e.target.value })} maxLength={500} /></div>
          <div className="field"><label htmlFor="an-from">{t('يبدأ (بتوقيت الرياض)', 'Starts (Riyadh)')}</label><input id="an-from" type="datetime-local" value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></div>
          <div className="field"><label htmlFor="an-to">{t('ينتهي', 'Ends')}</label><input id="an-to" type="datetime-local" value={f.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></div>
          <div className="field">
            <label htmlFor="an-level">{t('النوع', 'Kind')}</label>
            <select id="an-level" value={f.level} onChange={(e) => set({ level: e.target.value as 'info' | 'warning' })}>
              <option value="info">{t('معلومة', 'Info')}</option>
              <option value="warning">{t('تنبيه', 'Warning')}</option>
            </select>
          </div>
          <div className="field"><label htmlFor="an-link">{t('رابط داخل اللوحة (اختياري)', 'Dashboard link (optional)')}</label><input id="an-link" dir="ltr" value={f.link} onChange={(e) => set({ link: e.target.value })} placeholder="/dashboard/billing" maxLength={200} /></div>
        </div>
        <label className="toggle" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /><span>{t('فعّال', 'On')}</span></label>
        <div className="admin-actions">
          <div className="field act-reason"><label htmlFor="an-reason">{t('السبب', 'Reason')}</label><input id="an-reason" value={f.reason} onChange={(e) => set({ reason: e.target.value })} maxLength={500} placeholder={t('مثال: صيانة متفق عليها', 'e.g. agreed maintenance window')} /></div>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('إلغاء', 'Cancel')}</button>
            <button type="submit" className="btn btn-accent" disabled={busy || !ready}>{item ? t('احفظ', 'Save') : t('انشر', 'Publish')}</button>
          </div>
        </div>
        {problem && <p className="field-error" role="alert" style={{ margin: '8px 0 0' }}>{t('لم يُحفظ: ', 'Not saved: ')}<span dir="ltr">{problem}</span></p>}
      </form>
    </Panel>
  );
}
