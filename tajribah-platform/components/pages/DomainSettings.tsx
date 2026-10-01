'use client';

// MD-172 — Your own address (T62, Enterprise): the AR and try-on pages on the store's own domain

import { useState, type FormEvent } from 'react';
import { Copy, Globe, RefreshCw } from 'lucide-react';
import { currentStore } from '@/lib/api-client';
import { AppLink } from '@/lib/app-env';
import { useAuth } from '@/lib/auth';
import { useData, useResource } from '@/lib/data';
import { formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { planByCode } from '@/lib/plans';
import type { Bi } from '@/lib/lang';
import type { CustomDomainView } from '@/lib/view-models';
import { useWriteLock } from '@/components/dashboard/write-lock';
import { Badge, ErrorNote, Loading, Panel, type BadgeTone } from '@/components/dashboard/ui';

const STANDING: Record<CustomDomainView['status'], { tone: BadgeTone; label: Bi; next: Bi }> = {
  pending: { tone: 'neutral', label: { ar: 'بانتظار السجلات', en: 'Waiting for the records' },
    next: { ar: 'أضف السجلّين عند مزوّد نطاقك. نتحقّق منهما تلقائيًا كل ربع ساعة، أو اضغط «تحقّق الآن». قد يستغرق ظهورهما دقائق.', en: 'Add the two records at your domain provider. We look for them every quarter of an hour by ourselves, or press “Check now”. They can take a few minutes to appear.' } },
  verified: { tone: 'accent', label: { ar: 'العنوان لك — بقي سجل CNAME', en: 'The address is yours — the CNAME is left' },
    next: { ar: 'ثبت أن العنوان لمتجرك. بقي أن يشير سجل CNAME إلى تجربة.', en: 'The address is proven to be your store’s. The CNAME record still has to point to Tajribah.' } },
  ready: { tone: 'ok', label: { ar: 'جاهز — بانتظار التفعيل', en: 'Ready — waiting to be switched on' },
    next: { ar: 'السجلان في مكانهما. يعمل العنوان حين تفعّله تجربة على خوادمها — لا شيء آخر مطلوب منك.', en: 'Both records are in place. The address works once Tajribah switches it on on its servers — nothing more is needed from you.' } },
  active: { tone: 'ok', label: { ar: 'يعمل', en: 'Live' },
    next: { ar: 'صفحات العرض والتجربة تُفتح على عنوانك.', en: 'Your AR and try-on pages open on your address.' } },
};

/**
 * An Enterprise store's AR and try-on pages on its own address (like `ar.yourstore.com`): the name,
 * the two DNS records to add, and a check that they are in place. Owners and admins change it.
 */
export function DomainPanel() {
  const { t } = useLang();
  const { me } = useAuth();
  const store = currentStore(me);
  const included = store ? planByCode(store.plan).features.includes('custom_domain') : false;
  const { data, loading, error } = useResource((source) => source.customDomain(), []);
  const [changed, setChanged] = useState<{ view: CustomDomainView | null } | null>(null);
  const view = changed ? changed.view : data;

  return (
    <Panel title={t('عنوانك الخاص', 'Your own address')}
      sub={t('تُفتح صفحات العرض ثلاثي الأبعاد والتجربة على عنوان من نطاق متجرك، مثل ar.yourstore.com.', 'Your 3D and try-on pages open on an address of your own store’s domain, like ar.yourstore.com.')}>
      {!included ? (
        <p className="hint" style={{ margin: 0 }}>
          {t('ضمن باقة المؤسسات.', 'Included in the Enterprise plan.')} <AppLink href="/dashboard/billing" style={{ color: 'var(--aqua-ink)' }}>{t('الباقات', 'Plans')}</AppLink>
        </p>
      ) : error ? <ErrorNote error={error} /> : loading && !changed ? <Loading rows={2} /> : (
        <DomainForm key={view?.hostname ?? 'none'} view={view ?? null} canEdit={store?.role === 'owner' || store?.role === 'admin'} onChanged={(v) => setChanged({ view: v })} />
      )}
    </Panel>
  );
}

function DomainForm({ view, canEdit, onChanged }: { view: CustomDomainView | null; canEdit: boolean; onChanged: (v: CustomDomainView | null) => void }) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const [hostname, setHostname] = useState(view?.hostname ?? '');
  const [busy, setBusy] = useState<'save' | 'check' | 'remove' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const disabled = !canEdit || lock.locked || busy !== null;

  const act = async (kind: 'save' | 'check' | 'remove', run: () => Promise<CustomDomainView | null>) => {
    setBusy(kind); setProblem(null);
    try { onChanged(await run()); } catch (err) {
      const e = err as Error & { code?: string; fields?: Record<string, string[]> };
      setProblem(e.code === 'conflict' ? t('هذا العنوان مستخدم لمتجر آخر في تجربة.', 'This address is already used by another Tajribah store.')
        : e.fields?.hostname ? t('عنوان فرعي من نطاق متجرك، مثل ar.yourstore.com.', 'A subdomain of your store’s domain, like ar.yourstore.com.')
          : e.code?.startsWith('upstream_') ? t('تعذّر الاطلاع على سجلات النطاق الآن — حاول بعد قليل.', 'The domain’s records could not be looked up just now — try again shortly.')
            : e.message);
    } finally { setBusy(null); }
  };
  const save = (e: FormEvent) => { e.preventDefault(); void act('save', () => source.setCustomDomain(hostname.trim())); };
  const copy = (value: string) => { void navigator.clipboard?.writeText(value).then(() => { setCopied(value); setTimeout(() => setCopied(null), 1500); }); };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <form onSubmit={save} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="field" style={{ margin: 0, flex: '1 1 260px' }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t('العنوان', 'Address')}</span>
          <input dir="ltr" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="ar.yourstore.com" maxLength={253} disabled={!canEdit} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={disabled || !hostname.trim() || hostname.trim().toLowerCase() === view?.hostname} title={lock.title}>
          <Globe size={16} aria-hidden />{busy === 'save' ? t('جارٍ الحفظ…', 'Saving…') : view ? t('غيّر العنوان', 'Change the address') : t('استخدم هذا العنوان', 'Use this address')}
        </button>
      </form>
      {!canEdit && <p className="hint" style={{ margin: 0 }}>{t('يغيّره المالك أو المدير.', 'The owner or an admin changes it.')}</p>}
      {problem && <p className="field-error" role="alert" style={{ margin: 0 }}>{problem}</p>}

      {view && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={STANDING[view.status].tone} dot>{pick(STANDING[view.status].label)}</Badge>
            {view.checkedAt && <span className="hint" style={{ margin: 0 }}>{t('آخر تحقّق', 'Last checked')} {formatDateTime(view.checkedAt, lang)}</span>}
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>{pick(STANDING[view.status].next)}</p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th scope="col">{t('النوع', 'Type')}</th><th scope="col">{t('الاسم', 'Name')}</th><th scope="col">{t('القيمة', 'Value')}</th><th scope="col">{t('الحالة', 'Status')}</th></tr>
              </thead>
              <tbody>
                {view.records.map((r) => (
                  <tr key={r.type}>
                    <td><code>{r.type}</code></td>
                    <td dir="ltr"><code>{r.name}</code></td>
                    <td dir="ltr">
                      <code style={{ wordBreak: 'break-all' }}>{r.value}</code>{' '}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(r.value)} aria-label={t(`انسخ قيمة ${r.type}`, `Copy the ${r.type} value`)}>
                        <Copy size={14} aria-hidden />{copied === r.value ? t('نُسخ', 'Copied') : null}
                      </button>
                    </td>
                    <td>{r.seen ? <Badge tone="ok">{t('موجود', 'Found')}</Badge> : <Badge tone="neutral">{t('لم يظهر بعد', 'Not seen yet')}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.pointsTo && <p className="hint" style={{ margin: 0 }} dir="auto">{t(`سجل CNAME يشير الآن إلى ${view.pointsTo}.`, `The CNAME record points to ${view.pointsTo} now.`)}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => void act('check', () => source.checkCustomDomain())}>
              <RefreshCw size={16} aria-hidden />{busy === 'check' ? t('جارٍ التحقّق…', 'Checking…') : t('تحقّق الآن', 'Check now')}
            </button>
            <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => void act('remove', async () => { await source.removeCustomDomain(); setHostname(''); return null; })}>
              {busy === 'remove' ? t('جارٍ الإزالة…', 'Removing…') : t('توقّف عن استخدامه', 'Stop using it')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
