'use client';

// P3.6 / A10 — Model review: look at every generated model, then approve it or say what is wrong

import { createElement, useEffect, useState } from 'react';
import { Box, Check, Eye, TriangleAlert, X } from 'lucide-react';
import { useAuth, type AdminQaQueue, type AdminQaRow, type AdminQaStatus } from '@/lib/auth';
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

export default function AdminQaPage() {
  const { t } = useLang();
  return <AdminShell title={t('مراجعة النماذج', 'Model review')}><Queue /></AdminShell>;
}

const VIEWER = '/vendor/model-viewer-4.0.0.min.js';
const DECODER = '/vendor/meshopt_decoder-1.2.0.js';

/** `<model-viewer>`, loaded once, on first use; told where the meshopt decoder is before it runs. */
let viewerReady: Promise<void> | null = null;
function loadViewer(): Promise<void> {
  viewerReady ??= new Promise<void>((resolve, reject) => {
    if (customElements.get('model-viewer')) { resolve(); return; }
    const scope = window as unknown as { ModelViewerElement?: { meshoptDecoderLocation?: string } };
    scope.ModelViewerElement ??= {};
    scope.ModelViewerElement.meshoptDecoderLocation ??= new URL(DECODER, location.href).href;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = VIEWER;
    script.onload = () => customElements.whenDefined('model-viewer').then(() => resolve());
    script.onerror = () => { viewerReady = null; reject(new Error('the 3D viewer did not load')); };
    document.head.appendChild(script);
  });
  return viewerReady;
}

