'use client';

// P3.8 — the 3D editor: see the model, turn it so it stands and faces right, fit it to the product's size,
// and choose the view used as the model's picture

import { createElement, useEffect, useState } from 'react';
import { Box, Camera, Maximize2, RotateCcw, RotateCw, Save } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useData, useResource } from '@/lib/data';
import { useLang } from '@/lib/i18n';
import { loadModelViewer } from '@/lib/model-viewer';
import { NO_TURN, next, turnedSize, viewerOrientation, type Turns } from '@/lib/model-turn';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import type { ModelRow, ModelVersionRow, ProductRow } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import { captureView, ModelPicture } from '@/components/dashboard/model-picture';

type Loaded = { model: ModelRow; version: ModelVersionRow | null; product: ProductRow | null };

export default function ModelEditor() {
  const { t, lang } = useLang();
  const { path } = useEnv();
  const id = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
  const [reload, setReload] = useState(0);
  const { data, loading, error } = useResource(async (source): Promise<Loaded | null> => {
    const model = (await source.models()).find((m) => m.id === id);
    if (!model) return null;
    const versions = await source.modelVersions(id);
    // The version to work from: the live one when it is ready, else the newest ready one.
    const version = versions.find((v) => v.isCurrent && v.status === 'ready') ?? versions.find((v) => v.status === 'ready') ?? null;
    const product = model.productId ? await source.product(model.productId) : null;
    return { model, version, product };
  }, [id, reload]);

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('النماذج ثلاثية الأبعاد', '3D models'), href: '/dashboard/models' },
    { label: (data ? productLabel(data.model, lang) : null) ?? data?.model.name ?? t('النموذج', 'Model') },
  ];
  return (
    <Shell tenant={null} crumbs={crumbs}>
      {loading && !data && <Loading rows={6} />}
      {error && <ErrorNote error={error} />}
      {!loading && !error && data === null && (
        <Empty icon={<Box size={22} />} title={t('النموذج غير موجود', 'Model not found')} body={t('ربما حُذف، أو أنه يتبع متجرًا آخر.', 'It may have been deleted, or it belongs to another store.')}
          action={<AppLink href="/dashboard/models" className="btn btn-ghost">{t('كل النماذج', 'All models')}</AppLink>} />
      )}
      {data && <Editor key={data.version?.id ?? 'none'} loaded={data} onSaved={() => setReload((r) => r + 1)} />}
    </Shell>
  );
}

