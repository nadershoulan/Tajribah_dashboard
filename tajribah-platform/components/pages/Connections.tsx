'use client';

// MD-030 — Store connections

import { useWriteLock } from '@/components/dashboard/write-lock';
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, ShoppingBag } from 'lucide-react';
import { currentStore } from '@/lib/api-client';
import { AppLink } from '@/lib/app-env';
import { useAuth } from '@/lib/auth';
import { planByCode } from '@/lib/plans';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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
    blurb: { ar: 'استيراد المنتجات وصورها وأسعارها، وتحديث تلقائي عند كل تغيير.', en: 'Your products, their images and prices, kept up to date automatically on every change.' },
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
    blurb: { ar: 'تثبّت تطبيق تجربة في متجرك من شاشة Shopify نفسها، بإذن قراءة المنتجات فقط. نزامن كل ساعة.', en: 'You install the Tajribah app on your shop from Shopify’s own screen, with permission to read products only. Synced every hour.' },
    tier: 'secondary',
    // P6: shown until the Tajribah Shopify app is registered — then the server says it is available.
    blockedBy: { ar: 'بانتظار تسجيل تطبيق تجربة في Shopify', en: 'Waiting on the Tajribah Shopify app' },
  },
  {
    id: 'woocommerce',
    name: { ar: 'WooCommerce', en: 'WooCommerce' },
    blurb: { ar: 'توافق على قراءة منتجاتك من لوحة ووردبريس نفسها — لا إضافة ولا مفاتيح تنسخها. نزامن كل ساعة.', en: 'You approve read access on your own WordPress site — no plugin, no keys to copy. Synced every hour.' },
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
  const { data: available } = useResource((source) => source.connectionProviders(), []);
  const shopifyBack = useShopifyReturn(() => setVersion((v) => v + 1));
  const sallaBack = useSallaReturn(() => setVersion((v) => v + 1));
  const zidBack = useZidReturn(() => setVersion((v) => v + 1));
  // Back from WooCommerce's approval page: it adds success=1 (approved) or 0.
  const [returned] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      return q.get('woocommerce') === 'returned' ? q.get('success') === '1' : null;
    } catch { return null; }
  });

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('ربط المتجر', 'Store connections')}
        lead={t(
          'اربط متجرك مرة واحدة، ونستورد منتجاتك ومقاساتها وصورها، ونبقيها محدّثة كلما غيّرت شيئًا.',
          'Connect your store once. We import your products, their sizes and their images, and keep them current as you change them.',
        )}
      />

      {returned !== null && (
        <p role="status" className={`upload-note ${returned ? 'upload-done' : 'upload-failed'}`}>
          {returned
            ? t('وافق متجرك على الربط. أول مزامنة تجري الآن، وتظهر منتجاتك هنا تباعًا.', 'Your store approved the connection. The first sync is running; your products appear here as it goes.')
            : t('لم يُوافَق على الربط في WooCommerce. يمكنك المحاولة مجددًا.', 'The connection was not approved in WooCommerce. You can try again.')}
        </p>
      )}
      {shopifyBack && (
        <p role="status" className={`upload-note ${shopifyBack.ok ? 'upload-done' : shopifyBack.ok === false ? 'upload-failed' : ''}`}>
          {shopifyBack.ok === null
            ? t('نكمل الربط مع Shopify…', 'Finishing the connection with Shopify…')
            : shopifyBack.ok
              ? t('ثُبّت التطبيق في متجرك على Shopify. أول مزامنة تجري الآن، وتظهر منتجاتك هنا تباعًا.', 'The app is installed on your Shopify shop. The first sync is running; your products appear here as it goes.')
              : t(`لم يكتمل الربط مع Shopify: ${shopifyBack.problem}`, `The Shopify connection did not complete: ${shopifyBack.problem}`)}
        </p>
      )}
      {sallaBack && (
        <p role="status" className={`upload-note ${sallaBack.ok ? 'upload-done' : sallaBack.ok === false ? 'upload-failed' : ''}`}>
          {sallaBack.ok === null
            ? t('نربط متجرك على سلة…', 'Linking your Salla store…')
            : sallaBack.ok
              ? t('رُبط متجرك على سلة. أول مزامنة تجري الآن، وتظهر منتجاتك هنا تباعًا.', 'Your Salla store is linked. The first sync is running; your products appear here as it goes.')
              : t(`لم يكتمل ربط متجرك على سلة: ${sallaBack.problem}`, `Your Salla store was not linked: ${sallaBack.problem}`)}
        </p>
      )}
      {zidBack && (
        <p role="status" className={`upload-note ${zidBack.ok ? 'upload-done' : zidBack.ok === false ? 'upload-failed' : ''}`}>
          {zidBack.ok === null
            ? t('نربط متجرك على زد…', 'Linking your Zid store…')
            : zidBack.ok
              ? (zidBack.renewed
                ? t('متجرك على زد مربوط بالفعل، وجدّدنا صلاحيته.', 'Your Zid store was already linked; its access is renewed.')
                : t('رُبط متجرك على زد. أول مزامنة تجري الآن، وتظهر منتجاتك هنا تباعًا.', 'Your Zid store is linked. The first sync is running; your products appear here as it goes.'))
              : t(`لم يكتمل ربط متجرك على زد: ${zidBack.problem}`, `Your Zid store was not linked: ${zidBack.problem}`)}
        </p>
      )}
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
              ) : provider.id === 'woocommerce' ? (
                <WooConnect />
              ) : provider.id === 'shopify' && available?.shopify ? (
                <ShopifyConnect />
              ) : provider.id === 'salla' && available?.salla ? (
                <SallaConnect />
              ) : provider.id === 'zid' && available?.zid ? (
                <ZidConnect />
              ) : provider.blockedBy ? (
                <>
                  <button type="button" className="btn btn-ghost" disabled>
                    <Link2 size={16} aria-hidden />{t('اربط', 'Connect')}
                  </button>
                  <p className="hint" style={{ marginTop: 8 }}>{pick(provider.blockedBy)}</p>
                </>
              ) : null}
            </section>
          );
        })}
      </div>

      <Panel title={t('ماذا نقرأ من متجرك', 'What we read from your store')} >
        <ul style={{ margin: 0, paddingInlineStart: 18, color: 'var(--text-2)', fontSize: 14, lineHeight: 2 }}>
          <li>{t('اسم المنتج ووصفه وسعره وصوره وحالته.', 'Product name, description, price, images and status.')}</li>
          <li>{t('المقاسات إن كانت موجودة — وإلا نطلبها منك، فهي أساس الحجم الحقيقي.', 'Dimensions where they exist — otherwise we ask you for them, since true size depends on them.')}</li>
          <li>{t('تحديثات عند كل تغيير في متجرك: فورًا حيث تُرسل منصتك إشعارًا بالتغيير (سلة وزد)، وإلا بمزامنة كل ساعة.', 'Updates whenever your store changes: at once where your platform sends change notices (Salla, Zid), otherwise by a sync every hour.')}</li>
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
  const lock = useWriteLock(); // T50: a read-only store or a staff view changes nothing
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => act('sync')} disabled={running || busy !== null || lock.locked} title={lock.title}>
            <RefreshCw size={14} aria-hidden />{running ? t('تجري المزامنة…', 'Syncing…') : t('مزامنة الآن', 'Sync now')}
          </button>
          {!confirming && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(true)} disabled={busy !== null || lock.locked} title={lock.title}>{t('فصل', 'Disconnect')}</button>
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

