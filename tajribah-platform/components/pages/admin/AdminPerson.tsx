'use client';

// ADM-12 — User detail: their stores, where they are signed in, and the account actions (A5)

import { useEffect, useState } from 'react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useAuth, type AdminPersonAction, type AdminPersonDetail } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';
import { ROLE_LABEL } from '@/components/pages/Team';
import { STATUS_LABEL } from './AdminStores';

export default function AdminPerson() {
  const { t } = useLang();
  return <AdminShell title={t('شخص', 'Person')}><Detail /></AdminShell>;
}

function Detail() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const env = useEnv();
  const id = env.path.split('/').filter(Boolean).pop() ?? '';
  const [data, setData] = useState<{ id: string; detail: AdminPersonDetail } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    auth.admin.person(id).then((detail) => { if (live) setData({ id, detail }); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, id, version]);

  if (error) return <ErrorNote error={error} />;
  if (!data || data.id !== id) return <Panel><Loading rows={5} /></Panel>;
  const { person, stores, sessions, staffTrail } = data.detail;
  return (
    <>
      <p style={{ marginTop: 0 }}><AppLink href="/admin/people">{t('كل الأشخاص', 'Everyone')}</AppLink></p>
      <div className="grid grid-2">
        <Panel title={person.fullName || person.email} sub={person.fullName ? person.email : undefined}>
          <dl className="facts">
            <dt>{t('البريد', 'Email')}</dt><dd>{person.emailVerified ? t('مؤكد', 'Verified') : <Badge tone="warn">{t('غير مؤكد', 'Not verified')}</Badge>}</dd>
            <dt>{t('التحقق بخطوتين', 'Two-step sign-in')}</dt>
            <dd>{person.twoFactor ? t(`مفعّل · ${person.backupCodesLeft} رموز احتياطية`, `On · ${person.backupCodesLeft} backup codes left`) : t('غير مفعّل', 'Off')}</dd>
            <dt>{t('آخر دخول', 'Last sign-in')}</dt><dd>{person.lastLoginAt ? formatDateTime(person.lastLoginAt, lang) : '—'}</dd>
            {person.lockedUntil && <><dt>{t('مقفل حتى', 'Locked until')}</dt><dd>{formatDateTime(person.lockedUntil, lang)}</dd></>}
            <dt>{t('اللغة', 'Language')}</dt><dd>{person.locale === 'ar' ? 'العربية' : 'English'}</dd>
            <dt>{t('الجوال', 'Phone')}</dt><dd dir="ltr" className="mm">{person.phone ?? '—'}</dd>
            <dt>{t('أُنشئ', 'Created')}</dt><dd>{formatDate(person.createdAt, lang)}</dd>
            {person.isStaff && <><dt>{t('الدور', 'Role')}</dt><dd><Badge tone="accent">{t('موظف في تجربة', 'Tajribah staff')}</Badge></dd></>}
            <dt>{t('المعرّف', 'Id')}</dt><dd dir="ltr" className="mm">{person.id}</dd>
          </dl>
        </Panel>
        <Panel flush title={t('المتاجر', 'Stores')}>
          {stores.length === 0 ? <Empty title={t('لا متاجر', 'No stores')} body={t('ليس عضوًا في أي متجر.', 'Not a member of any store.')} /> : (
            <div className="table-wrap"><table className="data"><tbody>
              {stores.map((s) => (
                <tr key={s.id}>
                  <td className="cell-main"><AppLink href={`/admin/stores/${s.id}`}>{lang === 'ar' ? s.nameAr ?? s.name : s.name}</AppLink><span className="lines"><span dir="ltr">{s.slug}</span></span></td>
                  <td>{pick(ROLE_LABEL[s.role])}{s.membership !== 'active' ? ` · ${s.membership}` : ''}</td>
                  <td>{pick(STATUS_LABEL[s.status])}</td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </Panel>
      </div>
      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <Panel flush title={t('الجلسات المفتوحة', 'Signed in on')} sub={t(`${sessions.length} جلسة`, `${sessions.length} session${sessions.length === 1 ? '' : 's'}`)}>
          {sessions.length === 0 ? <Empty title={t('لا جلسات', 'Nowhere')} body={t('ليس مسجّل الدخول على أي جهاز.', 'Not signed in on any device.')} /> : (
            <div className="table-wrap"><table className="data"><tbody>
              {sessions.map((s) => <tr key={s.id}><td dir="ltr">{s.userAgent ?? '—'}</td><td>{t('منذ', 'Since')} {formatDate(s.createdAt, lang)}</td><td>{s.lastSeenAt ? formatDateTime(s.lastSeenAt, lang) : '—'}</td></tr>)}
            </tbody></table></div>
          )}
        </Panel>
        <Panel flush title={t('ما فعله الموظفون في هذا الحساب', 'Staff actions on this account')}>
          {staffTrail.length === 0 ? <Empty title={t('لا شيء', 'None')} body={t('لم يُجرِ أي موظف تغييرًا على هذا الحساب.', 'No staff member has changed this account.')} /> : (
            <div className="table-wrap"><table className="data"><tbody>
              {staffTrail.map((r) => <tr key={r.id}><td>{formatDateTime(r.at, lang)}</td><td dir="ltr">{r.staff}</td><td className="mm" dir="ltr">{r.action}</td><td>{r.reason ?? '—'}</td></tr>)}
            </tbody></table></div>
          )}
        </Panel>
      </div>
      <div style={{ marginTop: 18 }}><Actions person={person} onDone={() => setVersion((v) => v + 1)} /></div>
    </>
  );
}

/** The server's refusals (server/modules/admin/users.ts), in Arabic; anything else as sent. */
const REFUSALS: Record<string, string> = {
  'ask another staff member to change your own account': 'اطلب من موظف آخر تغيير حسابك',
  'two-step sign-in is already off for this person': 'التحقق بخطوتين غير مفعّل لهذا الشخص',
};

function Actions({ person, onDone }: { person: AdminPersonDetail['person']; onDone: () => void }) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const kinds: { kind: AdminPersonAction['type']; label: string }[] = [
    { kind: 'end_sessions', label: t('إنهاء كل الجلسات', 'Sign out everywhere') },
    ...(person.twoFactor ? [{ kind: 'reset_two_factor' as const, label: t('إيقاف التحقق بخطوتين', 'Reset two-step sign-in') }] : []),
  ];
  const [chosen, setChosen] = useState<AdminPersonAction['type'] | null>(null);
  const kind = kinds.some((k) => k.kind === chosen) ? chosen! : kinds[0]!.kind;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const reasonProblem = reason.trim().length < 5;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reasonProblem) return;
    setBusy(true); setProblem(null); setDone(null);
    try {
      const { sessionsEnded } = await auth.admin.actOnPerson(person.id, { type: kind, reason: reason.trim() });
      setDone(t(`تم. أُنهيت ${sessionsEnded} جلسة.`, `Done. ${sessionsEnded} session${sessionsEnded === 1 ? '' : 's'} ended.`));
      setReason('');
      onDone();
    } catch (err) {
      setProblem((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Panel
      title={t('إجراءات على الحساب', 'Act on this account')}
      sub={kind === 'reset_two_factor'
        ? t('يُنهي كل الجلسات، ويصل الشخص بريد بذلك. تحقّق من هويته أولًا.', 'Ends every session, and the person is emailed. Check who they are first.')
        : t('يُسجَّل الإجراء مع سببه في سجل الموظفين.', 'Recorded with its reason in the staff activity.')}
    >
      <form className="admin-actions" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="person-act">{t('الإجراء', 'Action')}</label>
          <select id="person-act" value={kind} onChange={(e) => { setChosen(e.target.value as AdminPersonAction['type']); setDone(null); }}>
            {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </div>
        <div className="field act-reason">
          <label htmlFor="person-reason">{t('السبب', 'Reason')}</label>
          <input id="person-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
            placeholder={kind === 'reset_two_factor' ? t('مثال: فقد جواله، تحققنا منه باتصال', 'e.g. lost phone, identity checked on a call') : t('مثال: سُرق جهازه', 'e.g. laptop stolen')} />
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-danger" disabled={busy || reasonProblem}>{busy ? t('جارٍ التنفيذ…', 'Working…') : kinds.find((k) => k.kind === kind)!.label}</button>
        </div>
      </form>
      {problem && <p className="field-error" role="alert" style={{ margin: '8px 0 0' }}>{t('لم يُنفَّذ: ', 'Not done: ')}{lang === 'ar' && REFUSALS[problem] ? REFUSALS[problem] : <span dir="ltr">{problem}</span>}</p>}
      {done && <p role="status" style={{ color: 'var(--ok)', margin: '8px 0 0' }}>{done}</p>}
    </Panel>
  );
}
