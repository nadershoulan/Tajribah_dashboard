'use client';

// MD-040 — 3D model library

import { useWriteLock } from '@/components/dashboard/write-lock';
import { Fragment, useRef, useState, type DragEvent } from 'react';
import { Box, ChevronDown, CloudUpload, Wand2 } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useData, useResource } from '@/lib/data';
import { formatBytes, formatNumber, formatRelative } from '@/lib/format';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import type { ModelRow, ModelVersionRow } from '@/lib/view-models';
import { MODEL_TARGET_BYTES } from '@/lib/model-size';

/** Under this, AR loads in about two seconds on a Saudi mobile network. Over it, it does not. */
const SIZE_TARGET_BYTES = MODEL_TARGET_BYTES;

const SOURCE_LABEL: Record<ModelRow['source'], { ar: string; en: string }> = {
  uploaded: { ar: 'مرفوع', en: 'Uploaded' },
  ai_generated: { ar: 'مولَّد بالذكاء الاصطناعي', en: 'AI generated' },
  professional_service: { ar: 'خدمة احترافية', en: 'Professional service' },
};

const UPLOAD_AR: [RegExp, string][] = [
  [/only \.glb and \.usdz/, 'يُقبل ملف .glb أو .usdz فقط'],
  [/larger than/, 'الملف أكبر من 50 ميجابايت'],
  [/the file is empty/, 'الملف فارغ'],
  [/not a GLB file/, 'ليس ملف GLB — أول بايتات الملف ليست "glTF"'],
  [/cut off|damaged/, 'الملف ناقص أو تالف — ربما انقطع الرفع. جرّب مرة أخرى'],
  [/glTF version/, 'إصدار glTF غير مدعوم — صدّره بصيغة glTF 2.0'],
  [/not a USDZ file|USDZ files must be stored uncompressed|must be the USD scene/, 'ملف USDZ غير صالح — صدّره بأداة USDZ'],
  [/could not be (read|optimised)/, 'تعذّرت قراءة النموذج — افتحه في برنامج ثلاثي الأبعاد وصدّره من جديد'],
  [/never confirmed/, 'لم يكتمل الرفع — ارفع الملف مرة أخرى'],
];

/** A checker's reason, in the reader's language; unmapped reasons stay as written. */
const sayProblem = (message: string, lang: string) =>
  (lang === 'ar' ? UPLOAD_AR.find(([pattern]) => pattern.test(message))?.[1] ?? message : message);

