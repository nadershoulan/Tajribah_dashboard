'use client';

// MD-090 — AR settings per product

import { useState } from 'react';
import { Box, Rotate3D, Sparkles } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { ApiError } from '@/lib/api-client';
import { ArConfigInput, placementErrors, placementsFor, type ArConfigView, type Placement } from '@/lib/contracts/ar-config';
import { useData, useResource } from '@/lib/data';
import { formatNumber } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import type { Bi } from '@/lib/lang';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';

const PLACEMENT_LABEL: Record<Placement, Bi> = {
  floor: { ar: 'على الأرض', en: 'On the floor' },
  wall: { ar: 'على الجدار', en: 'On a wall' },
  table: { ar: 'على طاولة', en: 'On a table' },
  face: { ar: 'على الوجه', en: 'On the face' },
  wrist: { ar: 'على المعصم', en: 'On the wrist' },
};

/** Contract and server messages are English; the ones this screen meets get their Arabic here. */
const MESSAGE_AR: [RegExp, string][] = [
  [/needs a label/, 'الزر يحتاج نصًا'],
  [/at most 40/, '40 حرفًا على الأكثر'],
  [/between 0\.5/, 'بين 0.5 و 2'],
  [/between 0 and 2/, 'بين 0 و 2'],
  [/not for this kind of product/, 'لا يناسب هذا النوع من المنتجات'],
  [/missing permission: ar:write/, 'دورك لا يسمح بتغيير إعدادات العرض'],
];

