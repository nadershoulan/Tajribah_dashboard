'use client';

// P3.7 — the product's photos for 3D generation: add one per angle, see each checked, remove.

import { CREDITS_PER_3D_GENERATION } from '@/lib/ai-credits';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Camera, ImageIcon, Lightbulb, Trash2, Wand2 } from 'lucide-react';
import { ANGLE_LABELS, ANGLE_SLOTS, PHOTO_ISSUES, type GenerationAngle, type PhotoIssueCode } from '@/lib/ai-jobs';
import { ApiError, currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useData, useResource } from '@/lib/data';
import { formatBytes, formatNumber } from '@/lib/format';
import { inArabic } from '@/lib/problem-text';
import { useLang } from '@/lib/i18n';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import type { GenerationPhotoView, ProductRow } from '@/lib/view-models';
import { Badge, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

const MAIN_ANGLES = ['front', 'side', 'back'] as const;
const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic';

type Bi = { ar: string; en: string };
const both = (text: string): Bi => ({ ar: text, en: text });

/** In the slot, the low-resolution note is short; the full sentence is in the status line. */
const SHORT_LOW_RES: Bi = { ar: 'أقل من 1500 بكسل — صورة أوضح تعطي تفاصيل أكثر.', en: 'Under 1500 px — a sharper photo gives more detail.' };

/** A refusal before the upload, in both languages. Unknown ones stay as written. */
function reasonOf(error: unknown): Bi {
  if (error instanceof ApiError && error.fields) {
    const texts = Object.values(error.fields).flat().map((m) =>
      (Object.entries(PHOTO_ISSUES) as [PhotoIssueCode, Bi][]).find(([, text]) => text.en === m)?.[1] ?? both(m));
    return { ar: texts.map((x) => x.ar).join(' · '), en: texts.map((x) => x.en).join(' · ') };
  }
  const message = (error as Error).message ?? '';
  const full = /already has (?:a|\d+) (front|side|back|detail) photo/.exec(message);
  if (full) {
    const angle = ANGLE_LABELS[full[1] as GenerationAngle];
    return { ar: `لهذا المنتج صورة «${angle.ar}» بالفعل — احذفها أولًا.`, en: `This product already has a ${angle.en.toLowerCase()} photo — remove it first.` };
  }
  const storage = /plan limit reached for storage_gb \((\d+)\)/.exec(message);
  if (storage) return { ar: `مساحة التخزين في باقتك ممتلئة (${storage[1]} GB).`, en: `Your plan’s storage is full (${storage[1]} GB).` };
  return { ar: inArabic(message), en: message };
}

export default function ProductPhotos({ product }: { product: ProductRow }) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const auth = useAuth();
  const role = currentStore(auth.me)?.role;
  const canEdit = !role || (ROLE_PERMISSIONS[role] as readonly string[]).includes('models:write');
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useResource((s) => s.productPhotos(product.id), [product.id, version]);
  const [busy, setBusy] = useState<GenerationAngle | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: Bi } | null>(null);
  /** Pictures picked in this visit, shown from the file itself: stored photos are private. */
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => () => { for (const url of Object.values(previews)) URL.revokeObjectURL(url); }, [previews]);

  const photos = data?.photos ?? [];
  const add = async (angle: GenerationAngle, file: File | undefined) => {
    if (!file || busy) return;
    setBusy(angle);
    setNote(null);
    const stale = photos.filter((p) => p.angle === angle && p.status === 'rejected');
    try {
      const photo = await source.uploadProductPhoto(product.id, angle, file);
      if (photo.status === 'accepted') setPreviews((all) => ({ ...all, [photo.id]: URL.createObjectURL(file) }));
      // A refusal is replaced by the next try, so the slot shows only the latest answer.
      for (const old of stale) await source.removeProductPhoto(product.id, old.id).catch(() => undefined);
      const name = ANGLE_LABELS[angle];
      const texts = photo.issues.map((i) => (i.code === 'low_resolution' ? SHORT_LOW_RES : i.message));
      const said = { ar: texts.map((x) => x.ar).join(' '), en: texts.map((x) => x.en).join(' ') };
      setNote(photo.status === 'accepted'
        ? { tone: 'ok', text: { ar: `قُبلت صورة «${name.ar}».${said.ar ? ` ${said.ar}` : ''}`, en: `${name.en} photo accepted.${said.en ? ` ${said.en}` : ''}` } }
        : { tone: 'bad', text: { ar: `رُفضت صورة «${name.ar}»: ${said.ar}`, en: `${name.en} photo refused: ${said.en}` } });
    } catch (failure) {
      const why = reasonOf(failure);
      setNote({ tone: 'bad', text: { ar: `تعذّر الرفع: ${why.ar}`, en: `Upload failed: ${why.en}` } });
    } finally {
      setBusy(null);
      setVersion((v) => v + 1);
    }
  };
  const remove = async (photo: GenerationPhotoView) => {
    setNote(null);
    try {
      await source.removeProductPhoto(product.id, photo.id);
    } catch (failure) {
      setNote({ tone: 'bad', text: both((failure as Error).message) });
    }
    setVersion((v) => v + 1);
  };

  /** What a slot shows: its accepted photo, else the latest refusal, else nothing yet. */
  const shown = (angle: GenerationAngle) => {
    const mine = photos.filter((p) => p.angle === angle && p.status !== 'uploading');
    return mine.find((p) => p.status === 'accepted') ?? mine.filter((p) => p.status === 'rejected').pop() ?? null;
  };
  const details = photos.filter((p) => p.angle === 'detail' && p.status === 'accepted');
  const detailRefused = photos.filter((p) => p.angle === 'detail' && p.status === 'rejected').pop() ?? null;

  const status = data?.ready
    ? <Badge tone="ok" dot>{t('جاهزة للتوليد', 'Ready to generate')}</Badge>
    : <Badge tone="warn">{t('تحتاج صورة أمامية', 'Needs a front photo')}</Badge>;

  return (
    <Panel
      title={t('نموذج ثلاثي الأبعاد من الصور', '3D model from photos')}
      sub={t('صورة لكل زاوية. نفحص كل صورة قبل أن يُصرف أي رصيد.', 'One photo per angle. Each is checked before any credits are spent.')}
      actions={data ? status : undefined}
    >
      {loading && !data && <Loading rows={3} />}
      {error && <ErrorNote error={error} />}
      {data && (
        <>
          <div className="photo-slots">
            {MAIN_ANGLES.map((angle) => (
              <Slot key={angle} angle={angle} photo={shown(angle)} preview={previews[shown(angle)?.id ?? '']}
                busy={busy === angle} disabled={!canEdit || (busy !== null && busy !== angle)} required={angle === 'front'}
                onPick={(file) => add(angle, file)} onRemove={remove} />
            ))}
            {details.map((photo) => (
              <Slot key={photo.id} angle="detail" photo={photo} preview={previews[photo.id]} busy={false}
                disabled={!canEdit || busy !== null} onPick={() => undefined} onRemove={remove} />
            ))}
            {details.length < ANGLE_SLOTS.detail && (
              <Slot angle="detail" photo={detailRefused} preview={undefined} busy={busy === 'detail'}
                disabled={!canEdit || (busy !== null && busy !== 'detail')}
                counter={`${formatNumber(details.length, lang)}/${formatNumber(ANGLE_SLOTS.detail, lang)}`}
                onPick={(file) => add('detail', file)} onRemove={remove} />
            )}
          </div>

          {note && <p role="status" className={`upload-note upload-${note.tone === 'ok' ? 'done' : 'failed'}`} style={{ margin: '14px 0 0' }}>{pick(note.text)}</p>}
          {!canEdit && <p className="hint">{t('إضافة الصور للمالك والمسؤول والمحرر.', 'Adding photos is for owners, admins and editors.')}</p>}

          <div className="photo-tips">
            <p><Lightbulb size={15} aria-hidden />{t('صور تعطي نموذجًا أفضل', 'Photos that make a better model')}</p>
            <ul>
              <li>{t('خلفية بسيطة بلون واحد، وإضاءة متساوية بلا ظلال قوية.', 'A plain, single-colour background and even light without harsh shadows.')}</li>
              <li>{t('المنتج كاملًا داخل الإطار، في المنتصف، ويملأ معظم الصورة.', 'The whole product in frame, centred, filling most of the picture.')}</li>
              <li>{t('الضلع الأقصر 768 بكسل على الأقل — و1500 أو أكثر أفضل.', 'At least 768 pixels on the short side — 1500 or more is better.')}</li>
              <li>{t('JPG أو PNG أو WebP، حتى 20 ميجابايت.', 'JPG, PNG or WebP, up to 20 MB.')}</li>
            </ul>
          </div>

          <div className="photo-foot">
            <button type="button" className="btn btn-primary" disabled aria-describedby="generate-why">
              <Wand2 size={16} aria-hidden />{t(`ولّد النموذج · ${CREDITS_PER_3D_GENERATION} أرصدة`, `Generate the model · ${CREDITS_PER_3D_GENERATION} credits`)}
            </button>
            <span id="generate-why" className="hint" style={{ margin: 0 }}>
              {data.ready
                ? t('الصور جاهزة. يُفتح التوليد عند ربط مزوّد النماذج ثلاثية الأبعاد، وتبقى صورك هنا حتى ذلك الحين.', 'Your photos are ready. Generation opens once the 3D provider is connected; your photos stay here until then.')
                : t('أضف صورة أمامية مقبولة على الأقل. الجانب والخلف يحسّنان النموذج.', 'Add at least an accepted front photo. Side and back make the model better.')}
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}

function Slot({ angle, photo, preview, busy, disabled, required, counter, onPick, onRemove }: {
  angle: GenerationAngle;
  photo: GenerationPhotoView | null;
  preview: string | undefined;
  busy: boolean;
  disabled: boolean;
  required?: boolean;
  counter?: string;
  onPick: (file: File | undefined) => void;
  onRemove: (photo: GenerationPhotoView) => void;
}) {
  const { t, pick, lang } = useLang();
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const label = pick(ANGLE_LABELS[angle]);
  const canPick = !disabled && !busy && photo?.status !== 'accepted';
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (canPick) onPick(event.dataTransfer.files[0]);
  };

  return (
    <div
      className={`photo-slot${photo?.status === 'accepted' ? ' is-accepted' : ''}${photo?.status === 'rejected' ? ' is-rejected' : ''}${over ? ' is-over' : ''}`}
      onDragOver={(e) => { if (canPick) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="photo-slot-head">
        <strong>{label}</strong>
        {required && !photo && <span className="photo-slot-tag">{t('مطلوبة', 'Required')}</span>}
        {counter && <span className="photo-slot-tag num">{counter}</span>}
        {photo?.status === 'accepted' && <Badge tone="ok">{t('مقبولة', 'Accepted')}</Badge>}
        {photo?.status === 'rejected' && <Badge tone="bad">{t('مرفوضة', 'Refused')}</Badge>}
      </div>

      <div className="photo-slot-picture" aria-hidden={!preview}>
        {preview
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the file just picked; nothing to optimise
          ? <img src={preview} alt={t(`صورة ${label}`, `${label} photo`)} />
          : photo?.status === 'accepted'
            ? <ImageIcon size={26} aria-hidden />
            : <Camera size={26} aria-hidden />}
        {busy && <span className="photo-slot-busy" role="status">{t('جارٍ الرفع والفحص…', 'Uploading and checking…')}</span>}
      </div>

      {photo?.status === 'accepted' && (
        <div className="photo-slot-facts">
          <span dir="ltr" className="num">{photo.width} × {photo.height}</span>
          {photo.sizeBytes ? <span dir="ltr" className="num">{formatBytes(photo.sizeBytes, lang)}</span> : null}
          {photo.score !== null && <span>{t('جودة الملف', 'File quality')} <b className="num">{formatNumber(photo.score, lang)}/100</b></span>}
          {photo.issues.filter((i) => !i.blocking).map((i) => <p key={i.code} className="photo-slot-note">{pick(i.code === 'low_resolution' ? SHORT_LOW_RES : i.message)}</p>)}
        </div>
      )}
      {photo?.status === 'rejected' && (
        <div className="photo-slot-facts">
          {photo.issues.map((i) => <p key={i.code} className="photo-slot-reason">{pick(i.message)}</p>)}
        </div>
      )}

      <div className="photo-slot-actions">
        <input ref={picker} type="file" accept={ACCEPT} hidden
          onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
        {photo?.status !== 'accepted' && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={!canPick} onClick={() => picker.current?.click()}>
            <Camera size={14} aria-hidden />{photo?.status === 'rejected' ? t('اختر صورة أخرى', 'Choose another') : t('أضف صورة', 'Add a photo')}
          </button>
        )}
        {photo && (
          <button type="button" className="btn btn-quiet btn-sm" disabled={disabled || busy} onClick={() => onRemove(photo)}
            aria-label={t(`احذف صورة ${label}`, `Remove the ${label.toLowerCase()} photo`)}>
            <Trash2 size={14} aria-hidden />{t('احذف', 'Remove')}
          </button>
        )}
      </div>
    </div>
  );
}
