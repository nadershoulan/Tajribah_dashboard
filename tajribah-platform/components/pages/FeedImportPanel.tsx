'use client';

// MD-030 (part) — Store connections: products without linking the store, from a link or a file

import { STORE_LINKING } from '@/lib/features';
import { useState, type FormEvent } from 'react';
import { AlertTriangle, Link2, RefreshCw } from 'lucide-react';
import { useWriteLock } from '@/components/dashboard/write-lock';
import { useData } from '@/lib/data';
import { formatNumber } from '@/lib/format';
import { inArabic } from '@/lib/problem-text';
import { useLang } from '@/lib/i18n';
import type { FeedImport } from '@/lib/view-models';
import { Panel } from '@/components/dashboard/ui';

/** Server refusals for a feed or a file are English; these are the ones a merchant meets, in Arabic. */
export const FEED_AR: [RegExp, string][] = [
  [/private network/, 'هذا الرابط يشير إلى شبكة خاصة، ولن نفتحه.'],
  [/https/, 'الرابط يبدأ بـ https://'],
  [/answered \d+/, 'أجاب الرابط بخطأ — تأكد أنه رابط الملف نفسه، وأنه يفتح في المتصفح.'],
  [/did not answer|look up|does not exist/, 'لم نتمكن من الوصول إلى الرابط. تأكد منه وحاول مرة أخرى.'],
  [/no products found/, 'لم نجد منتجات. الملف يكون بصيغة Google Merchant، أو جدولًا أسماء أعمدته في الصف الأول، مثل id و title و price.'],
  [/none of its/, 'لا يحتوي أي صف على رقم منتج (id) واسم (title) معًا.'],
  [/larger than 30 MB/, 'الملف أكبر من 30 ميغابايت.'],
  [/not an Excel file|damaged|compression|no sheet/, 'تعذّرت قراءة ملف Excel. احفظه بصيغة ‎.xlsx أو CSV ثم ارفعه.'],
  [/still being imported/, 'الملف السابق ما زال قيد الاستيراد. حاول بعد دقيقة.'],
  [/preview/, 'هذه معاينة دون خادم، فلا يُقرأ رابط ولا ملف — اللوحة الحقيقية تقرؤه.'],
];
const SKIP_AR: Record<string, string> = { 'no id': 'بلا رقم منتج (id)', 'no title': 'بلا اسم (title)' };
/** The columns a hand-made sheet needs, as Google Merchant names them. */
export const TEMPLATE_COLUMNS = ['id', 'title', 'description', 'link', 'image_link', 'additional_image_link', 'price', 'item_group_id', 'product_width', 'product_height', 'product_length'];

/**
 * Without linking the store (like Google Merchant Center): a feed's link, read now and every 24 hours,
 * or a file uploaded by hand (CSV, TSV, XLSX, Merchant XML), read once.
 */
