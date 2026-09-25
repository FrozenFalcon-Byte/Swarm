/** Chunky outlined icons in Ctrl's style: thick ink strokes, round joins, white fills. */
export type GlyphName = 'sort' | 'patch' | 'flask' | 'shield' | 'search' | 'hash' | 'dice' | 'clock' | 'globe' | 'bolt' | 'dot' | 'box' | 'chip'

const P: Record<GlyphName, React.ReactNode> = {
  sort: <><rect x="8" y="10" width="32" height="8" rx="4" fill="#fff" /><rect x="8" y="22" width="24" height="8" rx="4" fill="#fff" /><rect x="8" y="34" width="16" height="8" rx="4" fill="#fff" /></>,
  patch: <><rect x="9" y="9" width="30" height="30" rx="8" fill="#fff" transform="rotate(45 24 24)" /><circle cx="20" cy="24" r="1.8" fill="currentColor" stroke="none" /><circle cx="28" cy="24" r="1.8" fill="currentColor" stroke="none" /><circle cx="24" cy="20" r="1.8" fill="currentColor" stroke="none" /><circle cx="24" cy="28" r="1.8" fill="currentColor" stroke="none" /></>,
  flask: <><path d="M19 7h10M21 7v11L10 37a3 3 0 002.6 4.5h22.8A3 3 0 0038 37L27 18V7" fill="#fff" /><path d="M14 31h20" /></>,
  shield: <><path d="M24 6l15 6v11c0 9.5-6.4 16.4-15 19-8.6-2.6-15-9.5-15-19V12z" fill="#fff" /><path d="M17 24l5 5 9-10" /></>,
  search: <><circle cx="21" cy="21" r="12" fill="#fff" /><path d="M30 30l10 10" /></>,
  hash: <><rect x="8" y="8" width="32" height="32" rx="9" fill="#fff" /><path d="M20 15l-3 18M31 15l-3 18M15 21h19M14 28h19" /></>,
  dice: <><rect x="9" y="9" width="30" height="30" rx="8" fill="#fff" /><circle cx="18" cy="18" r="2.2" fill="currentColor" stroke="none" /><circle cx="30" cy="30" r="2.2" fill="currentColor" stroke="none" /><circle cx="24" cy="24" r="2.2" fill="currentColor" stroke="none" /></>,
  clock: <><circle cx="24" cy="24" r="16" fill="#fff" /><path d="M24 15v10l6 4" /></>,
  globe: <><circle cx="24" cy="24" r="16" fill="#fff" /><path d="M8 24h32M24 8c5 5 5 27 0 32M24 8c-5 5-5 27 0 32" /></>,
  bolt: <path d="M27 6L12 27h11l-3 15 16-22H25z" fill="#fff" />,
  dot: <><circle cx="24" cy="24" r="16" fill="#fff" /><circle cx="24" cy="24" r="5" fill="currentColor" /></>,
  box: <><path d="M24 6l16 8v20l-16 8-16-8V14z" fill="#fff" /><path d="M8 14l16 8 16-8M24 22v20" /></>,
  chip: <><rect x="12" y="12" width="24" height="24" rx="6" fill="#fff" /><path d="M18 6v6M30 6v6M18 36v6M30 36v6M6 18h6M6 30h6M36 18h6M36 30h6" /><rect x="19" y="19" width="10" height="10" rx="2" /></>,
}

export function Glyph({ name, size = 48 }: { name: GlyphName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="glyph">
      {P[name]}
    </svg>
  )
}