/**
 * P6 — connect a WooCommerce store: its address, then WooCommerce's own approval page on that site
 * (read access only). WooCommerce sends the keys to our server and the merchant back here. Pro and up.
 */
function WooConnect() {
  const { t } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const { me } = useAuth();
  const store = currentStore(me);
  const included = store ? planByCode(store.plan).features.includes('woocommerce') : false;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!included) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        {t('ضمن باقة Pro وما فوقها.', 'Included from the Pro plan.')} <AppLink href="/dashboard/billing" style={{ color: 'var(--aqua-ink)' }}>{t('الباقات', 'Plans')}</AppLink>
      </p>
    );
  }
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setProblem(null);
    try {
      const { authorizeUrl } = await source.startWooConnect(url.trim());
      window.location.assign(authorizeUrl);
    } catch (err) {
      const fields = (err as { fields?: Record<string, string[]> }).fields;
      setProblem(fields?.storeUrl ? t('عنوان متجرك يبدأ بـ https:// — مثل https://متجرك.com', 'Your store address starts with https:// — like https://yourstore.com') : (err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={go} style={{ display: 'grid', gap: 8 }}>
      <label className="field" style={{ margin: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t('عنوان متجرك', 'Your store address')}</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" inputMode="url" placeholder="https://yourstore.com" maxLength={2048} />
      </label>
      <button type="submit" className="btn btn-ghost" disabled={busy || lock.locked || !url.trim()} title={lock.title}>
        <Link2 size={16} aria-hidden />{busy ? t('جارٍ التحويل…', 'Opening…') : t('اربط عبر WooCommerce', 'Connect with WooCommerce')}
      </button>
      <p className="hint" style={{ margin: 0 }}>{t('ننقلك إلى متجرك لتوافق على قراءة المنتجات فقط، ثم نعيدك إلى هنا.', 'We take you to your store to approve reading products only, then bring you back here.')}</p>
      {problem && <p className="field-error" role="alert" style={{ margin: 0 }}>{problem}</p>}
    </form>
  );
}

/**
 * P6 — back from Shopify's install screen with `code`, `shop`, `state` and Shopify's `hmac`: hand the
 * query to the server with this session (it checks all of it), once, then take it out of the address.
 */
function useShopifyReturn(onDone: () => void): { ok: boolean | null; problem: string } | null {
  const source = useData();
  const started = useRef(false);
  const [outcome, setOutcome] = useState<{ ok: boolean | null; problem: string } | null>(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      return q.get('hmac') && q.get('shop') && q.get('state') && q.get('code') ? { ok: null, problem: '' } : null;
    } catch { return null; }
  });
  useEffect(() => {
    if (!outcome || outcome.ok !== null || started.current) return;
    started.current = true;
    const query = window.location.search;
    window.history.replaceState(null, '', window.location.pathname); // the code is single-use; never leave it in the address
    source.completeShopifyConnect(query).then(
      () => { setOutcome({ ok: true, problem: '' }); onDone(); },
      (err: Error) => setOutcome({ ok: false, problem: err.message }),
    );
  }, [outcome, source, onDone]);
  return outcome;
}

