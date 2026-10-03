'use client';

/**
 * P3.10 — on a product's page: ask Tajribah's team to make its 3D model (the website's "Professional
 * 3D modelling — priced per product"), see the quote with its VAT, cancel before work starts. Paying
 * opens with card payments (the billing screen's pay step is closed the same way).
 */
import { useState } from 'react';
import { CreditCard, PenTool } from 'lucide-react';
import { useWriteLock } from '@/components/dashboard/write-lock';
import { ApiError } from '@/lib/api-client';
import { AppLink } from '@/lib/app-env';
import { INCLUDED_REVISIONS, OPEN_STATUSES, PRICE_TIERS, STATUS_LABEL, type ProfessionalOrderView } from '@/lib/contracts/professional';
import { useData, useResource } from '@/lib/data';
import { formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import type { ProductRow } from '@/lib/view-models';
import { Badge, ErrorNote, Panel } from '@/components/dashboard/ui';

const MESSAGE_AR: [RegExp, string][] = [
  [/only a quote not yet accepted/, 'قُبل هذا العرض بالفعل.'],
  [/already has an open request/, 'لهذا المنتج طلب مفتوح بالفعل.'],
  [/can no longer be cancelled/, 'لا يمكن إلغاء الطلب بعد بدء العمل.'],
  [/at most 1000/, '1000 حرف على الأكثر'],
  [/missing permission/, 'دورك لا يسمح بطلب نموذج'],
];

export default function ProfessionalPanel({ product }: { product: ProductRow }) {
  const { t, lang, pick } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const [version, setVersion] = useState(0);
  const { data, error } = useResource((s) => s.professionalOrders(), [version]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'ask' | 'cancel' | 'accept' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const say = (m: string) => (lang === 'ar' ? MESSAGE_AR.find(([p]) => p.test(m))?.[1] ?? m : m);

  const mine = (data ?? []).filter((o) => o.productId === product.id);
  const open = mine.find((o) => OPEN_STATUSES.includes(o.status)) ?? null;
  const shown: ProfessionalOrderView | null = open ?? mine.find((o) => o.status === 'delivered') ?? null;

  const act = async (kind: 'ask' | 'cancel' | 'accept', run: () => Promise<unknown>) => {
    setBusy(kind);
    setProblem(null);
    try { await run(); setNote(''); setVersion((v) => v + 1); } catch (e) {
      setProblem(say((e as ApiError).fields?.note?.[0] ?? (e as Error).message));
    } finally { setBusy(null); }
  };
  const money = (minor: number) => formatMoney(minor, 'SAR', lang === 'ar' ? 'ar' : 'en');

  return (
    <Panel title={t('نموذج احترافي من فريق تجربة', 'A professional model from Tajribah')}
      sub={t('حين لا تكفي الصور: نصنع نموذجًا دقيقًا لهذا المنتج', 'When photos are not enough: we build an accurate model of this product')}
      actions={shown ? <Badge tone={shown.status === 'quoted' ? 'accent' : shown.status === 'delivered' ? 'ok' : undefined}>{pick(STATUS_LABEL[shown.status])}</Badge> : undefined}>
      {error && <ErrorNote error={error} />}
      {!shown && (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-2)' }}>{t(
            'يطّلع فريقنا على المنتج وصوره ومقاساته، ثم يرسل لك هنا سعرًا لهذا المنتج قبل أي عمل. يمكنك الإلغاء في أي وقت قبل بدء العمل.',
            'Our team looks at the product, its photos and its measurements, then sends you a price for it here before any work starts. You can cancel any time before work starts.',
          )}</p>
          <table className="qa-sizes" style={{ marginBottom: 8 }}>
            <tbody>
              {PRICE_TIERS.map((tier) => (
                <tr key={tier.key}><th scope="row">{pick(tier.label)}<span className="hint" style={{ display: 'block', margin: 0, fontWeight: 400 }}>{pick(tier.examples)}</span></th>
                  <td className="num">{money(tier.priceMinor)}<span className="hint" style={{ display: 'block', margin: 0 }}>{t(`${tier.days} أيام عمل`, `${tier.days} working days`)}</span></td></tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 0 }}>{t(`أسعار تقريبية قبل الضريبة، تشمل ${INCLUDED_REVISIONS} جولتي تعديل. السعر النهائي يصلك في عرض السعر.`, `Typical prices before VAT, with ${INCLUDED_REVISIONS} rounds of changes included. Your quote gives the final price.`)}</p>
          <div className="field">
            <label htmlFor={`pro-note-${product.id}`}>{t('ما الذي يجب أن ننتبه له؟ (اختياري)', 'Anything we should watch for? (optional)')}</label>
            <textarea id={`pro-note-${product.id}`} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t('مثل: سطح لامع، مفصل يتحرك، لون دقيق', 'Like: a reflective surface, a moving hinge, an exact colour')} />
          </div>
          <button type="button" className="btn btn-primary" disabled={busy !== null || lock.locked} title={lock.title}
            onClick={() => void act('ask', () => source.requestProfessional(product.id, note.trim() || null))}>
            <PenTool size={16} aria-hidden />{busy === 'ask' ? t('جارٍ الإرسال…', 'Sending…') : t('اطلب عرض سعر', 'Ask for a quote')}
          </button>
        </>
      )}
      {shown?.status === 'requested' && (
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-2)' }}>{t(
          `وصل طلبك ${formatDateTime(shown.createdAt, 'ar')}. نرسل لك السعر هنا، وتصلك تنبيهة حين يصل.`,
          `Your request arrived ${formatDateTime(shown.createdAt, 'en')}. We send the price here, and you are notified when it arrives.`,
        )}</p>
      )}
      {shown?.note && <p className="hint" style={{ marginTop: 0 }}>{t('ملاحظتك: ', 'Your note: ')}{shown.note}</p>}
      {shown?.quote && shown.status === 'quoted' && (
        <>
          <table className="qa-sizes" style={{ marginBottom: 10 }}>
            <tbody>
              <tr><th scope="row">{t('السعر', 'Price')}</th><td className="num">{money(shown.quote.priceMinor)}</td></tr>
              <tr><th scope="row">{t('ضريبة القيمة المضافة 15%', 'VAT 15%')}</th><td className="num">{money(shown.quote.vatMinor)}</td></tr>
              <tr><th scope="row"><strong>{t('الإجمالي', 'Total')}</strong></th><td className="num"><strong>{money(shown.quote.totalMinor)}</strong></td></tr>
            </tbody>
          </table>
          {shown.quote.note && <p style={{ margin: '0 0 12px', fontSize: 14 }}>{t('من فريق تجربة: ', 'From Tajribah: ')}{shown.quote.note}</p>}
          {!shown.acceptedAt ? (
            <>
              <button type="button" className="btn btn-primary" disabled={busy !== null || lock.locked} title={lock.title}
                onClick={() => void act('accept', () => source.acceptProfessional(shown.id))}>
                <CreditCard size={16} aria-hidden />{busy === 'accept' ? t('جارٍ القبول…', 'Accepting…') : t('اقبل العرض', 'Accept the quote')}
              </button>
              <p className="hint">{t('بعد القبول نرسل لك بيانات التحويل البنكي وفاتورة بالبريد. يبدأ العمل حين يصلنا التحويل، ويمكنك الإلغاء قبل ذلك.', 'Once you accept, we email you the bank transfer details and an invoice. Work starts when the transfer arrives; you can cancel before then.')}</p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 14 }}>{t(`قبلت العرض ${formatDateTime(shown.acceptedAt, 'ar')}. أرسلنا بيانات التحويل إلى بريدك؛ يبدأ العمل حين يصلنا التحويل.`, `You accepted ${formatDateTime(shown.acceptedAt, 'en')}. We have emailed the transfer details; work starts when the transfer arrives.`)}</p>
          )}
        </>
      )}
      {shown?.status === 'accepted' && <p style={{ margin: 0, fontSize: 14 }}>{t('وصل التحويل ويعمل فريقنا على النموذج؛ يصلك تنبيه حين يكتمل.', 'The transfer arrived and our team is working on the model; you are notified when it is done.')}</p>}
      {shown?.status === 'delivered' && (
        <p style={{ margin: 0, fontSize: 14 }}>{t('نموذجك جاهز. راجعه وانشره من ', 'Your model is ready. Review it and publish it from ')}<AppLink href="/dashboard/models">{t('النماذج ثلاثية الأبعاد', '3D models')}</AppLink>.</p>
      )}
      {(shown?.status === 'requested' || shown?.status === 'quoted') && (
        <button type="button" className="btn btn-quiet btn-sm" style={{ marginTop: 8 }} disabled={busy !== null || lock.locked} title={lock.title}
          onClick={() => void act('cancel', () => source.cancelProfessional(shown.id))}>
          {busy === 'cancel' ? t('جارٍ الإلغاء…', 'Cancelling…') : t('ألغِ الطلب', 'Cancel the request')}
        </button>
      )}
      {problem && <p className="field-error" role="alert" style={{ marginTop: 10 }}>{problem}</p>}
    </Panel>
  );
}
