'use client';

/**
 * The phone side of the QR hand-off (T134.3): the phone is the try-on — `CameraTryOn`, full screen and the store's —
 * and «أرسل إلى شاشتي» sends the photo, with where the shopper left the product (T134.7), to the computer that showed
 * the code. An expired or unknown session: a short note to scan a new code.
 */
import { useLang } from '@site/lib/i18n';
import type { Pairing } from '@site/lib/pair-product';
import { POSE_HEADER, poseHeader } from '@site/lib/pair-pose';
import CameraTryOn, { type Shot } from '@site/components/tryon/CameraTryOn';
import { TelemetryContext } from '@site/components/tryon/telemetry';
import { EVENTS_ENDPOINT } from '@site/lib/page-events';
import { isLocalHost } from '@site/lib/tryon-config';

export default function Capture({ token, pairing }: { token: string; pairing: Pairing | null }) {
  const { t, lang } = useLang();

  if (!pairing) {
    return (
      <main className="cap cap-ended" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="cap-ended-card">
          <h1>{t('انتهت هذه الجلسة', 'This session has ended')}</h1>
          <p>{t('عُد إلى الشاشة الأخرى وامسح رمزًا جديدًا.', 'Go back to your other screen and scan a new code.')}</p>
        </div>
      </main>
    );
  }

  async function send(shot: Shot) {
    const fitted: Record<string, string> = pairing!.product && shot.pose ? { [POSE_HEADER]: poseHeader(shot.pose, shot.size) } : {};
    const r = await fetch(`/api/pair/${token}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...fitted }, body: shot.blob });
    if (!r.ok) throw Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? '');
  }

  // T140.5: the anonymous counts go to the store and product the code was made for (on this computer, its own collector)
  const telemetry = pairing.track ? { ...pairing.track, endpoint: typeof location !== 'undefined' && isLocalHost(location.hostname) ? `${location.origin}/v1/e` : EVENTS_ENDPOINT } : null;
  return (
    <TelemetryContext.Provider value={telemetry}>
      <CameraTryOn product={pairing.product} brand={pairing.brand} kind={pairing.kind} onSend={send} shareLink={pairing.link ?? null} />
    </TelemetryContext.Provider>
  );
}