/**
 * T61 — opened from the Tajribah app inside Salla with `?salla=<ticket>`: link that store to this
 * account with this session, once, then take the ticket out of the address.
 */
function useSallaReturn(onDone: () => void): { ok: boolean | null; problem: string } | null {
  const { t } = useLang();
  const source = useData();
  const started = useRef(false);
  const [ticket] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('salla'); } catch { return null; }
  });
  const [outcome, setOutcome] = useState<{ ok: boolean | null; problem: string } | null>(ticket ? { ok: null, problem: '' } : null);
  useEffect(() => {
    if (!ticket || started.current) return;
    started.current = true;
    window.history.replaceState(null, '', window.location.pathname); // the ticket links once; never leave it in the address
    source.linkSalla(ticket).then(
      () => { setOutcome({ ok: true, problem: '' }); onDone(); },
      (err: Error & { code?: string }) => setOutcome({ ok: false, problem: err.code === 'forbidden'
        ? t('انتهت صلاحية الرابط أو لم يأتِ من لوحة سلة — افتح تجربة من متجرك في سلة مجددًا.', 'The link has expired or did not come from your Salla dashboard — open Tajribah from your Salla store again.')
        : err.code === 'plan_required' ? t('ربط سلة ضمن باقة Growth وما فوقها.', 'Linking Salla is included from the Growth plan.') : err.message }),
    );
  }, [ticket, source, onDone, t]);
  return outcome;
}