function Queue() {
  const { t } = useLang();
  const auth = useAuth();
  const [status, setStatus] = useState<AdminQaStatus>('pending');
  const [data, setData] = useState<AdminQaQueue | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    auth.admin.qaQueue(status).then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, status, version]);

  const tabs: [AdminQaStatus, string][] = [
    ['pending', t('بانتظار المراجعة', 'Waiting')], ['rejected', t('أُعيدت للتعديل', 'Sent back')], ['approved', t('معتمدة', 'Approved')],
  ];
  return (
    <div className="qa">
      <p className="hint" style={{ margin: 0 }}>
        {t('كل نموذج مولَّد يُراجَع هنا قبل أن يستطيع التاجر نشره. النماذج التي يرفعها التاجر بنفسه لا تمر من هنا.',
          'Every generated model is reviewed here before the merchant can publish it. Models a merchant uploads themselves do not come here.')}
      </p>
      <div className="qa-tabs" role="tablist" aria-label={t('حالة المراجعة', 'Review status')}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={status === key} className={`btn btn-sm ${status === key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { if (key !== status) { setData(null); setStatus(key); } }}>
            {label}{data && <span className="num"> · {formatNumber(data.counts[key], 'en')}</span>}
          </button>
        ))}
      </div>
      {error && <ErrorNote error={error} />}
      {!data && !error && <Panel><Loading rows={4} /></Panel>}
      {data && data.rows.length === 0 && (
        <Panel><Empty icon={<Box size={22} />} title={status === 'pending' ? t('لا شيء بانتظار المراجعة', 'Nothing waiting for review') : t('لا نماذج هنا', 'No models here')}
          body={t('تظهر النماذج المولَّدة هنا حين تكتمل معالجتها.', 'Generated models appear here once processing has finished.')} /></Panel>
      )}
      {data?.rows.map((row) => <Review key={`${row.modelId}:${row.version.id}`} row={row} onDecided={() => setVersion((v) => v + 1)} />)}
    </div>
  );
}

/** Each measurement the merchant gave, and the model's side it matches (largest to largest). */
function sizes(row: AdminQaRow): { label: string; product: number | null; model: number | null }[] {
  const given = row.product?.sizeMm ?? {};
  const model = [...(row.version.sizeMm ?? [])].sort((a, b) => b - a);
  const named = [['width', given.widthMm], ['height', given.heightMm], ['depth', given.depthMm]] as const;
  const known = named.filter(([, v]) => typeof v === 'number' && v > 0).sort((a, b) => (b[1] as number) - (a[1] as number));
  return known.map(([label, mm], i) => ({ label, product: mm as number, model: model[i] ?? null }));
}

/** Post-processing's notes are written in English for the record; staff read them in their language. */
function sayNote(note: string, lang: string): string {
  if (lang !== 'ar') return note;
  const shape = /^check the shape: sized to (.+) mm, which does not agree/.exec(note);
  if (shape) return `تحقق من الشكل: صار مقاسه ${shape[1]} مم، ولا يتفق مع مقاسات المنتج.`;
  if (note.startsWith('not sized: the product has no measurements')) return 'بلا مقاس: لا مقاسات للمنتج، فالنموذج ليس بحجمه الحقيقي.';
  if (note.startsWith('not sized: the model has no geometry')) return 'بلا مقاس: لا شكل في النموذج يمكن قياسه.';
  return note;
}

const off = (c: { product: number | null; model: number | null }) => c.model !== null && c.product !== null && Math.abs(c.model - c.product) / c.product > 0.15;

function Review({ row, onDecided }: { row: AdminQaRow; onDecided: () => void }) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [showing, setShowing] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  const show = async () => {
    setShowing(true);
    setViewError(null);
    try {
      const [blob] = await Promise.all([auth.admin.qaModel(row.version.id), loadViewer()]);
      setSrc(URL.createObjectURL(blob));
    } catch (e) {
      setViewError((e as Error).message);
    }
  };
  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    setProblem(null);
    try {
      await auth.admin.decideQa(row.modelId, { decision, versionId: row.version.id, ...(decision === 'rejected' ? { notes: notes.trim() } : {}) });
      onDecided();
    } catch (e) {
      setProblem((e as Error).message);
      setBusy(false);
    }
  };

  const store = lang === 'ar' ? row.store.nameAr ?? row.store.name : row.store.name;
  const product = row.product ? (lang === 'ar' ? row.product.nameAr ?? row.product.name : row.product.name) : t('بلا منتج', 'No product');
  const checks = sizes(row);
  const differs = checks.some(off);

  return (
    <Panel
      title={`${product} · v${row.version.number}`}
      sub={`${store} · ${t('جاهز', 'ready')} ${formatDateTime(row.version.readyAt, lang)}`}
      actions={row.qaStatus === 'approved' ? <Badge tone="ok">{t('معتمد', 'Approved')}</Badge>
        : row.qaStatus === 'rejected' ? <Badge tone="bad">{t('أُعيد للتعديل', 'Sent back')}</Badge>
          : <Badge tone="warn">{t('بانتظار المراجعة', 'Waiting')}</Badge>}
    >
      <div className="qa-body">
        <div className="qa-viewer">
          {showing && src
            ? createElement('model-viewer', { src, 'camera-controls': '', 'auto-rotate': '', 'shadow-intensity': '1', 'interaction-prompt': 'none', alt: product, style: { width: '100%', height: '100%' } })
            : (
              <button type="button" className="btn btn-ghost" onClick={show} disabled={showing && !viewError}>
                <Eye size={16} aria-hidden />{showing && !viewError ? t('جارٍ التحميل…', 'Loading…') : t('اعرض النموذج', 'Show the model')}
              </button>
            )}
          {viewError && <p className="field-error" style={{ margin: '8px 0 0' }}>{viewError}</p>}
        </div>

        <div className="qa-facts">
          <table className="qa-sizes">
            <thead><tr><th scope="col" /><th scope="col">{t('مقاس المنتج', 'Product')}</th><th scope="col">{t('النموذج', 'Model')}</th></tr></thead>
            <tbody>
              {checks.length === 0 && <tr><td colSpan={3} className="hint">{t('لم يُدخل التاجر مقاسات للمنتج.', 'The merchant gave no measurements.')}</td></tr>}
              {checks.map((c) => (
                <tr key={c.label} className={off(c) ? 'is-off' : undefined}>
                  <th scope="row">{c.label === 'width' ? t('العرض', 'Width') : c.label === 'height' ? t('الارتفاع', 'Height') : t('العمق', 'Depth')}</th>
                  <td className="num"><span dir="ltr">{c.product}</span> {t('مم', 'mm')}</td>
                  <td className="num"><span dir="ltr">{c.model ?? '—'}</span> {t('مم', 'mm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="qa-line">
            <span>{t('المضلعات', 'Triangles')} <b className="num">{row.version.polyCount != null ? formatNumber(row.version.polyCount, lang) : '—'}</b></span>
            <span>{t('حجم الملف', 'File')} <b className="num" dir="ltr">{row.version.webBytes != null ? formatBytes(row.version.webBytes, lang) : '—'}</b></span>
          </p>
          {(row.qaNotes || differs) && (
            <p className="qa-flag"><TriangleAlert size={15} aria-hidden /><span dir="auto">{row.qaNotes ? sayNote(row.qaNotes, lang) : t('المقاسات لا تتفق مع شكل النموذج.', 'The measurements do not agree with the model’s shape.')}</span></p>
          )}

          {row.qaStatus !== 'approved' && (
            <div className="qa-decide">
              {!rejecting ? (
                <>
                  <button type="button" className="btn btn-accent btn-sm" onClick={() => decide('approved')} disabled={busy}><Check size={15} aria-hidden />{t('اعتمد', 'Approve')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting(true)} disabled={busy}><X size={15} aria-hidden />{t('أعِده للتعديل', 'Send back')}</button>
                </>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (notes.trim().length >= 5) void decide('rejected'); }} style={{ display: 'grid', gap: 8, width: '100%' }}>
                  <label htmlFor={`notes-${row.modelId}`} style={{ fontSize: 13, fontWeight: 600 }}>{t('ما الذي يجب تعديله؟ يقرأ التاجر هذه الملاحظة.', 'What needs to change? The merchant reads this.')}</label>
                  <textarea id={`notes-${row.modelId}`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} dir="auto" autoFocus />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy || notes.trim().length < 5}>{t('أرسل', 'Send back')}</button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setRejecting(false); setNotes(''); }}>{t('إلغاء', 'Cancel')}</button>
                  </div>
                </form>
              )}
            </div>
          )}
          {problem && <p className="field-error" style={{ margin: 0 }}>{problem}</p>}
        </div>
      </div>
    </Panel>
  );
}
