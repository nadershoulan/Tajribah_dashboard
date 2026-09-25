'use client';

// MD-170 — Store settings

import { useState, type FormEvent } from 'react';
import { Building2, Globe, Palette, ShieldCheck } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { SettingsPatch, type StoreSettings } from '@/lib/contracts/settings';
import { useData, useResource } from '@/lib/data';
import { useLang } from '@/lib/i18n';
import { Shell } from '@/components/dashboard/chrome';
import { ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';

/** Server and contract messages are English; the ones this screen meets get their Arabic here. */
const MESSAGE_AR: [RegExp, string][] = [
  [/CR number is 10 digits/, 'رقم السجل التجاري 10 أرقام'],
  [/VAT number is 15 digits/, 'الرقم الضريبي 15 رقمًا، يبدأ وينتهي بالرقم 3'],
  [/colour like/, 'لون بصيغة ‎#0B7A75'],
  [/needs a name/, 'اسم المتجر مطلوب'],
  [/missing permission: settings:write/, 'دورك لا يسمح بتغيير الإعدادات'],
];

type Form = Record<'name' | 'nameAr' | 'crNumber' | 'vatNumber' | 'nationalAddress' | 'city' | 'brandColor' | 'consentTextAr' | 'consentTextEn', string> & { buttonRadius: number };

const formOf = (s: StoreSettings): Form => ({
  name: s.name, nameAr: s.nameAr ?? '', crNumber: s.crNumber ?? '', vatNumber: s.vatNumber ?? '',
  nationalAddress: s.nationalAddress ?? '', city: s.city ?? '', brandColor: s.brandColor ?? '',
  buttonRadius: s.buttonRadius, consentTextAr: s.consentTextAr ?? '', consentTextEn: s.consentTextEn ?? '',
});

export default function SettingsPage() {
  const { t } = useLang();
  const [saved, setSaved] = useState<StoreSettings | null>(null);
  const { data, loading, error } = useResource((source) => source.settings());
  const settings = saved ?? data;

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('الإعدادات', 'Settings') },
  ];

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('الإعدادات', 'Settings')}
        lead={t(
          'بيانات منشأتك تظهر على الفواتير، ولغة المتجر تحدّد لغة زر العرض داخل صفحات منتجاتك.',
          'Your business details appear on invoices, and the store language sets the language of the AR button inside your product pages.',
        )}
      />
      {loading && !settings && <Panel><Loading rows={5} /></Panel>}
      {error && <ErrorNote error={error} />}
      {settings && <SettingsForm key={JSON.stringify(settings)} settings={settings} onSaved={setSaved} wasSaved={saved !== null} />}
    </Shell>
  );
}

