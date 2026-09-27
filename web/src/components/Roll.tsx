/** A button label that rolls: on hover each letter slides up and an identical copy follows it in,
 *  one letter after another. Pure CSS once rendered (see .roll in index.css). */
export function Roll({ children }: { children: string }) {
  return (
    <span className="roll" aria-label={children}>
      {Array.from(children).map((ch, i) => {
        const c = ch === ' ' ? ' ' : ch
        return <span key={i} className="roll-ch" data-ch={c} style={{ ['--i' as string]: i }} aria-hidden="true">{c}</span>
      })}
    </span>
  )
}

const ARROW = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
/** An arrow for a button that goes somewhere: on hover it slides out and a fresh one slides in behind it. */
export function Go() {
  return <span className="btn-go" aria-hidden="true">{ARROW}{ARROW}</span>
}
