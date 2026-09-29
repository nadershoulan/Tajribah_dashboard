'use client';

// MD-150 — Team management

import { useWriteLock } from '@/components/dashboard/write-lock';
import { useState, type FormEvent } from 'react';
import { Mail, ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { useData, useResource } from '@/lib/data';
import { formatRelative } from '@/lib/format';
import { CUSTOM_ROLE_PERMISSIONS, PERMISSION_LABELS, ROLE_LABEL, ROLE_PERMISSIONS, type CustomRolePermission } from '@/lib/permissions';
import { currentStore } from '@/lib/api-client';
import { planByCode } from '@/lib/plans';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import type { Bi, Lang } from '@/lib/lang';
import type { CustomRoleView, TeamMemberRow } from '@/lib/view-models';

export { ROLE_LABEL }; // lives in lib/permissions so the shell can use it too (P6)

const ROLE_BLURB: Record<TeamMemberRow['role'], Bi> = {
  owner: { ar: 'كل شيء، بما في ذلك إغلاق المتجر والاشتراك.', en: 'Everything, including the subscription and closing the store.' },
  admin: { ar: 'كل شيء عدا حذف المتجر.', en: 'Everything except deleting the store.' },
  editor: { ar: 'المنتجات والنماذج والنشر — بدون الفوترة.', en: 'Products, models and publishing — not billing.' },
  analyst: { ar: 'الأرقام والتصدير فقط.', en: 'Numbers and exports only.' },
  viewer: { ar: 'اطلاع فقط.', en: 'Read-only.' },
};

const INVITABLE: TeamMemberRow['role'][] = ['admin', 'editor', 'analyst', 'viewer'];

/** Server refusals are English; the ones this screen meets get their Arabic here. */
const TEAM_AR: [RegExp, string][] = [
  [/already on the team/, 'هذا الشخص عضو في الفريق بالفعل'],
  [/is not an email address/, 'هذا ليس بريدًا إلكترونيًا صحيحًا'],
  [/plan limit reached for team_members/, 'بلغت حد أعضاء الفريق في باقتك'],
  [/above your own/, 'لا يمكنك منح دور أعلى من دورك'],
  [/own role|remove yourself/, 'لا يمكنك تغيير عضويتك أنت'],
  [/owner/, 'لا يمكن تغيير المالك أو إزالته من هنا'],
  [/missing permission: team:/, 'دورك لا يسمح بإدارة الفريق'],
  [/still holds? this role/, 'ما زال أعضاء يحملون هذا الدور — أعطهم دورًا آخر أولًا'],
  [/name of a built-in role/, 'هذا اسم دور أساسي'],
  [/role with this name exists/, 'يوجد دور بهذا الاسم'],
];

export default function Team() {
  const { t, pick, lang } = useLang();
  const lock = useWriteLock(); // T50: a read-only store or a staff view changes nothing
  const source = useData();
  const auth = useAuth();
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useResource((s) => s.team(), [version]);
  const reload = () => setVersion((v) => v + 1);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamMemberRow['role']>('editor');
  const [mailLang, setMailLang] = useState<Lang>(lang);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const myEmail = auth.me?.user.email ?? null;
  // P8: custom roles are Enterprise; the plan decides whether this store sees them at all.
  const store = currentStore(auth.me);
  const customOn = store ? planByCode(store.plan).features.includes('custom_roles') : false;
  const roles = useResource((s) => (customOn ? s.customRoles() : Promise.resolve([] as CustomRoleView[])), [customOn, version]);

  /** Run one team action, then reload; the server's refusal is shown, in Arabic too. */
  const act = async (key: string, run: () => Promise<void>, done: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await run();
      setNotice({ ok: true, text: done });
      setConfirming(null);
      reload();
    } catch (failure) {
      const fields = (failure as { fields?: Record<string, string[]> }).fields;
      const raw = fields ? Object.values(fields).flat().join(' · ') : (failure as Error).message;
      setNotice({ ok: false, text: lang === 'ar' ? TEAM_AR.find(([p]) => p.test(raw))?.[1] ?? raw : raw });
    } finally {
      setBusy(null);
    }
  };
  const sendInvite = (event: FormEvent) => {
    event.preventDefault();
    void act('invite', () => source.invite(email, role, mailLang), t(`أُرسلت الدعوة إلى ${email}.`, `Invitation sent to ${email}.`))
      .then(() => { setEmail(''); });
  };

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('الفريق', 'Team') },
  ];

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('الفريق', 'Team')}
        lead={t(
          'ادعُ من يعمل معك، وأعطِ كل شخص أقل صلاحية تكفي عمله.',
          'Invite the people you work with, and give each one the smallest role that covers their job.',
        )}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setInviting((v) => !v)} aria-expanded={inviting} disabled={lock.locked} title={lock.title}>
            <UserPlus size={16} aria-hidden />{t('ادعُ عضوًا', 'Invite someone')}
          </button>
        }
      />

      {inviting && (
        <Panel title={t('دعوة عضو', 'Invite someone')} sub={t('نرسل رابطًا إلى بريده. يقبله بتسجيل الدخول بهذا البريد نفسه، خلال 7 أيام.', 'We email them a link. They accept by signing in with that same address, within 7 days.')}>
          <form className="invite-form" onSubmit={sendInvite}>
            <div className="field">
              <label htmlFor="invite-email">{t('البريد الإلكتروني', 'Email')}</label>
              <input id="invite-email" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="invite-role">{t('الدور', 'Role')}</label>
              <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as TeamMemberRow['role'])}>
                {INVITABLE.map((r) => <option key={r} value={r}>{pick(ROLE_LABEL[r])}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="invite-lang">{t('لغة الرسالة', 'Email language')}</label>
              <select id="invite-lang" value={mailLang} onChange={(e) => setMailLang(e.target.value as Lang)}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy === 'invite'}>
              {busy === 'invite' ? t('جارٍ الإرسال…', 'Sending…') : t('أرسل الدعوة', 'Send invitation')}
            </button>
          </form>
        </Panel>
      )}
      {notice && <p role="status" className={`upload-note ${notice.ok ? 'upload-done' : 'upload-failed'}`}>{notice.text}</p>}

      <Panel flush title={t('الأعضاء', 'Members')}>
        {loading && <Loading rows={3} />}
        {error && <ErrorNote error={error} />}
        {!loading && data && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">{t('العضو', 'Member')}</th>
                  <th scope="col">{t('الدور', 'Role')}</th>
                  <th scope="col">{t('الحالة', 'Status')}</th>
                  <th scope="col">{t('آخر دخول', 'Last sign-in')}</th>
                  <th scope="col"><span className="sr-only">{t('إجراءات', 'Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {data.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="cell-main">
                        <span className="tenant-avatar" aria-hidden>{member.fullName.slice(0, 2)}</span>
                        <span className="lines">
                          <strong>{member.fullName}</strong>
                          <span>{member.email}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      {member.role === 'owner' || member.status === 'invited' || member.email === myEmail
                        ? (member.customRole?.name ?? pick(ROLE_LABEL[member.role]))
                        : (
                          <select aria-label={t(`دور ${member.fullName || member.email}`, `Role of ${member.fullName || member.email}`)}
                            value={member.customRole ? `custom:${member.customRole.id}` : member.role} disabled={busy !== null || lock.locked} title={lock.title}
                            onChange={(e) => {
                              const value = e.target.value;
                              void act(member.id, () => (value.startsWith('custom:')
                                ? source.assignCustomRole(member.id, value.slice(7))
                                : source.changeRole(member.id, value as TeamMemberRow['role'])), t('تغيّر الدور.', 'Role changed.'));
                            }}>
                            {INVITABLE.map((r) => <option key={r} value={r}>{pick(ROLE_LABEL[r])}</option>)}
                            {(roles.data?.length ?? 0) > 0 && (
                              <optgroup label={t('أدوار متجرك', 'Your roles')}>
                                {roles.data!.map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                        )}
                    </td>
                    <td>
                      {member.status === 'active' && <Badge tone="ok" dot>{t('نشط', 'Active')}</Badge>}
                      {member.status === 'invited' && <Badge tone="warn"><Mail size={12} aria-hidden />{t('دعوة معلّقة', 'Invited')}</Badge>}
                      {member.status === 'suspended' && <Badge tone="bad">{t('موقوف', 'Suspended')}</Badge>}
                    </td>
                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>
                      {member.lastLoginAt ? formatRelative(member.lastLoginAt, lang) : '—'}
                    </td>
                    <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                      {member.status === 'invited' && (
                        <button type="button" className="btn btn-quiet btn-sm" disabled={busy !== null || lock.locked} title={lock.title}
                          onClick={() => void act(member.id, () => source.revokeInvitation(member.id), t('أُلغيت الدعوة.', 'Invitation cancelled.'))}>
                          {t('ألغِ الدعوة', 'Cancel invitation')}
                        </button>
                      )}
                      {member.status !== 'invited' && member.role !== 'owner' && member.email !== myEmail && (
                        confirming === member.id
                          ? (
                            <span style={{ display: 'inline-flex', gap: 6 }}>
                              <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null}
                                onClick={() => void act(member.id, () => source.removeMember(member.id), t('أُزيل العضو.', 'Member removed.'))}>
                                {t('نعم، أزِله', 'Yes, remove')}
                              </button>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>{t('إلغاء', 'Cancel')}</button>
                            </span>
                          )
                          : <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(member.id)} disabled={lock.locked} title={lock.title}>{t('إزالة', 'Remove')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {customOn && <CustomRoles roles={roles.data ?? null} locked={lock.locked} lockTitle={lock.title} onChange={reload} />}

      <Panel title={t('ماذا يستطيع كل دور', 'What each role can do')} sub={t('الصلاحيات تُطبَّق في الخادم، لا في الواجهة فقط.', 'Permissions are enforced on the server, not only in the interface.')}>
        <div className="grid grid-2">
          {(Object.keys(ROLE_LABEL) as TeamMemberRow['role'][]).map((role) => (
            <div key={role} style={{ display: 'flex', gap: 10 }}>
              <ShieldCheck size={16} aria-hidden style={{ flex: '0 0 auto', marginTop: 3, color: 'var(--aqua)' }} />
              <div>
                <strong style={{ fontSize: 14.5 }}>{pick(ROLE_LABEL[role])}</strong>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-2)' }}>{pick(ROLE_BLURB[role])}</p>
                <p className="hint" style={{ marginTop: 2 }}>
                  {t(
                    `${ROLE_PERMISSIONS[role].length} صلاحية`,
                    `${ROLE_PERMISSIONS[role].length} permissions`,
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </Shell>
  );
}

/**
 * P8 — the store's own roles (Enterprise): a name and the work it covers. People, settings,
 * billing, keys and connections are not on the list — those stay with owners and admins.
 */
function CustomRoles({ roles, locked, lockTitle, onChange }: { roles: CustomRoleView[] | null; locked: boolean; lockTitle: string | undefined; onChange: () => void }) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<CustomRolePermission[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const say = (raw: string) => (lang === 'ar' ? TEAM_AR.find(([p]) => p.test(raw))?.[1] ?? raw : raw);

  const open = (role: CustomRoleView | null) => {
    setEditing(role ? role.id : 'new');
    setName(role?.name ?? '');
    setChosen((role?.permissions ?? ['products:read']) as CustomRolePermission[]);
    setProblem(null);
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setProblem(null);
    try { await fn(); setEditing(null); setConfirming(null); onChange(); } catch (failure) {
      const fields = (failure as { fields?: Record<string, string[]> }).fields;
      setProblem(say(fields ? Object.values(fields).flat().join(' · ') : (failure as Error).message));
    } finally { setBusy(false); }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(() => (editing === 'new' ? source.createCustomRole({ name, permissions: chosen }) : source.updateCustomRole(editing!, { name, permissions: chosen })));
  };

  return (
    <Panel title={t('أدوار متجرك', 'Your roles')}
      sub={t('أدوار بأسمائك لما يحتاجه كل عمل — المنتجات، النماذج، العرض، التجربة، التحليلات. إدارة الفريق والإعدادات والفوترة والمفاتيح تبقى للمالك والمديرين.',
        'Roles you name, for what each job needs — products, models, AR, try-on, analytics. The team, settings, billing and keys stay with owners and admins.')}
      actions={editing === null ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(null)} disabled={locked} title={lockTitle}>{t('دور جديد', 'New role')}</button> : undefined}>
      {editing !== null && (
        <form className="key-form" onSubmit={save} style={{ marginTop: 0 }}>
          <label className="field">
            <span>{t('اسم الدور', 'Role name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('مثلًا: مصوّر', 'e.g. Photographer')} autoFocus />
          </label>
          <fieldset>
            <legend>{t('ما يستطيعه', 'What it can do')}</legend>
            {CUSTOM_ROLE_PERMISSIONS.map((p) => (
              <label key={p} className="toggle">
                <input type="checkbox" checked={chosen.includes(p)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p] : c.filter((x) => x !== p)))} />
                <span>{pick(PERMISSION_LABELS[p])}</span>
              </label>
            ))}
          </fieldset>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || name.trim().length < 2 || !chosen.length}>{editing === 'new' ? t('أنشئ الدور', 'Create the role') : t('احفظ', 'Save')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} disabled={busy}>{t('إلغاء', 'Cancel')}</button>
          </div>
        </form>
      )}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {roles && roles.length === 0 && editing === null && <p className="hint" style={{ margin: 0 }}>{t('لا أدوار بعد.', 'No roles yet.')}</p>}
      {roles && roles.length > 0 && (
        <ul className="role-list">
          {roles.map((role) => (
            <li key={role.id}>
              <div className="job-main">
                <strong>{role.name}</strong>
                <span className="hint" style={{ margin: 0 }}>{t(`${role.members} عضو`, `${role.members} ${role.members === 1 ? 'member' : 'members'}`)}</span>
              </div>
              <p className="hint" style={{ margin: '4px 0 0' }}>{role.permissions.map((p) => (p in PERMISSION_LABELS ? pick(PERMISSION_LABELS[p as CustomRolePermission]) : p)).join(t('، ', ', '))}</p>
              <div className="job-meta hint">
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => open(role)} disabled={busy || locked} title={lockTitle}>{t('عدّل', 'Edit')}</button>
                {confirming === role.id
                  ? <span className="confirm-inline" role="alertdialog" aria-label={t('حذف الدور', 'Delete the role')}>
                      <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void run(() => source.deleteCustomRole(role.id))}>{t('نعم، احذف', 'Yes, delete')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)} disabled={busy}>{t('تراجع', 'Keep it')}</button>
                    </span>
                  : <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(role.id)} disabled={busy || locked} title={lockTitle}>{t('احذف', 'Delete')}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
