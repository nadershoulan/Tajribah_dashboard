'use client';

// MD-040 — 3D model library

import { Box, CloudUpload, Sparkles, Wand2 } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { formatBytes, formatNumber, formatRelative } from '@/lib/format';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import type { ModelRow } from '@/lib/view-models';

/** Under this, AR loads in about two seconds on a Saudi mobile network. Over it, it does not. */
const SIZE_TARGET_BYTES = 2_000_000;

const SOURCE_LABEL: Record<ModelRow['source'], { ar: string; en: string }> = {
  uploaded: { ar: 'مرفوع', en: 'Uploaded' },
  ai_generated: { ar: 'مولَّد بالذكاء الاصطناعي', en: 'AI generated' },
  professional_service: { ar: 'خدمة احترافية', en: 'Professional service' },
};

export default function Models() {
  const { t, pick, lang } = useLang();
  const { data, loading, error } = useResource((source) => source.models());

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('النماذج ثلاثية الأبعاد', '3D models') },
  ];

  const ready = (data ?? []).filter((m) => m.status === 'ready');
  const oversized = ready.filter((m) => m.sizeBytes > SIZE_TARGET_BYTES);
  const averageSize = ready.length
    ? ready.reduce((total, m) => total + m.sizeBytes, 0) / ready.length
    : 0;

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('النماذج ثلاثية الأبعاد', '3D models')}
        lead={t(
          'ارفع ملف GLB جاهزًا، أو ولّد نموذجًا من صور المنتج. نحوّل كل نموذج إلى GLB و USDZ ونضغطه ليعمل على شبكات الجوال.',
          'Upload a ready GLB, or generate one from product photos. Every model becomes GLB and USDZ, compressed to work on mobile networks.',
        )}
        actions={
          <>
            <button type="button" className="btn btn-ghost">
              <CloudUpload size={16} aria-hidden />{t('ارفع ملفًا', 'Upload a file')}
            </button>
            <button type="button" className="btn btn-primary">
              <Wand2 size={16} aria-hidden />{t('ولّد من صور', 'Generate from photos')}
            </button>
          </>
        }
      />

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <div className="panel stat">
          <p className="stat-label">{t('نماذج جاهزة', 'Models ready')}</p>
          <div className="stat-value">{formatNumber(ready.length, lang)}</div>
          <div className="stat-sub">
            {t(`من ${formatNumber(data?.length ?? 0, lang)} نموذجًا`, `of ${formatNumber(data?.length ?? 0, lang)} total`)}
          </div>
        </div>
        <div className="panel stat">
          <p className="stat-label">{t('متوسط الحجم', 'Average size')}</p>
          <div className="stat-value">{ready.length ? formatBytes(averageSize, lang) : '—'}</div>
          <div className="stat-sub">
            {t('الهدف أقل من 2 ميجابايت', 'Target: under 2 MB')}
          </div>
        </div>
        <div className="panel stat">
          <p className="stat-label">{t('أكبر من الهدف', 'Over target')}</p>
          <div className="stat-value">{formatNumber(oversized.length, lang)}</div>
          <div className="stat-sub">
            {t('النموذج الأكبر يعني تحميلًا أبطأ وتكلفة أعلى', 'A bigger model means a slower load and a bigger bill')}
          </div>
        </div>
      </div>

      <Panel flush title={t('مكتبة النماذج', 'Model library')}>
        {loading && <Loading rows={5} />}
        {error && <ErrorNote error={error} />}

        {!loading && !error && (data ?? []).length === 0 && (
          <Empty
            icon={<Box size={22} />}
            title={t('لا توجد نماذج بعد', 'No models yet')}
            body={t(
              'ابدأ بمنتج واحد: ارفع ملفًا جاهزًا إن كان لديك، وإلا ولّد نموذجًا من ثلاث صور — أمامية وجانبية وخلفية.',
              'Start with one product: upload a file if you have one, or generate a model from three photos — front, side and back.',
            )}
            action={<button type="button" className="btn btn-accent"><Sparkles size={16} aria-hidden />{t('ولّد أول نموذج', 'Generate your first model')}</button>}
          />
        )}

        {!loading && !error && (data ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">{t('النموذج', 'Model')}</th>
                  <th scope="col">{t('المصدر', 'Source')}</th>
                  <th scope="col">{t('الحالة', 'Status')}</th>
                  <th scope="col">{t('المراجعة', 'QA')}</th>
                  <th scope="col">{t('الحجم', 'Size')}</th>
                  <th scope="col">{t('المضلعات', 'Polygons')}</th>
                  <th scope="col">{t('الصيغ', 'Formats')}</th>
                  <th scope="col">{t('آخر تحديث', 'Updated')}</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((model) => (
                  <tr key={model.id}>
                    <td>
                      <div className="cell-main">
                        <span className="thumb" aria-hidden><Box size={17} /></span>
                        <span className="lines">
                          <strong>{model.productName ?? model.name}</strong>
                          <span>{model.name} · v{model.version}</span>
                        </span>
                      </div>
                    </td>
                    <td style={{ fontSize: 13.5 }}>{pick(SOURCE_LABEL[model.source])}</td>
                    <td><StatusBadge status={model.status} /></td>
                    <td><QaBadge status={model.qaStatus} /></td>
                    <td className="num">
                      {model.sizeBytes
                        ? (
                          <span style={{ color: model.sizeBytes > SIZE_TARGET_BYTES ? 'var(--warn)' : undefined }}>
                            {formatBytes(model.sizeBytes, lang)}
                          </span>
                        )
                        : '—'}
                    </td>
                    <td className="num">{model.polyCount ? formatNumber(model.polyCount, lang) : '—'}</td>
                    <td>
                      {model.formats.length
                        ? model.formats.map((format) => (
                          <span key={format} className="badge" style={{ marginInlineEnd: 4, textTransform: 'uppercase' }}>{format}</span>
                        ))
                        : '—'}
                    </td>
                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{formatRelative(model.updatedAt, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t('لماذا يهم حجم النموذج', 'Why model size matters')} >
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 14 }}>
          {t(
            'نموذج بحجم 5 ميجابايت يُحمّل في نحو 8 ثوانٍ على شبكة جوال سعودية، وبحجم 1.5 ميجابايت في ثانيتين. العرض البطيء لا يُستخدم. لذلك نضغط كل نموذج تلقائيًا (Draco و meshopt و KTX2) ونولّد مستويات تفصيل أخف للأجهزة الأضعف.',
            'A 5 MB model takes about 8 seconds on a Saudi mobile network; 1.5 MB takes two. Slow AR is unused AR, so every model is compressed automatically (Draco, meshopt, KTX2) and given lighter levels of detail for weaker devices.',
          )}
        </p>
        <p className="hint">
          <AppLink href="/dashboard/products" style={{ color: 'var(--aqua)' }}>
            {t('ابحث عن المنتجات التي بلا نموذج', 'Find products with no model')}
          </AppLink>
        </p>
      </Panel>
    </Shell>
  );
}

function StatusBadge({ status }: { status: ModelRow['status'] }) {
  const { t } = useLang();
  if (status === 'ready') return <Badge tone="ok" dot>{t('جاهز', 'Ready')}</Badge>;
  if (status === 'processing') return <Badge tone="accent">{t('قيد المعالجة', 'Processing')}</Badge>;
  if (status === 'failed') return <Badge tone="bad">{t('فشل', 'Failed')}</Badge>;
  if (status === 'archived') return <Badge>{t('مؤرشف', 'Archived')}</Badge>;
  return <Badge>{t('مسودة', 'Draft')}</Badge>;
}

function QaBadge({ status }: { status: ModelRow['qaStatus'] }) {
  const { t } = useLang();
  if (status === 'approved') return <Badge tone="ok">{t('معتمد', 'Approved')}</Badge>;
  if (status === 'rejected') return <Badge tone="bad">{t('مرفوض', 'Rejected')}</Badge>;
  return <Badge tone="warn">{t('بانتظار المراجعة', 'Pending')}</Badge>;
}