/** Keyed by the saved values, so it starts fresh after every save without a reset effect. */
function SettingsForm({ settings, onSaved, wasSaved }: { settings: StoreSettings; onSaved: (s: StoreSettings) => void; wasSaved: boolean }) {
  const { t, lang, setLang } = useLang();
  const source = useData();
  const [form, setForm] = useState<Form>(() => formOf(settings));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [justSaved, setJustSaved] = useState(wasSaved);

  const say = (message: string) => (lang === 'ar' ? MESSAGE_AR.find(([p]) => p.test(message))?.[1] ?? message : message);
  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => { setJustSaved(false); setForm((f) => ({ ...f, [key]: value })); };
  const errorOf = (key: string) => errors[key]?.[0];

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    // Only what changed is sent; the contract checks it here first, the server again.
    const original = formOf(settings);
    const patch = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== original[k as keyof Form]));
    if (!Object.keys(patch).length) { setJustSaved(true); return; }
    const local = SettingsPatch.safeParse(patch);
    if (!local.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of local.error.issues) (fields[String(issue.path[0])] ??= []).push(issue.message);
      setErrors(fields);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      onSaved(await source.updateSettings(patch)); // re-keys this form with the saved values
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else setFailure(e as Error);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Form, label: string, options: { hint?: string; numeric?: boolean; ltr?: boolean; placeholder?: string } = {}) => {
    const message = errorOf(key);
    return (
      <div className="field">
        <label htmlFor={`s-${key}`}>{label}</label>
        <input
          id={`s-${key}`} value={String(form[key])} onChange={(e) => set(key)(e.target.value as never)}
          inputMode={options.numeric ? 'numeric' : undefined} dir={options.ltr ? 'ltr' : undefined} placeholder={options.placeholder}
          aria-invalid={!!message} aria-describedby={message ? `s-${key}-error` : options.hint ? `s-${key}-hint` : undefined}
        />
        {message
          ? <span id={`s-${key}-error`} className="field-error">{say(message)}</span>
          : options.hint && <span id={`s-${key}-hint`} className="field-hint">{options.hint}</span>}
      </div>
    );
  };

  const color = /^#[0-9a-fA-F]{6}$/.test(form.brandColor) ? form.brandColor : 'var(--aqua)';
  return (
    <form onSubmit={save} noValidate>
      <div className="grid grid-2">
        <Panel title={t('بيانات المنشأة', 'Business details')} sub={t('تُستخدم في الفواتير الضريبية', 'Used on tax invoices')}>
          {field('name', t('اسم المتجر (بالإنجليزية)', 'Store name'))}
          {field('nameAr', t('اسم المتجر بالعربية', 'Store name in Arabic'))}
          {field('crNumber', t('رقم السجل التجاري', 'Commercial registration (CR)'), { numeric: true, ltr: true, hint: t('10 أرقام، كما هو في وزارة التجارة.', '10 digits, as registered with the Ministry of Commerce.') })}
          {field('vatNumber', t('الرقم الضريبي', 'VAT number'), { numeric: true, ltr: true, hint: t('15 رقمًا يبدأ وينتهي بالرقم 3.', '15 digits, starting and ending with 3.') })}
          {field('nationalAddress', t('العنوان الوطني', 'National Address'), { hint: t('العنوان المختصر أو الكامل كما في سُبل.', 'The short or full address, as in Saudi Post (SPL).') })}
          {field('city', t('المدينة', 'City'))}
          <p className="hint" style={{ margin: 0 }}>{t('رابط المتجر', 'Store address')}: <span dir="ltr" className="mm">{settings.slug}</span> — {t('لا يتغيّر بعد التركيب', 'fixed once installed')}</p>
        </Panel>

        <div className="grid" style={{ gap: 18 }}>
          <Panel title={t('مظهر زر العرض', 'AR button style')} sub={t('كما يظهر داخل صفحات منتجاتك', 'As it appears inside your product pages')}>
            <div className="brand-row">
              <div className="field">
                <label htmlFor="s-brandColor">{t('لون العلامة', 'Brand colour')}</label>
                <div className="input-unit">
                  <input id="s-brandColor" dir="ltr" value={form.brandColor} placeholder="#0B7A75" onChange={(e) => set('brandColor')(e.target.value)}
                    aria-invalid={!!errorOf('brandColor')} />
                  <input type="color" aria-label={t('اختر لونًا', 'Pick a colour')} value={/^#[0-9a-fA-F]{6}$/.test(form.brandColor) ? form.brandColor : '#0b7a75'}
                    onChange={(e) => set('brandColor')(e.target.value)} className="color-swatch" />
                </div>
                {errorOf('brandColor') && <span className="field-error">{say(errorOf('brandColor')!)}</span>}
              </div>
              <div className="field">
                <label htmlFor="s-radius">{t('استدارة الحواف', 'Corner radius')}</label>
                <input id="s-radius" type="range" min={0} max={24} value={form.buttonRadius} onChange={(e) => set('buttonRadius')(Number(e.target.value))} />
              </div>
            </div>
            <div className="button-preview" aria-hidden>
              <span style={{ background: color, borderRadius: form.buttonRadius }}><Palette size={15} />{t('شاهدها في مكانك', 'View in your space')}</span>
            </div>
          </Panel>

          <Panel title={t('اللغة والمنطقة', 'Language and region')}>
            <div className="field">
              <label htmlFor="locale">{t('لغة لوحة التحكم', 'Dashboard language')}</label>
              <select id="locale" value={lang} onChange={(e) => setLang(e.target.value as 'ar' | 'en')}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              <Globe size={13} aria-hidden /> {t(
                'المنطقة الزمنية: آسيا/الرياض · العملة: ريال سعودي · نهاية الأسبوع: الجمعة والسبت',
                'Timezone: Asia/Riyadh · Currency: Saudi riyal · Weekend: Friday and Saturday',
              )}
            </p>
          </Panel>

          <Panel title={t('نص موافقة المتسوّق', 'Shopper consent text')}
            sub={t('يظهر قبل فتح الكاميرا للتجربة الافتراضية', 'Shown before the camera opens for virtual try-on')}>
            {field('consentTextAr', t('النص بالعربية', 'Arabic text'), { placeholder: 'صورة الكاميرا تبقى على جهازك ولا تُرسل إلى أي خادم.' })}
            {field('consentTextEn', t('النص بالإنجليزية', 'English text'), { ltr: true, placeholder: 'Your camera image stays on your device and is never sent to a server.' })}
            <p className="hint" style={{ marginTop: 0 }}>
              <ShieldCheck size={13} aria-hidden /> {t(
                'اتركه فارغًا لاستخدام النص الافتراضي. الجملة صحيحة حرفيًا: التجربة الافتراضية تعمل داخل متصفح المتسوّق، ولا تغادر الصور جهازه.',
                'Leave it blank for the default. That sentence is literally true: try-on runs inside the shopper’s browser, and the frames never leave their device.',
              )}
            </p>
          </Panel>

          <Panel title={t('خصوصية البيانات', 'Data protection')}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
              {t(
                'نلتزم بنظام حماية البيانات الشخصية السعودي (PDPL): لك حق طلب تصدير بياناتك أو حذفها.',
                'We follow the Saudi Personal Data Protection Law (PDPL): you have the right to request an export or an erasure of your data.',
              )}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-sm" disabled>{t('تصدير بياناتي', 'Export my data')}</button>
              <button type="button" className="btn btn-quiet btn-sm" disabled>{t('طلب الحذف', 'Request erasure')}</button>
            </div>
            <p className="hint">{t('الطلب الذاتي من هنا لم يُفعَّل بعد.', 'Requesting it from here is not switched on yet.')}</p>
          </Panel>
        </div>
      </div>

      <div className="save-bar">
        {failure && <ErrorNote error={failure} />}
        {Object.keys(errors).length > 0 && <span className="field-error" role="alert">{t('صحّح الحقول المعلّمة ثم احفظ.', 'Fix the marked fields, then save.')}</span>}
        {justSaved && <span role="status" className="hint" style={{ margin: 0 }}>{t('حُفظ', 'Saved')}</span>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Building2 size={16} aria-hidden />{saving ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ الإعدادات', 'Save settings')}
        </button>
      </div>
    </form>
  );
}