function Editor({ loaded, onSaved }: { loaded: Loaded; onSaved: () => void }) {
  const { t, lang } = useLang();
  const source = useData();
  const auth = useAuth();
  const role = currentStore(auth.me)?.role;
  const canEdit = !role || (ROLE_PERMISSIONS[role] as readonly string[]).includes('models:write');
  const { model, version, product } = loaded;
  const [src, setSrc] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turns>(NO_TURN);
  const [fit, setFit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const [viewer, setViewer] = useState<HTMLElement | null>(null); // the `<model-viewer>`, for its picture
  const [picturing, setPicturing] = useState(false);
  const [pictureNote, setPictureNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!version) return;
    let live = true;
    let url: string | null = null;
    Promise.all([source.modelFile(version.id), loadModelViewer()])
      .then(([blob]) => { if (live) { url = URL.createObjectURL(blob); setSrc(url); } })
      .catch((e: Error) => { if (live) setViewError(e.message); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [source, version]);

  const dims = product?.dimensions ?? null;
  const measured = !!dims && [dims.widthMm, dims.heightMm, dims.depthMm].some((v) => typeof v === 'number' && v > 0);
  const now = version?.sizeMm ?? null;
  const after = now ? turnedSize(now, turns) : null;
  const turned = turns.x !== 0 || turns.y !== 0 || turns.z !== 0;
  const mm = (v: number | null | undefined) => (v == null ? '—' : `${v}`);

  const save = async () => {
    if (!version) return;
    setSaving(true);
    setFailure(null);
    try {
      const made = await source.editModel(model.id, { fromVersionId: version.id, rotate: turns, fit });
      setSaved(made.version);
      setTurns(NO_TURN);
      setFit(false);
      onSaved();
    } catch (e) {
      setFailure(e as Error);
    } finally {
      setSaving(false);
    }
  };

  // The view as it is now in the viewer — after the merchant turned and zoomed it with the mouse or fingers.
  const choosePicture = async () => {
    if (!viewer) return;
    setPicturing(true);
    setPictureNote(null);
    try {
      await source.setModelPicture(model.id, await captureView(viewer));
      setPictureNote({ ok: true, text: t('صارت هذه الصورة صورة النموذج.', 'This is now the model’s picture.') });
      onSaved();
    } catch (e) {
      setPictureNote({ ok: false, text: (e as Error).message });
    } finally {
      setPicturing(false);
    }
  };

  const turnButton = (axisKey: keyof Turns, label: string, hint: string, back = false) => (
    <button type="button" className="btn btn-ghost btn-sm" disabled={!canEdit || !version} title={hint}
      onClick={() => setTurns((v) => ({ ...v, [axisKey]: back ? (((v[axisKey] + 270) % 360) as Turns['x']) : next(v[axisKey]) }))}>
      {back ? <RotateCcw size={14} aria-hidden /> : <RotateCw size={14} aria-hidden />}{label}
    </button>
  );

  return (
    <>
      <PageHead
        title={productLabel(model, lang) ?? model.name}
        lead={version ? t(`يعمل على الإصدار ${version.version}${version.isCurrent ? ' (المنشور)' : ''}`, `Working from version ${version.version}${version.isCurrent ? ' (live)' : ''}`) : undefined}
        actions={<AppLink href="/dashboard/models" className="btn btn-ghost">{t('كل النماذج', 'All models')}</AppLink>}
      />
      {!version && <Panel><p style={{ margin: 0 }}>{t('لا إصدار جاهز لهذا النموذج بعد — انتظر اكتمال المعالجة.', 'This model has no ready version yet — wait for processing to finish.')}</p></Panel>}
      {version && (
        <div className="editor-grid">
          <div className="editor-view">
            {src
              ? createElement('model-viewer', {
                ref: setViewer, src, orientation: viewerOrientation(turns), 'camera-controls': '', 'shadow-intensity': '1', 'interaction-prompt': 'none',
                'camera-orbit': '30deg 75deg auto', alt: productLabel(model, lang) ?? model.name, style: { width: '100%', height: '100%' },
              })
              : viewError ? <p className="hint" style={{ padding: 16, textAlign: 'center' }}>{viewError}</p> : <Loading rows={2} />}
          </div>

          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <Panel title={t('الاتجاه', 'Orientation')} sub={t('دوّره حتى يقف كما يقف المنتج على الطاولة، وتكون واجهته للأمام.', 'Turn it until it stands the way the product stands on a table, front facing you.')}>
              <div className="editor-turns">
                <span>{t('للأمام والخلف', 'Tip forward / back')}</span>{turnButton('x', '90°', t('حول المحور الأفقي', 'About the side-to-side axis'))}{turnButton('x', '90°', t('بالعكس', 'The other way'), true)}
                <span>{t('يمين ويسار', 'Spin left / right')}</span>{turnButton('y', '90°', t('حول المحور العمودي', 'About the up axis'))}{turnButton('y', '90°', t('بالعكس', 'The other way'), true)}
                <span>{t('إمالة جانبية', 'Roll sideways')}</span>{turnButton('z', '90°', t('حول المحور الأمامي', 'About the front-to-back axis'))}{turnButton('z', '90°', t('بالعكس', 'The other way'), true)}
              </div>
              {turned && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setTurns(NO_TURN)}>{t('ألغِ التدوير', 'Undo the turns')}</button>}
            </Panel>

            <Panel title={t('المقاس الحقيقي', 'Real size')} sub={t('بالمليمتر: عرض × ارتفاع × عمق', 'In millimetres: width × height × depth')}>
              <table className="qa-sizes">
                <tbody>
                  <tr><th scope="row">{t('النموذج الآن', 'Model now')}</th><td className="num" dir="ltr">{now ? `${mm(now[0])} × ${mm(now[1])} × ${mm(now[2])}` : '—'}</td></tr>
                  {turned && after && <tr><th scope="row">{t('بعد التدوير', 'After turning')}</th><td className="num" dir="ltr">{`${mm(after[0])} × ${mm(after[1])} × ${mm(after[2])}`}</td></tr>}
                  <tr><th scope="row">{t('مقاس المنتج', 'Product')}</th><td className="num" dir="ltr">{measured ? `${mm(dims!.widthMm)} × ${mm(dims!.heightMm)} × ${mm(dims!.depthMm)}` : t('لا مقاسات', 'No measurements')}</td></tr>
                </tbody>
              </table>
              <label className="toggle" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={fit} disabled={!canEdit || !measured} onChange={(e) => setFit(e.target.checked)} />
                <span><Maximize2 size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> {t('اجعله بمقاس المنتج', 'Make it the product’s size')}</span>
              </label>
              <p className="hint">{measured
                ? t('يُكبَّر أو يُصغَّر كله بالنسبة نفسها حتى يطابق أطول ضلع فيه أطول مقاس للمنتج — لا يُمَط.', 'Scaled evenly until its longest side matches the product’s longest measurement — never stretched.')
                : t('أضف عرض المنتج وارتفاعه في صفحة المنتج أولًا.', 'Add the product’s width and height on its page first.')}</p>
            </Panel>

            <Panel title={t('صورة النموذج', 'The model’s picture')} sub={t('تظهر في قائمة النماذج، وفي معاينة رابط صفحة المنتج.', 'Shown in the model list, and in the preview of the product page’s link.')}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="thumb" style={{ width: 72, height: 72, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--tint)', color: 'var(--text-3)' }}>
                  <ModelPicture modelId={model.id} stamp={model.thumbnailUrl} alt={t('صورة النموذج الحالية', 'The model’s current picture')} size={72} />
                </span>
                <div style={{ display: 'grid', gap: 6, flex: '1 1 200px' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => void choosePicture()} disabled={!canEdit || !src || picturing || turned}
                    title={turned ? t('احفظ التدوير أولًا', 'Save the turn first') : undefined}>
                    <Camera size={16} aria-hidden />{picturing ? t('جارٍ الحفظ…', 'Saving…') : t('استخدم هذا المنظر صورةً', 'Use this view as the picture')}
                  </button>
                  <span className="hint" style={{ margin: 0 }}>{turned
                    ? t('احفظ التدوير أولًا، ثم اختر المنظر.', 'Save the turn first, then choose the view.')
                    : t('أدِر النموذج وقرّبه في العارض حتى يبدو كما تريد، ثم اضغط.', 'Turn and zoom the model in the viewer until it looks right, then press.')}</span>
                </div>
              </div>
              {pictureNote && <p role="status" className={pictureNote.ok ? 'upload-note upload-done' : 'field-error'} style={{ margin: '10px 0 0' }}>{pictureNote.text}</p>}
            </Panel>

            {failure && <ErrorNote error={failure} />}
            {saved !== null && (
              <p role="status" className="upload-note upload-done" style={{ margin: 0 }}>
                {t(`حُفظ كإصدار ${saved}. يُجهَّز الآن، ثم انشره من صفحة النماذج`, `Saved as version ${saved}. It is being prepared; publish it from the models page`)}
                {model.source === 'ai_generated' ? t(' بعد مراجعة تجربة.', ' after Tajribah’s review.') : '.'}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={save} disabled={!canEdit || saving || (!turned && !fit)}>
                <Save size={16} aria-hidden />{saving ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ كإصدار جديد', 'Save as a new version')}
              </button>
              {model.source === 'ai_generated' && <Badge tone="warn">{t('يعود للمراجعة', 'Goes back to review')}</Badge>}
            </div>
            <p className="hint" style={{ margin: 0 }}>
              {t('التعديل يُحفظ في الملف نفسه، فيراه المتسوق كما هو في الآيفون والأندرويد والمتصفح. الإصدار الحالي لا يتغير حتى تنشر الجديد.',
                'The change is saved into the file itself, so shoppers see it the same on iPhone, Android and in the browser. The current version stays live until you publish the new one.')}
            </p>
            {!canEdit && <p className="hint" style={{ margin: 0 }}>{t('التعديل للمالك والمسؤول والمحرر.', 'Editing is for owners, admins and editors.')}</p>}
          </div>
        </div>
      )}
    </>
  );
}

/** T51: the product's name in the viewer's language. */
function productLabel(model: { productName: string | null; productNameAr: string | null }, lang: string): string | null {
  return lang === 'ar' ? model.productNameAr ?? model.productName : model.productName;
}
