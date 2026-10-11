/**
 * T137 — Tajribah's mark in one colour (Nader: the «بدعم من تجربة» watermark as just an icon, black or gray only): the
 * same drawing as the brand mark (`public/brand/tajribah-mark.png`) — four corner brackets round a cube — in tones of
 * `currentColor` (the cube's top lighter, as the brand mark's), so it reads at 16 px and takes the colour it sits in.
 */
export function MonoMark({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <g stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" opacity=".8">
        <path d="M8 31V19A11 11 0 0 1 19 8H31" />
        <path d="M69 8H81A11 11 0 0 1 92 19V31" />
        <path d="M8 69V81A11 11 0 0 0 19 92H31" />
        <path d="M69 92H81A11 11 0 0 0 92 81V69" />
      </g>
      <path d="M50 23L75 37L50 51L25 37Z" fill="currentColor" opacity=".5" />
      <path d="M25 42L47.5 54.5V80L25 67.5Z" fill="currentColor" />
      <path d="M52.5 54.5L75 42V67.5L52.5 80Z" fill="currentColor" opacity=".85" />
    </svg>
  );
}
