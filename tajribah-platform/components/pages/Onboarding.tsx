'use client';

// ONB-01 — Welcome / what to expect · ONB-02 — Business profile · ONB-21 — Finish later
// AUTH-05 — Email verification: check your inbox (shown here until the address is confirmed)

import { STORE_LINKING } from '@/lib/features';
import { useWriteLock } from '@/components/dashboard/write-lock';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, Link2, Mail, Undo2 } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { ApiError, currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { SettingsPatch, type StoreSettings } from '@/lib/contracts/settings';
import { useData, useResource } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { PLAN_STEP_COPY, STEP_COPY } from '@/lib/onboarding-steps';
import { can, permissionsFor, type MemberRole } from '@/lib/permissions';
import { slugProblem } from '@/lib/slug';
import type { Bi } from '@/lib/lang';
import type { OnboardingView, StepKey, StepState } from '@/server/modules/onboarding/machine';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Forward, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import { authErrorMessage } from './auth-errors';

/** Server and contract messages are English; the ones this screen meets get their Arabic here. */
const MESSAGE_AR: [RegExp, string][] = [
  [/CR number is 10 digits/, 'رقم السجل التجاري 10 أرقام'],
  [/VAT number is 15 digits/, 'الرقم الضريبي 15 رقمًا، يبدأ وينتهي بالرقم 3'],
  [/needs a name/, 'اسم المتجر مطلوب'],
  [/3–40 lowercase/, 'من 3 إلى 40 حرفًا: حروف إنجليزية صغيرة وأرقام وشرطات'],
  [/a dash cannot/, 'لا تبدأ الشرطة أو تنتهي أو تتكرر'],
  [/reserved/, 'هذا العنوان محجوز'],
  [/is taken/, 'هذا العنوان مستخدم لمتجر آخر'],
  [/fixed once/, 'عنوان المتجر ثابت بعد تأكيده'],
  [/missing permission/, 'دورك لا يسمح بهذا — اطلبه من مالك المتجر'],
];

type Copy = { title: Bi; description: Bi; href: string; minutes: number };
const COPY = Object.fromEntries([PLAN_STEP_COPY, ...STEP_COPY].map((c) => [c.key, c])) as unknown as Record<StepKey, Copy>;

export default function Onboarding() {
  const { t } = useLang();
  const [changed, setChanged] = useState<OnboardingView | null>(null);
  const [picked, setPicked] = useState<StepKey | null>(null);
  const { data, loading, error } = useResource((source) => source.onboarding());
  const view = changed ?? data;

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('لنبدأ', 'Get started') },
  ];

  // After an action the guide moves to whatever the database now says is next.
  const moved = (next: OnboardingView) => { setChanged(next); setPicked(null); };

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('إعداد متجرك', 'Set up your store')}
        lead={t(
          'سبع خطوات بين الحساب وأول عميل يرى منتجك بحجمه الحقيقي. نعلّم الخطوة بأنها تمّت عندما تحدث فعلًا في متجرك، لا بعلامة يدوية.',
          'Seven steps between your account and the first shopper who sees your product at its real size. A step is ticked when it has actually happened in your store, not by hand.',
        )}
        actions={<AppLink href="/dashboard" className="btn btn-ghost">{t('أكمل لاحقًا', 'Finish later')}</AppLink>}
      />
      <VerifyNotice />
      {loading && !view && <Panel><Loading rows={5} /></Panel>}
      {error && !view && <ErrorNote error={error} />}
      {view && (
        <div className="grid grid-main">
          <div className="grid" style={{ gap: 18 }}>
            {view.complete && !picked
              ? <Complete />
              : <StepPanel step={view.steps.find((s) => s.key === (picked ?? view.current))!} onMoved={moved} />}
          </div>
          <Panel flush title={t('الخطوات', 'Steps')} sub={progressLine(view, t)}>
            <ol className="steps" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {view.steps.map((step, i) => (
                <li key={step.key} className={`step${step.done ? ' done' : ''}`}>
                  <span className="mark" aria-hidden>{step.done ? '✓' : i + 1}</span>
                  <div className="step-body">
                    <button
                      type="button" className="linklike" onClick={() => setPicked(step.key)}
                      aria-current={(picked ?? view.current) === step.key ? 'step' : undefined}
                    >
                      <StepTitle step={step} />
                    </button>
                  </div>
                  <div className="step-side"><StepBadge step={step} /></div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      )}
    </Shell>
  );
}

function progressLine(view: OnboardingView, t: (ar: string, en: string) => string): string {
  const done = view.steps.filter((s) => s.done).length;
  return t(`تمّت ${done} من ${view.steps.length}`, `${done} of ${view.steps.length} done`);
}

function StepTitle({ step }: { step: StepState }) {
  const { pick } = useLang();
  return <strong>{pick(COPY[step.key].title)}</strong>;
}

function StepBadge({ step }: { step: StepState }) {
  const { t } = useLang();
  if (step.done) return <Badge tone="ok">{t('تم', 'Done')}</Badge>;
  if (step.skipped) return <Badge>{t('مؤجّلة', 'Skipped')}</Badge>;
  if (step.current) return <Badge tone="accent" dot>{t('الآن', 'Now')}</Badge>;
  return null;
}

/** AUTH-05. The address is confirmed from the emailed link; until then, a way to get another one. */
function VerifyNotice() {
  const { t } = useLang();
  const auth = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  if (!auth.me || auth.me.user.emailVerified) return null;

  const resend = async () => {
    setState('sending');
    setProblem(null);
    try {
      const result = await auth.resendVerification();
      setState(result.alreadyVerified ? 'idle' : 'sent');
    } catch (error) {
      setProblem(authErrorMessage(error, t));
      setState('idle');
    }
  };

  return (
    <div className="notice" role="status">
      <Mail size={18} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{t('أكّد بريدك الإلكتروني', 'Confirm your email')}</strong>
        <p>
          {state === 'sent'
            ? t('أرسلنا رابطًا جديدًا إلى', 'We sent a new link to')
            : t('أرسلنا رابط التأكيد إلى', 'We sent the confirmation link to')}{' '}
          <span dir="ltr">{auth.me.user.email}</span>.{' '}
          {t('الفواتير وتنبيهات المتجر تصل إليه.', 'Invoices and store alerts go there.')}
        </p>
        {problem && <p role="alert" style={{ color: 'var(--warn)' }}>{problem}</p>}
      </div>
      {state !== 'sent' && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={resend} disabled={state === 'sending' || !auth.live}>
          {state === 'sending' ? t('جارٍ الإرسال…', 'Sending…') : t('أرسل رابطًا جديدًا', 'Send a new link')}
        </button>
      )}
    </div>
  );
}

