'use client';

// P6.8 — AI jobs: the store's AI work, its progress, what it cost and what came back

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { AI_JOB_STAGE_LABELS, AI_JOB_TYPE_LABELS } from '@/lib/ai-jobs';
import { useData, useResource } from '@/lib/data';
import { formatNumber, formatRelative } from '@/lib/format';
import { sayProblem } from '@/lib/problem-text';
import { useLang } from '@/lib/i18n';
import type { AiJobView } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import { useWriteLock } from '@/components/dashboard/write-lock';

/** While anything is running, the list refreshes itself this often. */
const POLL_MS = 5000;

const STATUS: Record<AiJobView['status'], { tone: 'ok' | 'warn' | 'bad' | 'accent' | undefined; ar: string; en: string }> = {
  queued: { tone: 'accent', ar: 'في الانتظار', en: 'Waiting' },
  processing: { tone: 'accent', ar: 'قيد العمل', en: 'In progress' },
  done: { tone: 'ok', ar: 'اكتمل', en: 'Done' },
  failed: { tone: 'bad', ar: 'تعذّر', en: 'Failed' },
  cancelled: { tone: undefined, ar: 'أُلغي', en: 'Cancelled' },
};

export default function AiJobs() {
  const { t, pick, lang } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const [version, setVersion] = useState(0);
  const [activeOnly, setActiveOnly] = useState(false);
  const { data, loading, error } = useResource((s) => s.aiJobs(activeOnly), [activeOnly, version]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const running = !!data?.some((j) => j.canCancel);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setVersion((v) => v + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  const cancel = async (job: AiJobView) => {
    setBusy(job.id);
    setFailure(null);
    try {
      await source.cancelAiJob(job.id);
      setConfirming(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setFailure(sayProblem(e, lang));
    } finally {
      setBusy(null);
    }
  };

  const crumbs = [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('النماذج ثلاثية الأبعاد', '3D models'), href: '/dashboard/models' }, { label: t('أعمال الذكاء الاصطناعي', 'AI jobs') }];
  const productName = (job: AiJobView) => job.product ? (lang === 'ar' ? job.product.nameAr ?? job.product.name : job.product.name) : null;

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('أعمال الذكاء الاصطناعي', 'AI jobs')}
        lead={t(
          'كل ما يعمل عليه الذكاء الاصطناعي لمتجرك: ما اكتمل، وما يعمل الآن، وما كلّف من أرصدة وما أُعيد منها.',
          'Everything AI works on for your store: what finished, what is running now, what it cost in credits and what came back.',
        )}
      />
      <Panel flush title={t('المهام', 'Jobs')}
        actions={<label className="toggle"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /><span>{t('الجارية فقط', 'Running only')}</span></label>}>
        {loading && !data && <Loading rows={4} />}
        {error && <ErrorNote error={error} />}
        {data && data.length === 0 && (
          <Empty icon={<Sparkles size={22} aria-hidden />}
            title={activeOnly ? t('لا شيء يعمل الآن', 'Nothing is running') : t('لا أعمال بعد', 'No AI work yet')}
            body={t(
              'توليد نموذج ثلاثي الأبعاد من صور المنتج يبدأ من صفحة المنتج، ويظهر هنا بتقدّمه وتكلفته.',
              'Generating a 3D model from product photos starts on the product’s page, and shows here with its progress and cost.',
            )}
            action={<AppLink href="/dashboard/products" className="btn btn-ghost">{t('المنتجات', 'Products')}</AppLink>} />
        )}
        {data && data.length > 0 && (
          <ul className="job-list">
            {data.map((job) => (
              <li key={job.id}>
                <div className="job-main">
                  <strong>{pick(AI_JOB_TYPE_LABELS[job.type])}</strong>
                  {productName(job) && <span className="job-product">{job.product && <AppLink href={`/dashboard/products/${job.product.id}`}>{productName(job)}</AppLink>}</span>}
                  <Badge tone={STATUS[job.status].tone} dot={job.status === 'processing'}>{pick(STATUS[job.status])}</Badge>
                </div>
                {job.status === 'processing' && (
                  <div className="job-progress">
                    <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent} aria-label={t('التقدّم', 'Progress')}><i style={{ width: `${job.percent}%` }} /></div>
                    <span className="hint">{job.stage ? pick(AI_JOB_STAGE_LABELS[job.stage]) : ''} · <span className="num">{formatNumber(job.percent, lang)}%</span></span>
                  </div>
                )}
                {job.error && <p className="field-error" style={{ margin: '6px 0 0' }}>{pick(job.error.message)}</p>}
                <div className="job-meta hint">
                  <span>{t(`${formatNumber(job.creditsCost, lang)} أرصدة`, `${job.creditsCost} credits`)}{job.refunded ? t(' · أُعيدت', ' · returned') : ''}</span>
                  <span>{job.finishedAt ? formatRelative(job.finishedAt, lang) : job.queuedAt ? formatRelative(job.queuedAt, lang) : ''}</span>
                  {job.canCancel && (confirming === job.id
                    ? <span className="confirm-inline" role="alertdialog" aria-label={t('إلغاء المهمة', 'Cancel the job')}>
                        {job.status === 'queued'
                          ? t('إلغاء؟ يعود رصيدها لأنها لم تبدأ.', 'Cancel? Its credits come back, since it has not started.')
                          : t('إلغاء؟ بدأ العمل عليها، فلا يعود رصيدها.', 'Cancel? Work on it has started, so its credits are kept.')}{' '}
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => void cancel(job)} disabled={busy !== null}>{busy === job.id ? t('جارٍ الإلغاء…', 'Cancelling…') : t('نعم، ألغِ', 'Yes, cancel')}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)} disabled={busy !== null}>{t('تراجع', 'Keep it')}</button>
                      </span>
                    : <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(job.id)} disabled={busy !== null || lock.locked} title={lock.title}>{t('ألغِ', 'Cancel')}</button>)}
                </div>
              </li>
            ))}
          </ul>
        )}
        {failure && <p className="field-error" role="alert" style={{ margin: '0 18px 14px' }}>{failure}</p>}
      </Panel>
      <p className="hint">
        <AppLink href="/dashboard/billing" style={{ color: 'var(--aqua-ink)' }}>{t('رصيدك من الأرصدة', 'Your credit balance')}</AppLink>
      </p>
    </Shell>
  );
}