export default function FeedImportPanel({ onImported }: { onImported: () => void }) {
  const { t, lang } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const [mode, setMode] = useState<'link' | 'file'>('link');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<FeedImport | null>(null);
  const n = (value: number) => formatNumber(value, lang);
  const say = (message: string) => (lang === 'ar' ? FEED_AR.find(([p]) => p.test(message))?.[1] ?? inArabic(message) : message);

  const run = async (work: () => Promise<FeedImport>) => {
    setBusy(true); setProblem(null); setDone(null);
    try {
      setDone(await work());
      onImported();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string[]> }).fields;
      setProblem(say(fields?.url?.[0] ?? fields?.file?.[0] ?? (err as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const submitLink = (e: FormEvent) => { e.preventDefault(); void run(() => source.connectFeed(url.trim())); };
  const takeFile = (file: File | undefined) => { if (file) void run(() => source.importProductFile(file)); };
  const template = () => {
    const href = URL.createObjectURL(new Blob([`﻿${TEMPLATE_COLUMNS.join(',')}\n`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = href; a.download = 'tajribah-products-template.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const option = (key: 'link' | 'file', title: string, body: string, auto: boolean) => (
    <button type="button" className="plan-tab" aria-pressed={mode === key} onClick={() => { setMode(key); setProblem(null); }}
      style={{ borderColor: mode === key ? 'var(--aqua)' : undefined, boxShadow: mode === key ? 'inset 0 0 0 1px var(--aqua)' : undefined }}>
      <strong style={{ fontSize: 15 }}>{title}</strong>
      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{body}</span>
      <span style={{ fontSize: 12.5, marginTop: 6, color: auto ? 'var(--ok)' : 'var(--text-3)', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
        <RefreshCw size={13} aria-hidden />{auto ? t('تحديث تلقائي كل 24 ساعة', 'Updates automatically every 24 hours') : t('لا تحديث تلقائي', 'No automatic updates')}
      </span>
    </button>
  );

  return (
    <Panel title={t('بدون ربط المتجر: من رابط أو ملف', 'Without linking your store: from a link or a file')}
      sub={STORE_LINKING ? t('إن لم ترغب في ربط متجرك — كما في Google Merchant Center', 'If you would rather not link your store — as in Google Merchant Center') : t('كما في Google Merchant Center: رابط منتجات متجرك أو ملف', 'As in Google Merchant Center: your store’s product feed link, or a file')}>
      <div className="grid grid-2" style={{ gap: 12, marginBottom: 16 }}>
        {option('link', t('رابط ملف المنتجات', 'A link to your product file'), t('رابط Google Merchant الذي تولّده منصة متجرك. يُضبط مرة واحدة.', 'The Google Merchant link your store’s platform makes. Set once.'), true)}
        {option('file', t('ارفع ملفًا من جهازك', 'Upload a file from your computer'), t('جدول CSV أو Excel، أو ملف XML بصيغة Google Merchant.', 'A CSV or Excel sheet, or a Google Merchant XML file.'), false)}
      </div>

      {mode === 'link' ? (
        <form onSubmit={submitLink} style={{ display: 'grid', gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="feed-url">{t('رابط ملف المنتجات', 'Link to your product file')}</label>
            <input id="feed-url" value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" inputMode="url" maxLength={4096}
              placeholder="https://yourstore.com/feeds/google-merchant/…" aria-invalid={!!problem} aria-describedby={problem ? 'feed-problem' : 'feed-hint'} />
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy || lock.locked || !url.trim()} title={lock.title}>
              <Link2 size={16} aria-hidden />{busy ? t('نقرأ الرابط…', 'Reading the link…') : t('استورد المنتجات', 'Import the products')}
            </button>
          </div>
          <p id="feed-hint" className="hint" style={{ margin: 0 }}>
            {t('في سلة: ثبّت من متجر تطبيقات سلة تطبيقًا يولّد رابط Google Merchant، ثم انسخ «رابط الخدمة» والصقه هنا. يصلح أي رابط بصيغة Google Merchant (XML) أو جدول CSV/TSV. نقرؤه الآن، ثم تلقائيًا كل 24 ساعة.',
              'On Salla: install an app from the Salla App Store that makes a Google Merchant link, copy its “service link” and paste it here. Any Google Merchant (XML) link or CSV/TSV sheet works. We read it now, then automatically every 24 hours.')}
          </p>
        </form>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <label className={`drop-zone${over ? ' is-over' : ''}`} htmlFor="feed-file"
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!lock.locked && !busy) takeFile(e.dataTransfer.files[0]); }}
            style={{ display: 'block', padding: '28px 16px', textAlign: 'center', border: '1px dashed var(--line-2)', borderRadius: 12, cursor: lock.locked ? 'not-allowed' : 'pointer' }}>
            {busy ? t('نستورد منتجاتك…', 'Importing your products…') : <>{t('اسحب الملف هنا أو ', 'Drag the file here or ')}<span style={{ color: 'var(--aqua-ink)', fontWeight: 600 }}>{t('تصفّح', 'Browse')}</span></>}
            <input id="feed-file" type="file" className="sr-only"
              accept=".csv,.tsv,.txt,.xlsx,.xml,text/csv,text/tab-separated-values,application/xml,text/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy || lock.locked} onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ''; }} aria-describedby="feed-formats" />
          </label>
          <p id="feed-formats" className="hint" style={{ margin: 0 }}>
            {t('الصيغ المقبولة: ملف CSV أو TSV أو Excel أو XML بصيغة Google Merchant، حتى 30 ميغابايت. أسماء الأعمدة في الصف الأول، مثل id و title و price و image_link.',
              'Formats: CSV, TSV, Excel (.xlsx), Google Merchant XML — up to 30 MB. The first row names the columns: id, title, price, image_link…')}{' '}
            <button type="button" onClick={template}
              style={{ color: 'var(--aqua-ink)', textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
              {t('نزّل قالبًا', 'Download a template')}
            </button>
          </p>
          <p className="upload-note" style={{ margin: 0, display: 'flex', gap: 8 }}>
            <AlertTriangle size={15} aria-hidden style={{ flex: '0 0 auto', marginTop: 3 }} />
            {t('إن غيّرت الملف على جهازك، فارفعه مرة أخرى لتحديث منتجاتك هنا.', 'If you change the file on your computer, upload it again to update your products here.')}
          </p>
        </div>
      )}

      {problem && <p id="feed-problem" className="field-error" role="alert" style={{ margin: '10px 0 0' }}>{problem}</p>}
      {done && (
        <div role="status" className="upload-note upload-done" style={{ margin: '12px 0 0' }}>
          {t(`الصفوف المقروءة: ${n(done.rows)} · المنتجات: ${n(done.products)}.`, `Rows read: ${n(done.rows)} · products: ${n(done.products)}.`)}{' '}
          {done.sync.status === 'done'
            ? t('أُضيفت إلى منتجاتك.', 'They are in your products.')
            : t('تجري المزامنة الآن، وتظهر منتجاتك تباعًا.', 'The sync is running; your products appear as it goes.')}
          {done.skipped.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingInlineStart: 18, fontSize: 13 }}>
              {done.skipped.slice(0, 5).map((s) => <li key={s.row}>{t(`الصف ${s.row}: ${SKIP_AR[s.reason] ?? s.reason}`, `Row ${s.row}: ${s.reason}`)}</li>)}
              {done.skipped.length > 5 && <li>{t(`صفوف أخرى لم تُقرأ: ${n(done.skipped.length - 5)}`, `${n(done.skipped.length - 5)} more rows skipped`)}</li>}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