/** One step: what it is, whether it is done, and the one action that moves it. */
function StepPanel({ step, onMoved }: { step: StepState; onMoved: (view: OnboardingView) => void }) {
  const { t, pick } = useLang();
  const lock = useWriteLock(); // T50: a read-only store or a staff view changes nothing
  const source = useData();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const copy = COPY[step.key];
  const role = currentStore(auth.me)?.role as MemberRole | undefined;
  const mayChange = (role ? can(permissionsFor(role), 'settings:write') : true) && !lock.locked;

  const act = async (run: () => Promise<OnboardingView>) => {
    setBusy(true);
    setFailure(null);
    try { onMoved(await run()); } catch (e) { setFailure(e as Error); } finally { setBusy(false); }
  };

  const skipButton = step.skippable && !step.done && !step.skipped && mayChange && (
    <button type="button" className="btn btn-ghost" onClick={() => act(() => source.skipStep(step.key))} disabled={busy}>
      {step.key === 'plan' ? t('أكمل بالتجربة المجانية', 'Continue with the free trial') : t('تخطَّ الآن', 'Skip for now')}
    </button>
  );
  const undoButton = step.skipped && mayChange && (
    <button type="button" className="btn btn-quiet btn-sm" onClick={() => act(() => source.unskipStep(step.key))} disabled={busy}>
      <Undo2 size={14} aria-hidden />{t('تراجع عن التأجيل', 'Undo the skip')}
    </button>
  );
  const goTo = (label: string) => (
    <AppLink href={copy.href} className="btn btn-primary">{label}<Forward size={14} /></AppLink>
  );

  let body: ReactNode;
  switch (step.key) {
    case 'account':
      body = <p>{t('حسابك جاهز. بريدك الإلكتروني هو ما تسجّل به الدخول وما نرسل إليه الفواتير.', 'Your account is ready. Your email is how you sign in and where invoices go.')}</p>;
      break;
    case 'store':
      body = <StoreStep done={step.done} mayChange={mayChange} onMoved={onMoved} />;
      break;
    case 'plan':
      body = <PlanStep actions={<>{skipButton}{goTo(t('اطّلع على الباقات', 'See the plans'))}</>} />;
      break;
    case 'connect':
      body = (
        <>
          <p>{STORE_LINKING ? t(
            'نستورد منتجاتك من سلة تلقائيًا ونُبقيها محدّثة. يمكنك التخطي الآن وإكمال الإعداد، ثم الربط لاحقًا.',
            'We import your catalogue from Salla automatically and keep it current. You can skip for now, finish setting up, and connect later.',
          ) : t(
            'نستورد منتجاتك من رابط منتجات متجرك (مثل رابط Google Merchant) أو من ملف، ونقرأ الرابط من جديد كل يوم. يمكنك التخطي الآن والاستيراد لاحقًا.',
            'We import your products from your store’s product feed link (like the one for Google Merchant) or a file, and read the link again every day. You can skip for now and import later.',
          )}</p>
          {STORE_LINKING && !step.done && (
            <p className="hint"><Link2 size={13} aria-hidden style={{ verticalAlign: -2 }} /> {t('ربط سلة بانتظار اعتماد حساب شريك سلة.', 'Connecting Salla is waiting on Salla partner account approval.')}</p>
          )}
          <div className="btn-row">{skipButton}<AppLink href={copy.href} className="btn btn-ghost">{t('صفحة الربط', 'Store connections')}</AppLink></div>
        </>
      );
      break;
    case 'catalogue':
      body = (
        <>
          <p>{t(
            'العرض بالحجم الحقيقي يحتاج عرض المنتج وارتفاعه بالمليمتر. تتم هذه الخطوة عندما يكون لمنتج نشط واحد على الأقل عرض وارتفاع.',
            'Real-size AR needs each product’s width and height in millimetres. This step is done when at least one active product has both.',
          )}</p>
          {!step.done && <div className="btn-row">{goTo(t('أضف المقاسات', 'Add dimensions'))}</div>}
        </>
      );
      break;
    case 'first_model':
      body = (
        <>
          <p>{t(
            'ارفع ملف GLB أو USDZ لمنتج واحد. نُحسّنه تلقائيًا، وتتم الخطوة عندما يصبح جاهزًا. لساعة، تكفي تجربتها بدل النموذج: صورتان مفرّغتان وعرض العلبة.',
            'Upload a GLB or USDZ file for one product. We optimise it automatically, and the step is done once it is ready. For a watch, its try-on is enough instead of a model: two cut-out pictures and the case width.',
          )}</p>
          {!step.done && <div className="btn-row">{goTo(t('ارفع نموذجًا', 'Upload a model'))}<AppLink href="/dashboard/tryon" className="btn btn-ghost">{t('تجربة الساعات', 'Watch try-on')}</AppLink></div>}
        </>
      );
      break;
    case 'publish':
      body = (
        <>
          <p>{t(
            'اختر منتجًا في «إعدادات العرض» واضغط «انشر في المتجر». يظهر زره في صفحة المنتج خلال دقيقة تقريبًا، ويبقى محدّثًا بعد ذلك تلقائيًا.',
            'Pick a product in AR settings and press “Publish to the store”. Its button appears on the product page within about a minute, and stays up to date by itself after that.',
          )}</p>
          {!step.done && <div className="btn-row">{goTo(t('إعدادات العرض', 'AR settings'))}</div>}
        </>
      );
      break;
    case 'embed':
      body = (
        <>
          <p>{t(
            'انسخ سطرين إلى قالب صفحة المنتج في متجرك. تتم الخطوة تلقائيًا عندما يبلّغ الزر عن أول مشاهدة من متجرك.',
            'Copy two lines into your store’s product page template. The step completes by itself when the button reports its first view from your store.',
          )}</p>
          {!step.done && <div className="btn-row">{goTo(t('كود التركيب', 'Install code'))}</div>}
        </>
      );
      break;
  }

  return (
    <Panel
      title={pick(copy.title)}
      sub={step.done ? t('تمّت هذه الخطوة', 'This step is done') : t(`حوالي ${copy.minutes} دقائق`, `About ${copy.minutes} min`)}
      actions={step.done ? <CheckCircle2 size={20} aria-hidden style={{ color: 'var(--ok)' }} /> : undoButton || null}
    >
      {step.skipped && <p className="hint" style={{ marginTop: 0 }}>{t('أجّلت هذه الخطوة. يمكنك العودة إليها متى شئت.', 'You skipped this step. You can come back to it any time.')}</p>}
      {body}
      {!mayChange && !step.done && step.key !== 'account' && (
        <p className="hint">{t('تأكيد المتجر والتخطي لمالك المتجر أو مديره.', 'Confirming the store and skipping are for the store’s owner or an admin.')}</p>
      )}
      {failure && <ErrorNote error={failure} />}
    </Panel>
  );
}