type ZidBack = { ok: boolean | null; renewed: boolean; problem: string };

/** Why a Zid connection did not complete, in the merchant's language. */
function zidProblem(code: string | null | undefined, t: (ar: string, en: string) => string): string {
  if (code === 'denied') return t('لم تتم الموافقة في زد.', 'It was not approved on Zid.');
  if (code === 'state' || code === 'forbidden') return t('انتهت صلاحية الطلب أو بدأ في متصفح آخر — ابدأ من جديد.', 'The request expired or began in another browser — start again.');
  if (code === 'plan_required') return t('ربط زد ضمن باقة Growth وما فوقها.', 'Linking Zid is included from the Growth plan.');
  if (code === 'setup') return t('تطبيق تجربة في زد غير مُعدّ بعد — تواصل معنا.', 'The Tajribah Zid app is not set up yet — please contact us.');
  return t('زد لا تجيب الآن — حاول بعد قليل.', 'Zid is not answering right now — try again shortly.');
}

/**
 * T61 — back from Zid: `?zid=<ticket>` links that store to this account with this session (once, then
 * out of the address); `?zid=renewed` — the store was linked already; `?zid_error=…` — why not.
 */
function useZidReturn(onDone: () => void): ZidBack | null {
  const { t } = useLang();
  const source = useData();
  const started = useRef(false);
  const [back] = useState(() => {
    try { const q = new URLSearchParams(window.location.search); return { zid: q.get('zid'), error: q.get('zid_error') }; } catch { return { zid: null, error: null }; }
  });
  const [outcome, setOutcome] = useState<ZidBack | null>(() =>
    back.error ? { ok: false, renewed: false, problem: zidProblem(back.error, t) }
      : back.zid === 'renewed' ? { ok: true, renewed: true, problem: '' }
        : back.zid ? { ok: null, renewed: false, problem: '' } : null);
  useEffect(() => {
    if ((!back.zid && !back.error) || started.current) return;
    started.current = true;
    window.history.replaceState(null, '', window.location.pathname); // the ticket links once; never leave it in the address
    if (!back.zid || back.zid === 'renewed') return;
    source.linkZid(back.zid).then(
      () => { setOutcome({ ok: true, renewed: false, problem: '' }); onDone(); },
      (err: Error & { code?: string }) => setOutcome({ ok: false, renewed: false, problem: err.code === 'forbidden' || err.code === 'plan_required' ? zidProblem(err.code, t) : err.message }),
    );
  }, [back, source, onDone, t]);
  return outcome;
}

