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