function PlanStep({ actions }: { actions: ReactNode }) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const trialEndsAt = currentStore(auth.me)?.trialEndsAt;
  return (
    <>
      <p>
        {trialEndsAt
          ? t(`تجربتك المجانية تعمل حتى ${formatDate(trialEndsAt, lang)}، دون بطاقة.`, `Your free trial runs until ${formatDate(trialEndsAt, lang)}, no card needed.`)
          : t('تجربتك المجانية تعمل الآن، دون بطاقة.', 'Your free trial is running, no card needed.')}{' '}
        {t('تختار الباقة قبل نهايتها.', 'You choose a plan before it ends.')}
      </p>
      <div className="btn-row">{actions}</div>
    </>
  );
}

/** ONB-02: the store's name and identity, and its address — chosen once, here. */
function StoreStep({ done, mayChange, onMoved }: { done: boolean; mayChange: boolean; onMoved: (view: OnboardingView) => void }) {
  const { t } = useLang();
  const [saved, setSaved] = useState<StoreSettings | null>(null);
  const { data, error } = useResource((source) => source.settings());
  const settings = saved ?? data;
  if (error) return <ErrorNote error={error} />;
  if (!settings) return <Loading rows={3} />;
  if (done) {
    return (
      <>
        <p>{t('بيانات متجرك مؤكَّدة.', 'Your store details are confirmed.')}</p>
        <dl className="facts">
          <dt>{t('اسم المتجر', 'Store name')}</dt><dd>{settings.nameAr ?? settings.name}</dd>
          <dt>{t('عنوان المتجر', 'Store address')}</dt><dd dir="ltr" className="mm">{settings.slug}</dd>
        </dl>
        <AppLink href="/dashboard/settings" className="btn btn-ghost btn-sm">{t('تعديل في الإعدادات', 'Edit in settings')}</AppLink>
      </>
    );
  }
  return <StoreForm key={JSON.stringify(settings)} settings={settings} mayChange={mayChange} onSaved={setSaved} onMoved={onMoved} />;
}