export default function Models() {
  const { t, pick, lang } = useLang();
  const lock = useWriteLock(); // T50: a read-only store or a staff view changes nothing
  const source = useData();
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useResource((s) => s.models(), [version]);
  const reload = () => setVersion((v) => v + 1);
  const [open, setOpen] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ state: 'busy' | 'done' | 'failed'; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  /** Server refusals are English; the ones an upload meets get their Arabic here. */
  const say = (message: string) => sayProblem(message, lang);
  const send = async (file: File | undefined) => {
    if (!file) return;
    setUpload({ state: 'busy', message: t(`جارٍ رفع ${file.name}…`, `Uploading ${file.name}…`) });
    try {
      const result = await source.uploadModel(file);
      setUpload(result.status === 'failed'
        ? { state: 'failed', message: t(`رُفض الملف: ${say(result.error ?? '')}`, `The file was refused: ${result.error ?? ''}`) }
        : { state: 'done', message: t('وصل الملف، ونجهّزه الآن للجوال. يظهر جاهزًا خلال دقائق.', 'The file arrived and is being prepared for phones. It shows as ready within minutes.') });
      reload();
    } catch (failure) {
      const fields = (failure as { fields?: Record<string, string[]> }).fields;
      const storageFull = /plan limit reached for storage_gb \((\d+)\)/.exec((failure as Error).message);
      const reason = fields ? Object.values(fields).flat().map(say).join(' · ')
        : storageFull
          ? t(`مساحة التخزين في باقتك ممتلئة (${storageFull[1]} GB). رقِّ باقتك لإضافة المزيد، أو تواصل معنا.`,
            `your plan’s storage is full (${storageFull[1]} GB). Upgrade your plan to add more, or contact us.`)
          : (failure as Error).message;
      setUpload({ state: 'failed', message: t(`تعذّر الرفع: ${reason}`, `Upload failed: ${reason}`) });
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void send(event.dataTransfer.files[0]);
  };

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
            <input ref={picker} type="file" accept=".glb,.usdz" hidden onChange={(e) => { void send(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className="btn btn-primary" onClick={() => picker.current?.click()} disabled={upload?.state === 'busy' || lock.locked} title={lock.title}>
              <CloudUpload size={16} aria-hidden />{t('ارفع ملفًا', 'Upload a file')}
            </button>
            <button type="button" className="btn btn-ghost" disabled title={t('يصل مع مرحلة التوليد بالذكاء الاصطناعي', 'Arrives with the AI generation phase')}>
              <Wand2 size={16} aria-hidden />{t('ولّد من صور', 'Generate from photos')}
            </button>
            <AppLink href="/dashboard/ai-jobs" className="btn btn-quiet">{t('أعمال الذكاء الاصطناعي', 'AI jobs')}</AppLink>
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

      {upload && (
        <p role="status" className={`upload-note upload-${upload.state}`}>{upload.message}</p>
      )}

      <div
        className={`drop-zone${dragging ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
      <Panel flush title={t('مكتبة النماذج', 'Model library')} sub={t('اسحب ملف GLB أو USDZ وأفلته هنا', 'Drop a GLB or USDZ file here')}>
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
            action={<button type="button" className="btn btn-accent" onClick={() => picker.current?.click()} disabled={lock.locked} title={lock.title}><CloudUpload size={16} aria-hidden />{t('ارفع أول نموذج', 'Upload your first model')}</button>}
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
                  <th scope="col"><span className="sr-only">{t('الإصدارات', 'Versions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((model) => (
                  <Fragment key={model.id}>
                  <tr>
                    <td>
                      <div className="cell-main">
                        <span className="thumb" aria-hidden><Box size={17} /></span>
                        <span className="lines">
                          <strong>{(lang === 'ar' ? model.productNameAr ?? model.productName : model.productName) ?? model.name}</strong>
                          <span>{model.name} · v{model.version}</span>
                        </span>
                      </div>
                    </td>
                    <td style={{ fontSize: 13.5 }}>{pick(SOURCE_LABEL[model.source])}</td>
                    <td><StatusBadge status={model.status} /></td>
                    <td><QaBadge model={model} /></td>
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
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {model.status === 'ready' && (
                        <AppLink href={`/dashboard/models/${encodeURIComponent(model.id)}`} className="btn btn-quiet btn-sm">{t('حرّر', 'Edit')}</AppLink>
                      )}
                      <button type="button" className="btn btn-quiet btn-sm" aria-expanded={open === model.id}
                        onClick={() => setOpen(open === model.id ? null : model.id)}>
                        {t('الإصدارات', 'Versions')}<ChevronDown size={14} aria-hidden style={{ transform: open === model.id ? 'rotate(180deg)' : undefined }} />
                      </button>
                    </td>
                  </tr>
                  {open === model.id && (
                    <tr className="versions-row">
                      <td colSpan={9}><Versions model={model} onPublished={reload} /></td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      </div>

      <Panel title={t('لماذا يهم حجم النموذج', 'Why model size matters')} >
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 14 }}>
          {t(
            'نموذج بحجم 5 ميجابايت يُحمّل في نحو 8 ثوانٍ على شبكة جوال سعودية، وبحجم 1.5 ميجابايت في ثانيتين. العرض البطيء لا يُستخدم. لذلك يُنظَّف كل نموذج GLB مرفوع ويُضغط تلقائيًا (meshopt)، وتُصغَّر الصور داخله وتُحوَّل إلى WebP بأكبر مقاس يبقيه تحت 2 ميجابايت، ونعرض حجمه قبل الضغط وبعده.',
            'A 5 MB model takes about 8 seconds on a Saudi mobile network; 1.5 MB takes two. Slow AR is unused AR, so every uploaded GLB is cleaned up and compressed automatically (meshopt), the images inside it are converted to WebP at the largest size that keeps it under 2 MB, and you see its size before and after.',
          )}
        </p>
        <p className="hint">
          <AppLink href="/dashboard/products" style={{ color: 'var(--aqua-ink)' }}>
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

/** P3.6 (T25): only generated models are reviewed by Tajribah; an upload is the merchant's own file. */
function QaBadge({ model }: { model: ModelRow }) {
  const { t } = useLang();
  if (model.source === 'uploaded') return <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{t('ملفك — لا يحتاج مراجعة', 'Your file — not reviewed')}</span>;
  if (model.source === 'professional_service') return <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{t('صنعه فريق تجربة', 'Made by Tajribah')}</span>;
  if (model.qaStatus === 'approved') return <Badge tone="ok">{t('معتمد', 'Approved')}</Badge>;
  if (model.qaStatus === 'rejected') return <Badge tone="bad">{t('يحتاج تعديلًا', 'Needs changes')}</Badge>;
  return <Badge tone="warn">{t('بانتظار المراجعة', 'Waiting for review')}</Badge>;
}

/** A model's versions, newest first, with Publish on each ready one that is not live. */
function Versions({ model, onPublished }: { model: ModelRow; onPublished: () => void }) {
  const { t, lang } = useLang();
  const lock = useWriteLock(); // T50: a read-only store or a staff view changes nothing
  const source = useData();
  const modelId = model.id;
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useResource((s) => s.modelVersions(modelId), [modelId, version]);
  // P3.6 (T25): a generated model goes live only after Tajribah has reviewed it.
  const held = model.source === 'ai_generated' && model.qaStatus !== 'approved';
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  // T46: which delete is being confirmed — a version's id, or 'model'.
  const [confirming, setConfirming] = useState<string | null>(null);

  const remove = async (what: string) => {
    setBusy(what);
    setFailure(null);
    try {
      if (what === 'model') await source.deleteModel(modelId);
      else await source.deleteModelVersion(what);
      setConfirming(null);
      setVersion((v) => v + 1);
      onPublished();
    } catch (e) {
      setFailure(e as Error);
    } finally {
      setBusy(null);
    }
  };

  const publish = async (row: ModelVersionRow) => {
    setBusy(row.id);
    setFailure(null);
    try {
      await source.publishVersion(row.id);
      setVersion((v) => v + 1);
      onPublished();
    } catch (e) {
      setFailure(e as Error);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading rows={2} />;
  if (error) return <ErrorNote error={error} />;
  const live = data?.find((v) => v.isCurrent);
  return (
    <div className="versions">
      <ul>
        {(data ?? []).map((row) => (
          <li key={row.id}>
            <strong className="num">v{row.version}</strong>
            <StatusBadge status={row.status} />
            {row.isCurrent && <Badge tone="ok" dot>{t('منشور', 'Live')}</Badge>}
            <span className="versions-size">
              {row.optimizedBytes !== null
                ? <>
                    <span className="num">{formatBytes(row.originalBytes ?? 0, lang)}</span> → <span className="num" style={{ color: row.withinTarget ? undefined : 'var(--warn)' }}>{formatBytes(row.optimizedBytes, lang, 2)}</span>
                    {' '}{row.withinTarget ? t('ضمن الهدف', 'within target') : t('فوق 2 ميجابايت', 'over 2 MB')}
                  </>
                : row.originalBytes ? <span className="num">{formatBytes(row.originalBytes, lang)}</span> : '—'}
            </span>
            {row.status === 'failed' && row.error && <span className="versions-error" dir="auto">{sayProblem(row.error, lang)}</span>}
            {row.status === 'ready' && !row.isCurrent && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => publish(row)} disabled={busy !== null || held || lock.locked}
                title={held ? t('بانتظار مراجعة تجربة', 'Waiting for Tajribah’s review') : undefined}>
                {busy === row.id ? t('جارٍ النشر…', 'Publishing…')
                  : live && live.version > row.version ? t('ارجع إلى هذا الإصدار', 'Roll back to this') : t('انشر', 'Publish')}
              </button>
            )}
            {!row.isCurrent && row.status !== 'processing' && (confirming === row.id
              ? <span className="confirm-inline" role="alertdialog" aria-label={t(`حذف الإصدار ${row.version}`, `Delete version ${row.version}`)}>
                  {t(`حذف v${row.version} وملفاته؟`, `Delete v${row.version} and its files?`)}{' '}
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(row.id)} disabled={busy !== null}>{busy === row.id ? t('جارٍ الحذف…', 'Deleting…') : t('نعم، احذف', 'Yes, delete')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)} disabled={busy !== null}>{t('إلغاء', 'Cancel')}</button>
                </span>
              : <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(row.id)} disabled={busy !== null || lock.locked} title={lock.title}>{t('احذف', 'Delete')}</button>)}
          </li>
        ))}
      </ul>
      {failure && <ErrorNote error={failure} />}
      {held && (
        <p className="hint" style={{ margin: '8px 0 0', color: model.qaStatus === 'rejected' ? 'var(--bad)' : undefined }}>
          {model.qaStatus === 'rejected'
            ? t('لم يُعتمد هذا النموذج في المراجعة.', 'This model was not approved in review.')
            : t('نموذج مولَّد: يراجعه فريق تجربة قبل أن يمكن نشره، ونرسل لك إشعارًا عند الانتهاء.', 'A generated model: Tajribah’s team reviews it before it can be published, and you are notified when that is done.')}
          {/* Only a reviewer's note reaches the merchant; while pending, the note is post-processing's, for staff. */}
          {model.qaStatus === 'rejected' && model.qaNotes && <> {t('ملاحظة المراجع:', 'Reviewer’s note:')} <span dir="auto">{model.qaNotes}</span></>}
        </p>
      )}
      <p className="hint" style={{ margin: '8px 0 0' }}>
        {t('النشر يجعل هذا الإصدار هو ما يراه المتسوقون. الرفع وحده لا ينشر شيئًا. حذف إصدار غير منشور يحرّر مساحته.', 'Publishing makes this version what shoppers see. Uploading alone never publishes anything. Deleting a version that is not live frees its storage.')}
      </p>
      {confirming === 'model'
        ? <div className="confirm" role="alertdialog" aria-labelledby={`delete-${modelId}`} style={{ marginTop: 10 }}>
            <p id={`delete-${modelId}`} style={{ margin: 0 }}>
              <strong>{t('حذف هذا النموذج بكل إصداراته؟', 'Delete this model and every version?')}</strong>{' '}
              {t('تُحذف ملفاته وتتحرّر مساحتها. إن كان المنتج منشورًا في متجرك يُزال عرضه ثلاثي الأبعاد خلال دقيقة تقريبًا، وتبقى تجربة الساعة إن وُجدت.', 'Its files are deleted and their storage freed. If the product is published on your shop, its 3D view is taken off within about a minute; a watch keeps its try-on.')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => remove('model')} disabled={busy !== null}>{busy === 'model' ? t('جارٍ الحذف…', 'Deleting…') : t('نعم، احذف النموذج', 'Yes, delete the model')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)} disabled={busy !== null}>{t('إلغاء', 'Cancel')}</button>
            </div>
          </div>
        : <button type="button" className="btn btn-quiet btn-sm" style={{ marginTop: 8 }} onClick={() => setConfirming('model')} disabled={busy !== null || lock.locked} title={lock.title}>{t('احذف النموذج كله', 'Delete the whole model')}</button>}
    </div>
  );
}
