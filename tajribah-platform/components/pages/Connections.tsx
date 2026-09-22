'use client';

// MD-030 — Store connections

import { AlertTriangle, CheckCircle2, Link2, RefreshCw, ShoppingBag } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import type { Bi } from '@/lib/lang';

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
  const { t, pick, lang } = useLang();
  const { data, loading, error } = useResource((source) => source.dashboard());
  const connection = data?.connection ?? null;

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('ربط المتجر', 'Store connections') },
  ];

  return (
    <Shell tenant={data?.tenant ?? null} crumbs={crumbs}>
      <PageHead
        title={t('ربط المتجر', 'Store connections')}
        lead={t(
          'اربط متجرك مرة واحدة، ونستورد منتجاتك ومقاساتها وصورها، ونبقيها محدّثة كلما غيّرت شيئًا.',
          'Connect your store once. We import your products, their sizes and their images, and keep them current as you change them.',
        )}
      />

      {loading && <Panel><Loading rows={4} /></Panel>}
      {error && <ErrorNote error={error} />}

      {!loading && connection && (
        <Panel
          title={t('المتجر المتصل', 'Connected store')}
          actions={
            <>
              <button type="button" className="btn btn-ghost btn-sm">
                <RefreshCw size={14} aria-hidden />{t('مزامنة الآن', 'Sync now')}
              </button>
              <button type="button" className="btn btn-quiet btn-sm">{t('فصل', 'Disconnect')}</button>
            </>
          }
        >
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span className="empty-icon" style={{ margin: 0, width: 44, height: 44 }}>
              <ShoppingBag size={20} aria-hidden />
            </span>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
                <strong style={{ fontSize: 16 }}>{connection.storeName}</strong>
                <Badge tone={connection.status === 'active' ? 'ok' : 'bad'} dot>
                  {connection.status === 'active' ? t('نشط', 'Active') : t('يحتاج انتباهك', 'Needs attention')}
                </Badge>
              </div>
              <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13.5 }}>
                {connection.storeUrl} · {formatNumber(connection.productCount, lang)} {t('منتج', 'products')}
              </p>
              {connection.lastSyncAt && (
                <p style={{ margin: '4px 0 0', color: 'var(--text-3)', fontSize: 13 }}>
                  {t('آخر مزامنة', 'Last sync')} {formatRelative(connection.lastSyncAt, lang)}
                  {' · '}<span className="mm">{formatDateTime(connection.lastSyncAt, lang)}</span>
                </p>
              )}
              {connection.lastError && (
                <p style={{ margin: '8px 0 0', color: 'var(--bad)', fontSize: 13 }}>
                  <AlertTriangle size={13} aria-hidden /> {connection.lastError}
                </p>
              )}
            </div>
            <div style={{ minWidth: 150 }}>
              <div className="usage-row">
                <div className="usage-top">
                  <span>{t('صحة الاتصال', 'Connection health')}</span>
                  <span className="num">{connection.healthScore}%</span>
                </div>
                <div className="meter"><i style={{ width: `${connection.healthScore}%` }} /></div>
              </div>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        {PROVIDERS.map((provider) => {
          const connected = connection?.provider === provider.id;
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