/** T61 — connect a Zid store: Zid's own approval screen, then back here. Growth and up (T35). */
function ZidConnect() {
  const { t } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const { me } = useAuth();
  const store = currentStore(me);
  const included = store ? planByCode(store.plan).features.includes('zid') : false;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!included) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        {t('ضمن باقة Growth وما فوقها.', 'Included from the Growth plan.')} <AppLink href="/dashboard/billing" style={{ color: 'var(--aqua-ink)' }}>{t('الباقات', 'Plans')}</AppLink>
      </p>
    );
  }
  const go = async () => {
    setBusy(true); setProblem(null);
    try {
      window.location.assign((await source.startZidConnect()).authorizeUrl);
    } catch (err) {
      setProblem((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button type="button" className="btn btn-ghost" onClick={go} disabled={busy || lock.locked} title={lock.title}>
        <Link2 size={16} aria-hidden />{busy ? t('جارٍ التحويل…', 'Opening…') : t('اربط عبر زد', 'Connect with Zid')}
      </button>
      <p className="hint" style={{ margin: 0 }}>{t('ننقلك إلى زد لتوافق على قراءة منتجاتك، ثم نعيدك إلى هنا. يمكنك أيضًا تفعيل تطبيق تجربة من سوق تطبيقات زد.', 'We take you to Zid to approve reading your products, then bring you back here. You can also activate the Tajribah app from the Zid App Market.')}</p>
      {problem && <p className="field-error" role="alert" style={{ margin: 0 }}>{problem}</p>}
    </div>
  );
}

/**
 * T61 — Salla has one way in for published apps: the merchant installs Tajribah from the Salla App
 * Store, then opens it from their Salla dashboard, which brings them back here to link the store.
 * Growth and up (T35).
 */
function SallaConnect() {
  const { t } = useLang();
  const { me } = useAuth();
  const store = currentStore(me);
  const included = store ? planByCode(store.plan).features.includes('salla') : false;
  if (!included) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        {t('ضمن باقة Growth وما فوقها.', 'Included from the Growth plan.')} <AppLink href="/dashboard/billing" style={{ color: 'var(--aqua-ink)' }}>{t('الباقات', 'Plans')}</AppLink>
      </p>
    );
  }
  return (
    <ol style={{ margin: 0, paddingInlineStart: 18, fontSize: 14, lineHeight: 1.9, color: 'var(--text-2)' }}>
      <li>{t('ثبّت تطبيق «تجربة» من متجر تطبيقات سلة.', 'Install the Tajribah app from the Salla App Store.')}</li>
      <li>{t('افتحه من لوحة تحكم متجرك في سلة، واختر «اربط بحسابي في تجربة».', 'Open it from your Salla dashboard and choose “Link to my Tajribah account”.')}</li>
      <li>{t('نعيدك إلى هنا ويكتمل الربط، ثم تبدأ أول مزامنة.', 'You come back here, the link completes, and the first sync starts.')}</li>
    </ol>
  );
}

/**
 * P6 — connect a Shopify shop: its name, then Shopify's own install screen for that shop (read
 * products only). Shopify sends the merchant back here. Pro and up.
 */
function ShopifyConnect() {
  const { t } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const { me } = useAuth();
  const store = currentStore(me);
  const included = store ? planByCode(store.plan).features.includes('shopify') : false;
  const [shop, setShop] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!included) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        {t('ضمن باقة Pro وما فوقها.', 'Included from the Pro plan.')} <AppLink href="/dashboard/billing" style={{ color: 'var(--aqua-ink)' }}>{t('الباقات', 'Plans')}</AppLink>
      </p>
    );
  }
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setProblem(null);
    try {
      const { authorizeUrl } = await source.startShopifyConnect(shop.trim());
      window.location.assign(authorizeUrl);
    } catch (err) {
      const fields = (err as { fields?: Record<string, string[]> }).fields;
      setProblem(fields?.shop ? t('اسم متجرك كما في عنوانه على myshopify.com — مثل oud-house', 'Your shop’s name as in its myshopify.com address — like oud-house') : (err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={go} style={{ display: 'grid', gap: 8 }}>
      <label className="field" style={{ margin: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t('اسم متجرك على Shopify', 'Your Shopify shop')}</span>
        <span dir="ltr" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input value={shop} onChange={(e) => setShop(e.target.value)} dir="ltr" placeholder="your-shop" maxLength={300} style={{ flex: 1, minWidth: 0 }} />
          <span className="hint" style={{ margin: 0 }}>.myshopify.com</span>
        </span>
      </label>
      <button type="submit" className="btn btn-ghost" disabled={busy || lock.locked || !shop.trim()} title={lock.title}>
        <Link2 size={16} aria-hidden />{busy ? t('جارٍ التحويل…', 'Opening…') : t('اربط عبر Shopify', 'Connect with Shopify')}
      </button>
      <p className="hint" style={{ margin: 0 }}>{t('ننقلك إلى Shopify لتثبّت التطبيق بإذن قراءة المنتجات فقط، ثم نعيدك إلى هنا.', 'We take you to Shopify to install the app with permission to read products only, then bring you back here.')}</p>
      {problem && <p className="field-error" role="alert" style={{ margin: 0 }}>{problem}</p>}
    </form>
  );
}