type StoreFields = { name: string; crNumber: string; vatNumber: string; slug: string };

function StoreForm({ settings, mayChange, onSaved, onMoved }: {
  settings: StoreSettings; mayChange: boolean; onSaved: (s: StoreSettings) => void; onMoved: (view: OnboardingView) => void;
}) {
  const { t, lang } = useLang();
  const source = useData();
  const original: StoreFields = { name: settings.name, crNumber: settings.crNumber ?? '', vatNumber: settings.vatNumber ?? '', slug: settings.slug };
  const [form, setForm] = useState<StoreFields>(original);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);

  const say = (message: string) => (lang === 'ar' ? MESSAGE_AR.find(([p]) => p.test(message))?.[1] ?? message : message);
  const set = (key: keyof StoreFields) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    // Checked here first (the shared contract and slug rule), then again by the server.
    const patch = Object.fromEntries((['name', 'crNumber', 'vatNumber'] as const).filter((k) => form[k] !== original[k]).map((k) => [k, form[k]]));
    const fields: Record<string, string[]> = {};
    const local = SettingsPatch.safeParse(patch);
    if (!local.success) for (const issue of local.error.issues) (fields[String(issue.path[0])] ??= []).push(issue.message);
    const slug = form.slug.trim().toLowerCase();
    const slugChanged = slug !== original.slug;
    const problem = slugChanged ? slugProblem(slug) : null;
    if (problem) fields.slug = [problem];
    setErrors(fields);
    if (Object.keys(fields).length) return;

    setBusy(true);
    try {
      if (Object.keys(patch).length) onSaved(await source.updateSettings(patch));
      onMoved(await source.confirmStore(slugChanged ? slug : undefined));
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else setFailure(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof StoreFields, label: string, options: { hint?: string; ltr?: boolean; numeric?: boolean; placeholder?: string } = {}) => {
    const message = errors[key]?.[0];
    return (
      <div className="field">
        <label htmlFor={`onb-${key}`}>{label}</label>
        <input
          id={`onb-${key}`} value={form[key]} onChange={(e) => set(key)(e.target.value)} disabled={!mayChange}
          dir={options.ltr ? 'ltr' : undefined} inputMode={options.numeric ? 'numeric' : undefined} placeholder={options.placeholder}
          aria-invalid={!!message} aria-describedby={message ? `onb-${key}-error` : options.hint ? `onb-${key}-hint` : undefined}
        />
        {message
          ? <span id={`onb-${key}-error`} className="field-error">{say(message)}</span>
          : options.hint && <span id={`onb-${key}-hint`} className="field-hint">{options.hint}</span>}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <p style={{ marginTop: 0, marginBottom: 18 }}>{t(
        'تأكد من اسم متجرك واختر عنوانه. السجل التجاري والرقم الضريبي اختياريان الآن، ويلزمان للفواتير لاحقًا.',
        'Check your store’s name and choose its address. CR and VAT numbers are optional now; invoices need them later.',
      )}</p>
      {field('name', t('اسم المتجر', 'Store name'))}
      {field('slug', t('عنوان المتجر', 'Store address'), {
        ltr: true,
        hint: t('حروف إنجليزية صغيرة وأرقام وشرطات. يدخل في كود التركيب، فلا يتغيّر بعد التأكيد.', 'Lowercase Latin letters, digits and dashes. It goes into your install code, so it is fixed once confirmed.'),
      })}
      {field('crNumber', t('رقم السجل التجاري (اختياري)', 'Commercial registration (optional)'), { ltr: true, numeric: true, hint: t('10 أرقام.', '10 digits.') })}
      {field('vatNumber', t('الرقم الضريبي (اختياري)', 'VAT number (optional)'), { ltr: true, numeric: true, hint: t('15 رقمًا يبدأ وينتهي بالرقم 3.', '15 digits, starting and ending with 3.') })}
      {failure && <ErrorNote error={failure} />}
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={busy || !mayChange}>
          {busy ? t('جارٍ الحفظ…', 'Saving…') : t('أكّد بيانات المتجر', 'Confirm store details')}
        </button>
      </div>
    </form>
  );
}

/** Every step is done: the store is live. */
function Complete() {
  const { t } = useLang();
  return (
    <Panel title={t('متجرك جاهز', 'Your store is live')}>
      <p style={{ marginTop: 0 }}>{t(
        'عملاؤك يرون منتجاتك الآن بحجمها الحقيقي. تابع الأثر على التحويل والإرجاع من الرئيسية.',
        'Your shoppers now see your products at their real size. Follow the effect on conversion and returns from home.',
      )}</p>
      <AppLink href="/dashboard" className="btn btn-primary">{t('إلى الرئيسية', 'Go to home')}<Forward size={14} /></AppLink>
    </Panel>
  );
}
