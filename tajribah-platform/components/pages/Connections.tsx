'use client';

// MD-030 — Store connections

import { AlertTriangle, CheckCircle2, Link2, RefreshCw, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { useData, useResource } from '@/lib/data';
import type { ConnectionDetail, SyncProgress } from '@/lib/view-models';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import type { Bi } from '@/lib/lang';
import { HEALTH_LEVELS, HEALTH_REASONS, type HealthLevel } from '@/lib/connection-health';

type ProviderCard = {
  id: 'salla' | 'zid' | 'shopify' | 'woocommerce';
  name: Bi;
  blurb: Bi;
  tier: 'first-class' | 'secondary';
  /** What has to exist before this can be switched on at all (§12). */
  blockedBy: Bi | null;
};

const PROVIDERS: ProviderCard[] = [
  {
    id: 'salla',
    name: { ar: 'سلة', en: 'Salla' },
    blurb: { ar: 'استيراد المنتجات والمخزون والطلبات، وتحديث تلقائي عند كل تغيير.', en: 'Products, stock and orders, kept up to date automatically on every change.' },
    tier: 'first-class',
    blockedBy: { ar: 'بانتظار اعتماد حساب شريك سلة', en: 'Waiting on Salla partner account approval' },
  },
  {
    id: 'zid',
    name: { ar: 'زد', en: 'Zid' },
    blurb: { ar: 'نفس التكامل الكامل لمتاجر زد.', en: 'The same full integration for Zid stores.' },
    tier: 'first-class',
    blockedBy: { ar: 'بانتظار حساب شريك زد', en: 'Waiting on a Zid partner account' },
  },
  {
    id: 'shopify',
    name: { ar: 'Shopify', en: 'Shopify' },
    blurb: { ar: 'تطبيق يُضاف لمتجرك ويستورد الكتالوج.', en: 'An app you add to your store that imports the catalogue.' },
    tier: 'secondary',
    blockedBy: null,
  },
  {
    id: 'woocommerce',
    name: { ar: 'WooCommerce', en: 'WooCommerce' },
    blurb: { ar: 'إضافة ووردبريس ومفتاح واجهة برمجية.', en: 'A WordPress plugin and an API key.' },
    tier: 'secondary',
    blockedBy: null,
  },
];

export default function Connections() {
  const { t, pick } = useLang();
  // Bumped to reload after an action, and on a timer while a sync is running.
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useResource((source) => source.connections(), [version]);
  const syncing = (data ?? []).some((c) => c.latestSync?.status === 'queued' || c.latestSync?.status === 'running');
  useEffect(() => {
    if (!syncing) return;
    const timer = setTimeout(() => setVersion((v) => v + 1), 3000);
    return () => clearTimeout(timer);
  }, [syncing, version]);

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('ربط المتجر', 'Store connections') },
  ];
  const linked = new Set((data ?? []).filter((c) => c.status === 'active').map((c) => c.provider));

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('ربط المتجر', 'Store connections')}
        lead={t(
          'اربط متجرك مرة واحدة، ونستورد منتجاتك ومقاساتها وصورها، ونبقيها محدّثة كلما غيّرت شيئًا.',
          'Connect your store once. We import your products, their sizes and their images, and keep them current as you change them.',
        )}
      />

      {loading && !data && <Panel><Loading rows={4} /></Panel>}
      {error && <ErrorNote error={error} />}
      {(data ?? []).map((connection) => (
        <ConnectionPanel key={connection.id} connection={connection} onChanged={() => setVersion((v) => v + 1)} />
      ))}

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        {PROVIDERS.map((provider) => {
          const connected = linked.has(provider.id);
          return (
            <section className="panel" key={provider.id} style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <strong style={{ fontSize: 16 }}>{pick(provider.name)}</strong>
                {provider.tier === 'first-class' && (
                  <Badge tone="accent">{t('تكامل كامل', 'Full integration')}</Badge>
                )}
                {connected && <Badge tone="ok" dot>{t('متصل', 'Connected')}</Badge>}
              </div>
              <p style={{ margin: '0 0 14px', color: 'var(--text-2)', fontSize: 14 }}>{pick(provider.blurb)}</p>

              {connected ? (
                <span className="badge badge-ok"><CheckCircle2 size={13} aria-hidden />{t('مربوط بمتجرك', 'Linked to your store')}</span>
              ) : provider.blockedBy ? (
                <>
                  <button type="button" className="btn btn-ghost" disabled>
                    <Link2 size={16} aria-hidden />{t('اربط', 'Connect')}
                  </button>
                  <p className="hint" style={{ marginTop: 8 }}>{pick(provider.blockedBy)}</p>
                </>
              ) : (
                <button type="button" className="btn btn-ghost">
                  <Link2 size={16} aria-hidden />{t('اربط', 'Connect')}
                </button>
              )}
            </section>
          );
        })}
      </div>

      <Panel title={t('ماذا نقرأ من متجرك', 'What we read from your store')} >
        <ul style={{ margin: 0, paddingInlineStart: 18, color: 'var(--text-2)', fontSize: 14, lineHeight: 2 }}>
          <li>{t('اسم المنتج ووصفه وسعره وصوره ومخزونه.', 'Product name, description, price, images and stock.')}</li>
          <li>{t('المقاسات إن كانت موجودة — وإلا نطلبها منك، فهي أساس الحجم الحقيقي.', 'Dimensions where they exist — otherwise we ask you for them, since true size depends on them.')}</li>
          <li>{t('تحديثات فورية عبر الويب هوك عند أي تغيير في متجرك.', 'Live webhook updates whenever something changes in your store.')}</li>
        </ul>
        <p className="hint">
          {t(
            'لا نقرأ بيانات عملائك ولا طلباتهم الشخصية. ما نحتاجه هو الكتالوج وأحداث المبيعات المجمّعة لقياس الأثر.',
            'We do not read your customers’ personal data. What we need is the catalogue and aggregate sales events, to measure impact.',
          )}
        </p>
      </Panel>
    </Shell>
  );
}

