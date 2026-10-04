'use client';

// MD-095 — All your stores (T62: agency accounts)

import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useEnv } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { formatNumber, formatRelative } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/permissions';
import { planByCode } from '@/lib/plans';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, Panel, type BadgeTone } from '@/components/dashboard/ui';
import type { Bi } from '@/lib/lang';
import type { StoreOverview } from '@/lib/view-models';

const ATTENTION: Record<StoreOverview['attention'][number], { tone: BadgeTone; label: Bi }> = {
  suspended: { tone: 'bad', label: { ar: 'موقوف', en: 'Suspended' } },
  read_only: { tone: 'bad', label: { ar: 'للقراءة فقط', en: 'Read-only' } },
  past_due: { tone: 'warn', label: { ar: 'دفعة متأخرة', en: 'Payment due' } },
  trial_ending: { tone: 'warn', label: { ar: 'التجربة تنتهي قريبًا', en: 'Trial ending' } },
  connection: { tone: 'warn', label: { ar: 'ربط المتجر يحتاج انتباهك', en: 'Store connection needs attention' } },
  setup: { tone: 'neutral', label: { ar: 'الإعداد لم يكتمل', en: 'Setup not finished' } },
};

const PROVIDER: Record<NonNullable<StoreOverview['connection']>['provider'], Bi> = {
  salla: { ar: 'سلة', en: 'Salla' }, zid: { ar: 'زد', en: 'Zid' }, shopify: { ar: 'Shopify', en: 'Shopify' }, woocommerce: { ar: 'WooCommerce', en: 'WooCommerce' }, feed: { ar: 'ملف أو رابط منتجات', en: 'Product feed or file' },
};
const HEALTH: Record<NonNullable<StoreOverview['connection']>['health'], BadgeTone> = { healthy: 'ok', attention: 'warn', failing: 'bad' };

/**
 * Every store this person can open — an agency's clients, or one owner's several stores — with what
 * needs a person first. Opening one is the store switcher's full page load, so no screen can show one
 * store's data under another's name.
 */
export default function AgencyStores() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const env = useEnv();
  const { data, loading, error } = useResource((source) => source.storesOverview(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const current = auth.me?.currentTenantId ?? null;

  const open = async (id: string) => {
    setBusy(id); setFailed(false);
    try {
      if (id !== current) await auth.switchTenant(id);
      if (auth.live) window.location.assign(env.toHref('/dashboard'));
      else env.navigate('/dashboard');
    } catch {
      setFailed(true); setBusy(null);
    }
  };
  const needing = (data ?? []).filter((s) => s.attention.length > 0).length;

  return (
    <Shell tenant={null} crumbs={[{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('كل المتاجر', 'All stores') }]}>
      <PageHead
        title={t('كل متاجرك', 'All your stores')}
        lead={t(
          'كل متجر تديره — متاجر عملائك إن كنت وكالة — في مكان واحد، وما يحتاج انتباهك أولًا. يدعوك العميل من صفحة الفريق في متجره، أو تضيف متجرًا من قائمة المتاجر وتدعو صاحبه.',
          'Every store you manage — your clients’ stores, if you are an agency — in one place, with what needs you first. A client invites you from their store’s Team page, or you add a store from the store menu and invite its owner.',
        )}
      />
      {failed && <p role="alert" className="upload-note upload-failed">{t('تعذّر فتح المتجر. حاول مرة أخرى.', 'The store could not be opened. Try again.')}</p>}
      <Panel flush title={data ? t(`المتاجر: ${formatNumber(data.length, lang)} · تحتاج انتباهك: ${formatNumber(needing, lang)}`, `${formatNumber(data.length, lang)} ${data.length === 1 ? 'store' : 'stores'} · ${formatNumber(needing, lang)} ${needing === 1 ? 'needs' : 'need'} attention`) : t('المتاجر', 'Stores')}>
        {loading && <Loading rows={4} />}
        {error && <ErrorNote error={error} />}
        {!loading && data && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">{t('المتجر', 'Store')}</th>
                  <th scope="col">{t('الباقة', 'Plan')}</th>
                  <th scope="col">{t('المنتجات', 'Products')}</th>
                  <th scope="col">{t('ربط المتجر', 'Store connection')}</th>
                  <th scope="col">{t('آخر 30 يومًا', 'Last 30 days')}</th>
                  <th scope="col">{t('يحتاج انتباهك', 'Needs attention')}</th>
                  <th scope="col"><span className="sr-only">{t('فتح', 'Open')}</span></th>
                </tr>
              </thead>
              <tbody>
                {data.map((s) => {
                  const plan = s.plan ? planByCode(s.plan as Parameters<typeof planByCode>[0]) : null;
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>{s.id === current && <> {' '}<Badge tone="accent">{t('الحالي', 'Current')}</Badge></>}
                        <div className="hint" style={{ margin: 0 }}>{pick(ROLE_LABEL[s.role as keyof typeof ROLE_LABEL] ?? { ar: s.role, en: s.role })}</div>
                      </td>
                      <td>{plan ? pick(plan.name) : '—'}{s.status === 'trial' && s.trialEndsAt ? <div className="hint" style={{ margin: 0 }}>{t('تجربة حتى', 'Trial until')} {new Date(s.trialEndsAt).toLocaleDateString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB')}</div> : null}</td>
                      <td>
                        {formatNumber(s.products, lang)}
                        <div className="hint" style={{ margin: 0 }}>{t(`${formatNumber(s.liveButtons, lang)} منشور في المتجر`, `${formatNumber(s.liveButtons, lang)} live in the shop`)}</div>
                      </td>
                      <td>
                        {s.connection ? (
                          <>
                            <Badge tone={HEALTH[s.connection.health]} dot>{pick(PROVIDER[s.connection.provider])}</Badge>
                            <div className="hint" style={{ margin: 0 }}>{s.connection.lastSyncAt ? `${t('آخر مزامنة', 'Last sync')} ${formatRelative(s.connection.lastSyncAt, lang)}` : t('لم تتم مزامنة بعد', 'Not synced yet')}</div>
                          </>
                        ) : <span className="hint" style={{ margin: 0 }}>{t('غير مربوط', 'Not connected')}</span>}
                      </td>
                      <td>
                        <span dir="ltr">{formatNumber(s.last30.views, lang)}</span> {t('مشاهدة', 'views')}
                        <div className="hint" style={{ margin: 0 }}>{t(`${formatNumber(s.last30.arSessions, lang)} عرض ثلاثي الأبعاد · ${formatNumber(s.last30.tryonSessions, lang)} تجربة`, `${formatNumber(s.last30.arSessions, lang)} 3D views · ${formatNumber(s.last30.tryonSessions, lang)} try-ons`)}</div>
                      </td>
                      <td>
                        {s.attention.length === 0
                          ? <Badge tone="ok">{t('كل شيء على ما يرام', 'All good')}</Badge>
                          : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{s.attention.map((a) => <Badge key={a} tone={ATTENTION[a].tone}>{pick(ATTENTION[a].label)}</Badge>)}</span>}
                      </td>
                      <td>
                        <button type="button" className="btn btn-ghost" disabled={busy !== null || s.status === 'suspended'} onClick={() => void open(s.id)}
                          aria-label={t(`افتح ${s.name}`, `Open ${s.name}`)}>
                          {busy === s.id ? t('جارٍ…', '…') : t('افتح', 'Open')}<ArrowUpRight size={15} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Shell>
  );
}