export default function ArSettings() {
  const { t, lang } = useLang();
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useResource((s) => s.arConfigs(), [version]);
  const { data: settings } = useResource((s) => s.settings());
  const [selected, setSelected] = useState<string | null>(null);
  const current = data?.find((c) => c.productId === selected) ?? data?.[0] ?? null;

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('إعدادات العرض', 'AR settings') },
  ];
  const name = (c: ArConfigView) => (lang === 'ar' ? c.productNameAr ?? c.productName : c.productName);

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('إعدادات العرض', 'AR settings')}
        lead={t(
          'نص الزر ومكان وضع المنتج وحركته، لكل منتج. اللون والاستدارة من إعدادات المتجر.',
          'The button text, where the product is placed and how it moves, per product. Colour and corners come from your store settings.',
        )}
      />
      {loading && !data && <Panel><Loading rows={4} /></Panel>}
      {error && <ErrorNote error={error} />}
      {data && data.length === 0 && (
        <Empty icon={<Box size={22} />} title={t('لا توجد منتجات بعد', 'No products yet')}
          body={t('اربط متجرك أو أضف منتجًا، ثم اضبط عرضه هنا.', 'Connect your store or add a product, then set up its AR here.')}
          action={<AppLink href="/dashboard/products" className="btn btn-ghost">{t('المنتجات', 'Products')}</AppLink>} />
      )}
      {data && current && (
        <div className="ar-grid">
          <Panel flush title={t('المنتجات', 'Products')} sub={t(`${formatNumber(data.filter((c) => c.saved).length, lang)} مضبوط من ${formatNumber(data.length, lang)}`, `${formatNumber(data.filter((c) => c.saved).length, lang)} of ${formatNumber(data.length, lang)} set up`)}>
            <ul className="pick-list">
              {data.map((c) => (
                <li key={c.productId}>
                  <button type="button" aria-current={c.productId === current.productId ? 'true' : undefined} onClick={() => setSelected(c.productId)}>
                    <span className="pick-name">{name(c)}</span>
                    <span className="pick-meta">
                      {c.arEnabled ? <Badge tone="ok" dot>{t('العرض مفعّل', 'AR on')}</Badge> : <Badge>{t('العرض متوقف', 'AR off')}</Badge>}
                      {c.saved ? <Badge tone="accent">{t('مضبوط', 'Customised')}</Badge> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <Editor key={`${current.productId}:${JSON.stringify(current)}`} config={current} name={name(current)}
            brandColor={settings?.brandColor ?? null} radius={settings?.buttonRadius ?? 12}
            onSaved={() => setVersion((v) => v + 1)} />
        </div>
      )}
    </Shell>
  );
}

function Editor({ config, name, brandColor, radius, onSaved }: {
  config: ArConfigView; name: string; brandColor: string | null; radius: number; onSaved: () => void;
}) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [form, setForm] = useState<ArConfigInput>({
    buttonLabelAr: config.buttonLabelAr, buttonLabelEn: config.buttonLabelEn, variant: config.variant, showIcon: config.showIcon,
    placement: config.placement, scale: config.scale, autoRotate: config.autoRotate, shadow: config.shadow,
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const set = <K extends keyof ArConfigInput>(key: K) => (value: ArConfigInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const say = (m: string) => (lang === 'ar' ? MESSAGE_AR.find(([p]) => p.test(m))?.[1] ?? m : m);
  const err = (key: string) => errors[key]?.[0];

  const save = async () => {
    setFailure(null);
    const parsed = ArConfigInput.safeParse(form);
    const local: Record<string, string[]> = parsed.success ? placementErrors(config.productType, form.placement) : {};
    if (!parsed.success) for (const i of parsed.error.issues) (local[String(i.path[0])] ??= []).push(i.message);
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      await source.saveArConfig(config.productId, parsed.data!);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else setFailure(e as Error);
    } finally {
      setSaving(false);
    }
  };

  const color = brandColor ?? 'var(--aqua)';
  const label = lang === 'ar' ? form.buttonLabelAr : form.buttonLabelEn;
  return (
    <Panel title={name} sub={t('يُطبَّق على صفحة هذا المنتج فقط', 'Applies to this product’s page only')}
      actions={config.saved && config.unpublishedChanges ? <Badge tone="warn">{t('تغييرات غير منشورة', 'Unpublished changes')}</Badge> : undefined}>
      <div className="button-preview" aria-hidden style={{ marginBottom: 16 }}>
        <span style={form.variant === 'solid'
          ? { background: color, borderRadius: radius }
          : { background: 'transparent', color, border: `2px solid ${color}`, borderRadius: radius }}>
          {form.showIcon && <Sparkles size={15} />}{label || '…'}
        </span>
      </div>

      <div className="brand-row">
        {(['buttonLabelAr', 'buttonLabelEn'] as const).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`ar-${key}`}>{key === 'buttonLabelAr' ? t('نص الزر بالعربية', 'Button text (Arabic)') : t('نص الزر بالإنجليزية', 'Button text (English)')}</label>
            <input id={`ar-${key}`} dir={key === 'buttonLabelEn' ? 'ltr' : 'rtl'} value={form[key]} onChange={(e) => set(key)(e.target.value)}
              aria-invalid={!!err(key)} maxLength={60} />
            {err(key) && <span className="field-error">{say(err(key)!)}</span>}
          </div>
        ))}
      </div>

      <div className="brand-row">
        <div className="field">
          <label htmlFor="ar-variant">{t('شكل الزر', 'Button style')}</label>
          <select id="ar-variant" value={form.variant} onChange={(e) => set('variant')(e.target.value as 'solid' | 'outline')}>
            <option value="solid">{t('ممتلئ', 'Filled')}</option>
            <option value="outline">{t('إطار فقط', 'Outline')}</option>
          </select>
        </div>
        <div className="field">
          <label className="toggle" style={{ marginTop: 26 }}>
            <input type="checkbox" checked={form.showIcon} onChange={(e) => set('showIcon')(e.target.checked)} />
            <span>{t('أيقونة في الزر', 'Icon on the button')}</span>
          </label>
        </div>
      </div>

      <fieldset className="field placement">
        <legend>{t('أين يوضع المنتج', 'Where the product goes')}</legend>
        <div className="placement-options">
          {placementsFor(config.productType).map((p) => (
            <label key={p} className={form.placement === p ? 'is-on' : undefined}>
              <input type="radio" name="placement" value={p} checked={form.placement === p} onChange={() => set('placement')(p)} />
              {pick(PLACEMENT_LABEL[p])}
            </label>
          ))}
        </div>
        {err('placement') && <span className="field-error">{say(err('placement')!)}</span>}
      </fieldset>

      <div className="brand-row">
        <div className="field">
          <label htmlFor="ar-scale">{t('تصحيح الحجم', 'Size correction')} <span className="num">{form.scale.toFixed(2)}×</span></label>
          <input id="ar-scale" type="range" min={0.5} max={2} step={0.05} value={form.scale} onChange={(e) => set('scale')(Number(e.target.value))} />
          <span className="field-hint">{t('1× هو المقاس الحقيقي من المليمترات. غيّره فقط إن كان النموذج نفسه بمقياس خاطئ.', '1× is the true size from the millimetres. Change it only if the model itself is at the wrong scale.')}</span>
        </div>
        <div className="field">
          <label htmlFor="ar-shadow">{t('قوة الظل', 'Shadow strength')} <span className="num">{form.shadow.toFixed(1)}</span></label>
          <input id="ar-shadow" type="range" min={0} max={2} step={0.1} value={form.shadow} onChange={(e) => set('shadow')(Number(e.target.value))} />
        </div>
      </div>
      <label className="toggle" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={form.autoRotate} onChange={(e) => set('autoRotate')(e.target.checked)} />
        <span><Rotate3D size={14} aria-hidden /> {t('يدور المنتج تلقائيًا في المعاينة', 'The product turns slowly in the preview')}</span>
      </label>

      {failure && <ErrorNote error={failure} />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ', 'Save')}</button>
        <button type="button" className="btn btn-ghost" disabled title={t('يتطلب حساب Cloudflare', 'Needs the Cloudflare account')}>{t('انشر في المتجر', 'Publish to the store')}</button>
      </div>
      <p className="hint">{t(
        'الحفظ يحفظ الإعدادات هنا. النشر إلى صفحات متجرك يعمل عند تفعيل خدمة العرض السريع (تنتظر حساب Cloudflare).',
        'Saving keeps the settings here. Publishing them to your store pages works once the fast viewer service is switched on (it waits on the Cloudflare account).',
      )}</p>
    </Panel>
  );
}