const HEALTH_TONE: Record<HealthLevel, 'ok' | 'warn' | 'bad'> = { healthy: 'ok', attention: 'warn', failing: 'bad' };

const STATUS: Record<ConnectionDetail['status'], { tone: 'ok' | 'bad' | 'warn'; label: Bi }> = {
  active: { tone: 'ok', label: { ar: 'نشط', en: 'Active' } },
  expired: { tone: 'warn', label: { ar: 'انتهت الصلاحية', en: 'Access expired' } },
  revoked: { tone: 'bad', label: { ar: 'مفصول', en: 'Disconnected' } },
  error: { tone: 'bad', label: { ar: 'يحتاج انتباهك', en: 'Needs attention' } },
};

function ConnectionPanel({ connection, onChanged }: { connection: ConnectionDetail; onChanged: () => void }) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [busy, setBusy] = useState<'sync' | 'disconnect' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const sync = connection.latestSync;
  const running = sync?.status === 'queued' || sync?.status === 'running';
  const active = connection.status === 'active';

  const act = async (kind: 'sync' | 'disconnect') => {
    setBusy(kind);
    setFailure(null);
    try {
      if (kind === 'sync') await source.syncNow(connection.id);
      else await source.disconnect(connection.id);
      setConfirming(false);
      onChanged();
    } catch (error) {
      setFailure(error as Error);
    } finally {
      setBusy(null);
    }
  };

  const n = (value: number) => formatNumber(value, lang);
  const status = STATUS[connection.status];
  return (
    <Panel
      title={t('المتجر المتصل', 'Connected store')}
      actions={active && (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => act('sync')} disabled={running || busy !== null}>
            <RefreshCw size={14} aria-hidden />{running ? t('تجري المزامنة…', 'Syncing…') : t('مزامنة الآن', 'Sync now')}
          </button>
          {!confirming && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(true)} disabled={busy !== null}>{t('فصل', 'Disconnect')}</button>
          )}
        </>
      )}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span className="empty-icon" style={{ margin: 0, width: 44, height: 44 }}>
          <ShoppingBag size={20} aria-hidden />
        </span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 16 }}>{connection.storeName}</strong>
            <Badge tone={status.tone} dot>{pick(status.label)}</Badge>
            {active && (
              <Badge tone={HEALTH_TONE[connection.health.level]}>
                {pick(HEALTH_LEVELS[connection.health.level])} · <span className="num" dir="ltr">{connection.health.score}</span>
              </Badge>
            )}
          </div>
          <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13.5, overflowWrap: 'anywhere' }}>
            {connection.storeUrl ? `${connection.storeUrl} · ` : ''}{t('المنتجات', 'Products')}: <span className="num">{n(connection.productCount)}</span>
          </p>
          {connection.lastSyncAt && (
            <p style={{ margin: '4px 0 0', color: 'var(--text-3)', fontSize: 13 }}>
              {t('آخر مزامنة', 'Last sync')} {formatRelative(connection.lastSyncAt, lang)}
              {' · '}{formatDateTime(connection.lastSyncAt, lang)}
            </p>
          )}
          {sync && <SyncLine sync={sync} />}
          {/* P6.16: why the connection is not fully healthy — "reconnect" is explained below for a store that is not active. */}
          {connection.health.reasons.filter((r) => r !== 'reconnect').length > 0 && (
            <ul className="health-reasons">
              {connection.health.reasons.filter((r) => r !== 'reconnect').map((r) => <li key={r}>{pick(HEALTH_REASONS[r])}</li>)}
            </ul>
          )}
          {connection.lastError && (
            <p role="alert" style={{ margin: '8px 0 0', color: 'var(--bad)', fontSize: 13 }}>
              <AlertTriangle size={13} aria-hidden /> {connection.lastError}
            </p>
          )}
          {!active && (
            <p className="hint">
              {connection.status === 'revoked'
                ? t('المتجر مفصول ولن يُزامن. منتجاتك باقية هنا. أعد الربط لاستئناف المزامنة.', 'This store is disconnected and will not sync. Your products stay here. Reconnect it to resume syncing.')
                : t('انتهى إذن الوصول إلى متجرك. أعد الربط لاستئناف المزامنة.', 'Access to your store has lapsed. Reconnect it to resume syncing.')}
            </p>
          )}
        </div>
        <div style={{ minWidth: 170 }}>
          <div className="usage-top" style={{ fontSize: 13, marginBottom: 4 }}>
            <span>{t('تحديثات المتجر (24 ساعة)', 'Store updates (24 h)')}</span>
          </div>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            <span className="num">{n(connection.webhooks.last24h.processed)}</span> {t('نُفّذت', 'handled')}
            {connection.webhooks.last24h.failed > 0 && (
              <> · <span className="num" style={{ color: 'var(--bad)' }}>{n(connection.webhooks.last24h.failed)}</span> {t('فشلت', 'failed')}</>
            )}
          </p>
          {connection.webhooks.lastFailure && (
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-3)' }}>
              {t('آخر فشل', 'Last failure')} {formatRelative(connection.webhooks.lastFailure.at, lang)} · <span className="mm">{connection.webhooks.lastFailure.topic}</span>
            </p>
          )}
        </div>
      </div>

      {confirming && (
        <div className="confirm" role="alertdialog" aria-labelledby={`disconnect-${connection.id}`}>
          <p id={`disconnect-${connection.id}`} style={{ margin: 0 }}>
            <strong>{t('فصل هذا المتجر؟', 'Disconnect this store?')}</strong>{' '}
            {t('نتوقف عن المزامنة ونحذف مفاتيح الوصول. منتجاتك ونماذجها تبقى كما هي.', 'We stop syncing and delete the access keys. Your products and their models stay as they are.')}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => act('disconnect')} disabled={busy !== null}>
              {busy === 'disconnect' ? t('جارٍ الفصل…', 'Disconnecting…') : t('نعم، افصل', 'Yes, disconnect')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={busy !== null}>{t('إلغاء', 'Cancel')}</button>
          </div>
        </div>
      )}
      {failure && <ErrorNote error={failure} />}
    </Panel>
  );
}

