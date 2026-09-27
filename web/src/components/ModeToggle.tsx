import { useState } from 'react'
import { toggleMode, useMode } from '../lib/theme'

const AGENTS = ['triager', 'coder', 'tester', 'reviewer']

/** Light/dark as a plain toggle: a knob that slides across, stretching a little as it goes. Clicking lets the
 *  four agent dots pop out around the switch and fade. With `labels` it is a whole row (the sidebar's foot)
 *  that names the mode. The page changes as a circle opening from the switch
 *  (lib/theme.ts). */
export function ModeToggle({ className = '', labels = false }: { className?: string; labels?: boolean }) {
  const { dark } = useMode()
  const [burst, setBurst] = useState(0)
  return (
    <button type="button" role="switch" aria-checked={dark} className={`mode ${dark ? 'is-dark' : ''} ${labels ? 'mode--row' : ''} ${className}`}
      aria-label="Dark mode" data-tip={dark ? 'Light mode' : 'Dark mode'}
      onClick={(e) => {
        const t = e.currentTarget.querySelector('.mode-track')!.getBoundingClientRect()
        setBurst((b) => b + 1)
        if (e.detail) e.currentTarget.blur() // a mouse click, not the keyboard: no focus ring left behind
        toggleMode({ clientX: t.left + t.width / 2, clientY: t.top + t.height / 2 })
      }}>
      <span className="mode-track" aria-hidden="true">
        <span className="mode-knob" />
        {burst > 0 && (
          <span key={burst} className="mode-burst">
            {Array.from({ length: 8 }, (_, k) => <i key={k} style={{ background: `var(--${AGENTS[k % 4]})`, ['--a' as string]: `${k * 45 + 20}deg`, ['--k' as string]: k }} />)}
          </span>
        )}
      </span>
      {labels && (
        <span className="mode-label">
          <span className="mode-words"><span>Light mode</span><span>Dark mode</span></span>
        </span>
      )}
    </button>
  )
}
