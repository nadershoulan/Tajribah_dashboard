'use client';

/**
 * P0.16 — the dashboard UI kit.
 *
 * Small, boring pieces shared by every screen. Two rules run through all of them:
 *  - **Every state is designed**: loading, empty and error are components here, not
 *    afterthoughts on each page.
 *  - **Nothing invents a number.** A metric with no data renders `—` with a reason, never
 *    a plausible-looking zero or a placeholder percentage.
 */
import type { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Inbox } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { isUnreachable } from '@/lib/api-client';
import { formatNumber, formatPercent } from '@/lib/format';
import type { Bi } from '@/lib/lang';

/** An arrow that points the way "forward" reads in the current direction. */
export function Forward({ size = 16 }: { size?: number }) {
  const { dir } = useLang();
  const Icon = dir === 'rtl' ? ArrowLeft : ArrowRight;
  return <Icon size={size} aria-hidden />;
}

export function PageHead({ title, lead, actions, eyebrow }: {
  title: string; lead?: string; actions?: ReactNode; eyebrow?: string;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, sub, actions, children, foot, flush }: {
  title?: string; sub?: string; actions?: ReactNode; children: ReactNode; foot?: ReactNode; flush?: boolean;
}) {
  return (
    <section className="panel">
      {title && (
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {flush ? children : <div className="panel-body">{children}</div>}
      {foot && <div className="panel-foot">{foot}</div>}
    </section>
  );
}

export function Stat({ label, value, sub, delta, hint }: {
  label: string;
  /** Already formatted, or null when there is genuinely nothing to show. */
  value: string | null;
  sub?: string;
  delta?: number | null;
  hint?: string;
}) {
  const { lang, t } = useLang();
  const direction = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return (
    <div className="panel stat">
      <p className="stat-label">{label}{hint && <span title={hint}><AlertCircle size={13} /></span>}</p>
      <div className="stat-value">{value ?? '—'}</div>
      {delta != null && (
        <div className={`delta ${direction}`}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '—'} {formatPercent(Math.abs(delta), lang)}
        </div>
      )}
      {/* A missing number always says why; real stores see this until P4 has data. */}
      {value === null && <div className="stat-sub">{t('لا توجد بيانات كافية بعد', 'Not enough data yet')}</div>}
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const { lang, t } = useLang();
  const unlimited = limit < 0;
  const ratio = unlimited ? 0 : Math.min(1, used / Math.max(1, limit));
  const tone = ratio > 0.9 ? 'bad' : ratio > 0.75 ? 'warn' : '';
  return (
    <div className="usage-row">
      <div className="usage-top">
        <span>{label}</span>
        <span className="num">
          {unlimited
            ? t('بلا حد', 'Unlimited')
            : `${formatNumber(used, lang)} / ${formatNumber(limit, lang)}`}
        </span>
      </div>
      <div className={`meter ${tone}`}><i style={{ width: `${unlimited ? 4 : ratio * 100}%` }} /></div>
    </div>
  );
}

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';

export function Badge({ tone = 'neutral', children, dot }: { tone?: BadgeTone; children: ReactNode; dot?: boolean }) {
  const cls = tone === 'neutral' ? 'badge' : `badge badge-${tone}`;
  return <span className={cls}>{dot && <i className="badge-dot" aria-hidden />}{children}</span>;
}

export function Empty({ title, body, action, icon, heading = 'h3' }: {
  title: string; body: string; action?: ReactNode; icon?: ReactNode;
  /** T52: a page made of nothing but this (not found) needs its title as the page's h1. */
  heading?: 'h1' | 'h3';
}) {
  const Heading = heading;
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <Inbox size={22} aria-hidden />}</div>
      <Heading>{title}</Heading>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  const { t } = useLang();
  return (
    <div className="panel-body" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('جارٍ التحميل', 'Loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton skeleton-row" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorNote({ error }: { error: Error }) {
  const { t } = useLang();
  return (
    <div className="empty">
      <div className="empty-icon" style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>
        <AlertCircle size={22} aria-hidden />
      </div>
      <h3>{t('تعذّر تحميل هذه البيانات', 'That did not load')}</h3>
      <p>{isUnreachable(error) ? t('تعذّر الوصول إلى تجربة — تأكد من اتصالك ثم حاول مرة أخرى.', 'Tajribah could not be reached — check your connection and try again.') : error.message}</p>
    </div>
  );
}

/** Two stacked bars per day: everything, and the AR share of it. */
export function MiniChart({ points, labels }: {
  points: { day: string; views: number; arSessions: number }[];
  labels: { views: string; ar: string };
}) {
  const peak = Math.max(1, ...points.map((p) => p.views));
  return (
    <>
      <div className="chart" role="img" aria-label={`${labels.views} / ${labels.ar}`}>
        {points.map((point) => (
          <div className="col" key={point.day} title={`${point.day}`}>
            <i style={{ height: `${((point.views - point.arSessions) / peak) * 100}%` }} />
            <i className="ar" style={{ height: `${(point.arSessions / peak) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="chart-legend">
        <span><i style={{ background: 'var(--aqua-100)' }} />{labels.views}</span>
        <span><i style={{ background: 'var(--aqua)' }} />{labels.ar}</span>
      </div>
    </>
  );
}

export function Funnel({ steps }: { steps: { step: Bi; value: number }[] }) {
  const { lang, pick } = useLang();
  const top = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="funnel">
      {steps.map((step) => (
        <div className="funnel-row" key={step.step.en}>
          <span>{pick(step.step)}</span>
          <div className="funnel-bar"><i style={{ width: `${(step.value / top) * 100}%` }} /></div>
          <span className="num">{formatNumber(step.value, lang)}</span>
        </div>
      ))}
    </div>
  );
}

export function Check3({ done }: { done: boolean }) {
  return <span className="mark">{done ? <Check size={13} aria-hidden /> : ''}</span>;
}