function SyncLine({ sync }: { sync: SyncProgress }) {
  const { t, lang } = useLang();
  const n = (value: number) => formatNumber(value, lang);
  if (sync.status === 'queued') return <p className="sync-line">{t('المزامنة في الطابور…', 'Sync queued…')}</p>;
  if (sync.status === 'running') {
    return (
      <div className="sync-line sync-progress" role="status">
        <span>
          {t('تجري المزامنة', 'Syncing')}{sync.percent !== null ? ` · ${n(sync.percent)}%` : ''}
          {sync.total > 0 && <> · <span className="num">{n(sync.processed)}</span> {t('من', 'of')} <span className="num">{n(sync.total)}</span></>}
        </span>
        <div className="meter"><i style={{ width: `${sync.percent ?? 0}%` }} /></div>
      </div>
    );
  }
  if (sync.status === 'failed') {
    return <p className="sync-line" style={{ color: 'var(--bad)' }}>{t('فشلت آخر مزامنة', 'The last sync failed')}{sync.error ? `: ${sync.error}` : ''}</p>;
  }
  if (sync.status === 'done') {
    return (
      <p className="sync-line">
        {t('فُحص في آخر مزامنة', 'Checked in the last sync')}: <span className="num">{n(sync.processed)}</span>
        {sync.failed > 0 && <> · {t('لم يُستورد', 'Not imported')}: <span className="num" style={{ color: 'var(--bad)' }}>{n(sync.failed)}</span></>}
        {sync.error ? <> · {sync.error}</> : null}
      </p>
    );
  }
  return null;
}
