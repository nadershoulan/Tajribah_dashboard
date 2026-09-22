'use client';

// MD-150 — Team management

import { Mail, ShieldCheck, UserPlus } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { formatRelative } from '@/lib/format';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import type { Bi } from '@/lib/lang';
import type { TeamMemberRow } from '@/lib/view-models';

const ROLE_LABEL: Record<TeamMemberRow['role'], Bi> = {
  owner: { ar: 'مالك', en: 'Owner' },
  admin: { ar: 'مدير', en: 'Admin' },
  editor: { ar: 'محرّر', en: 'Editor' },
  analyst: { ar: 'محلّل', en: 'Analyst' },
  viewer: { ar: 'مشاهد', en: 'Viewer' },
};

const ROLE_BLURB: Record<TeamMemberRow['role'], Bi> = {
  owner: { ar: 'كل شيء، بما في ذلك إغلاق المتجر والاشتراك.', en: 'Everything, including the subscription and closing the store.' },
  admin: { ar: 'كل شيء عدا حذف المتجر.', en: 'Everything except deleting the store.' },
  editor: { ar: 'المنتجات والنماذج والنشر — بدون الفوترة.', en: 'Products, models and publishing — not billing.' },
  analyst: { ar: 'الأرقام والتصدير فقط.', en: 'Numbers and exports only.' },
  viewer: { ar: 'اطلاع فقط.', en: 'Read-only.' },
};

export default function Team() {
  const { t, pick, lang } = useLang();
  const { data, loading, error } = useResource((source) => source.team());

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
          <button type="button" className="btn btn-primary">
            <UserPlus size={16} aria-hidden />{t('ادعُ عضوًا', 'Invite someone')}
          </button>
        }
      />

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
                    <td>{pick(ROLE_LABEL[member.role])}</td>
                    <td>
                      {member.status === 'active' && <Badge tone="ok" dot>{t('نشط', 'Active')}</Badge>}
                      {member.status === 'invited' && <Badge tone="warn"><Mail size={12} aria-hidden />{t('دعوة معلّقة', 'Invited')}</Badge>}
                      {member.status === 'suspended' && <Badge tone="bad">{t('موقوف', 'Suspended')}</Badge>}
                    </td>
                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>
                      {member.lastLoginAt ? formatRelative(member.lastLoginAt, lang) : '—'}
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      {member.role !== 'owner' && (
                        <button type="button" className="btn btn-quiet btn-sm">{t('تعديل', 'Edit')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

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
