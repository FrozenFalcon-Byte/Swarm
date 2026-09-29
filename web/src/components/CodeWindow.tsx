import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { easeOut } from '../lib/motion'
import { useToast } from './Island'
import './code.css'

/*
 * A macOS-style window for code: traffic lights, a centred title, line numbers and syntax colours.
 * `CodeWindow` sits inline in a page; `CodeDialog` opens one over everything (Esc or the red light closes it).
 */

type Lang = 'python' | 'json' | 'diff' | 'text'

/* Word wrap is one choice for every code view, remembered in this browser; flipping it in one window flips them all. */
const WRAP_KEY = 'swarm.codeWrap'
const wrapSubs = new Set<() => void>()
let wrapOn = (() => { try { return localStorage.getItem(WRAP_KEY) === '1' } catch { return false } })()
export function useWrap(): [boolean, () => void] {
  const on = useSyncExternalStore((f) => { wrapSubs.add(f); return () => { wrapSubs.delete(f) } }, () => wrapOn)
  const flip = () => {
    wrapOn = !wrapOn
    try { localStorage.setItem(WRAP_KEY, wrapOn ? '1' : '0') } catch { /* private window: it just won't be remembered */ }
    wrapSubs.forEach((f) => f())
  }
  return [on, flip]
}

/** The little wrap switch the code views share. */
export function WrapButton({ className = 'cw-btn' }: { className?: string }) {
  const [wrap, flip] = useWrap()
  return <button type="button" className={`${className} ${wrap ? 'on' : ''}`} aria-pressed={wrap} onClick={flip} data-tip={wrap ? 'Keep long lines on one line' : 'Wrap long lines'}>Wrap</button>
}

const PY_KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'])
const PY_BUILTINS = new Set(['print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict', 'set', 'tuple', 'sorted', 'open',
  'enumerate', 'zip', 'min', 'max', 'sum', 'any', 'all', 'isinstance', 'round', 'next', 'iter', 'super', 'self', 'bool'])

type Tok = { t: string; c?: string }

// one pass over a line; triple-quoted strings carry across lines via `state`
function tokenizePython(line: string, state: { inString: string | null }): Tok[] {
  const out: Tok[] = []
  let i = 0
  const push = (t: string, c?: string) => { if (t) out.push({ t, c }) }
  if (state.inString) {
    const end = line.indexOf(state.inString)
    if (end < 0) return [{ t: line, c: 'str' }]
    push(line.slice(0, end + 3), 'str'); i = end + 3; state.inString = null
  }
  while (i < line.length) {
    const rest = line.slice(i)
    let m: RegExpMatchArray | null
    if (rest[0] === '#') { push(rest, 'com'); break }
    if ((m = rest.match(/^[rbfuRBFU]{0,2}("""|''')/))) {
      const q = m[1], close = rest.indexOf(q, m[0].length)
      if (close < 0) { push(rest, 'str'); state.inString = q; break }
      push(rest.slice(0, close + 3), 'str'); i += close + 3; continue
    }
    if ((m = rest.match(/^[rbfuRBFU]{0,2}("([^"\\]|\\.)*"?|'([^'\\]|\\.)*'?)/))) { push(m[0], 'str'); i += m[0].length; continue }
    if ((m = rest.match(/^@[\w.]+/))) { push(m[0], 'dec'); i += m[0].length; continue }
    if ((m = rest.match(/^\d[\d_]*(\.\d+)?([eE][-+]?\d+)?/))) { push(m[0], 'num'); i += m[0].length; continue }
    if ((m = rest.match(/^[A-Za-z_]\w*/))) {
      const w = m[0], prev = out.filter((x) => x.t.trim()).at(-1)?.t
      push(w, PY_KEYWORDS.has(w) ? 'kw' : prev === 'def' || prev === 'class' ? 'fn' : PY_BUILTINS.has(w) ? 'bi' : /^\s*\(/.test(line.slice(i + w.length)) ? 'call' : undefined)
      i += w.length; continue
    }
    if ((m = rest.match(/^[-+*/%=<>!&|^~:]+/))) { push(m[0], 'op'); i += m[0].length; continue }
    push(rest[0]); i += 1
  }
  return out
}

function tokenizeJson(line: string): Tok[] {
  const out: Tok[] = []
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|\b(true|false|null)\b|([{}[\],])|(\s+)|(.)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m[1]) { out.push({ t: m[1], c: m[2] ? 'key' : 'str' }); if (m[2]) out.push({ t: m[2], c: 'op' }) }
    else if (m[3]) out.push({ t: m[3], c: 'num' })
    else if (m[4]) out.push({ t: m[4], c: 'kw' })
    else if (m[5]) out.push({ t: m[5], c: 'punc' })
    else out.push({ t: m[0] })
  }
  return out
}

function highlight(code: string, lang: Lang): { toks: Tok[]; cls?: string }[] {
  const lines = code.replace(/\n$/, '').split('\n')
  const state = { inString: null as string | null }
  return lines.map((l) => {
    if (lang === 'python') return { toks: tokenizePython(l, state) }
    if (lang === 'json') return { toks: tokenizeJson(l) }
    if (lang === 'diff') {
      const cls = l.startsWith('+++') || l.startsWith('---') ? 'd-file' : l.startsWith('+') ? 'd-add' : l.startsWith('-') ? 'd-del' : l.startsWith('@@') ? 'd-hunk' : undefined
      return { toks: [{ t: l }], cls }
    }
    return { toks: [{ t: l }] }
  })
}

export function guessLang(name: string, code: string): Lang {
  if (name.endsWith('.py')) return 'python'
  if (name.endsWith('.json') || /^\s*[{[]/.test(code)) return 'json'
  if (name.endsWith('.diff') || /^(---|\+\+\+|@@)/m.test(code)) return 'diff'
  return 'text'
}

export function CodeWindow({ title, code, lang, onClose, maxHeight, actions, loading, paper }: {
  title: string; code: string; lang?: Lang; onClose?: () => void; maxHeight?: string; actions?: ReactNode; loading?: boolean
  /** Swarm's own look (white paper, ink outline, agent-coloured lights) instead of the dark editor */
  paper?: boolean
}) {
  const toast = useToast()
  const language = lang || guessLang(title, code)
  const lines = useMemo(() => highlight(code, language), [code, language])
  const [copied, setCopied] = useState(false)
  const [wrap] = useWrap()
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); toast.ok('Copied'); window.setTimeout(() => setCopied(false), 1400) }
    catch { toast.error('Couldn’t copy', 'Your browser blocked the clipboard.') }
  }
  return (
    <div className={`cw ${paper ? 'cw--paper' : ''}`} role="group" aria-label={title}>
      <div className="cw-bar">
        {paper ? (
          <div className="cw-dots" aria-hidden="true">{['triager', 'coder', 'tester', 'reviewer'].map((a, i) => <motion.i key={a} style={{ background: `var(--${a})` }} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18, delay: 0.25 + i * 0.05 }} />)}</div>
        ) : <div className="cw-lights">
          <button className="cw-light cw-red" onClick={onClose} disabled={!onClose} aria-label="Close" tabIndex={onClose ? 0 : -1}><svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg></button>
          <span className="cw-light cw-yellow"><svg viewBox="0 0 12 12"><path d="M3 6h6" /></svg></span>
          <span className="cw-light cw-green"><svg viewBox="0 0 12 12"><path d="M3.8 8.2V3.8h4.4M8.2 3.8v4.4H3.8" /></svg></span>
        </div>}
        <div className="cw-title"><FileIcon lang={language} /><span>{title}</span></div>
        <div className="cw-actions">
          {actions}
          <WrapButton />
          <button className="cw-btn" onClick={copy} disabled={loading}>{copied ? 'Copied' : 'Copy'}</button>
          {paper && onClose && <button className="cw-btn cw-close" onClick={onClose} aria-label="Close"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>}
        </div>
      </div>
      <div className="cw-body" style={maxHeight ? { maxHeight } : undefined}>
        {loading ? <div className="cw-loading"><span /><span /><span /></div> : (
          <pre className={`cw-code ${wrap ? 'is-wrap' : ''}`}><code>
            {lines.map((l, i) => (
              <span key={i} className={`cw-line ${l.cls || ''}`} style={paper && i < 40 ? { animationDelay: `${0.2 + i * 0.012}s` } : undefined}>
                <span className="cw-ln" aria-hidden="true">{i + 1}</span>
                <span className="cw-src">{l.toks.length ? l.toks.map((t, k) => t.c ? <span key={k} className={`tk-${t.c}`}>{t.t}</span> : t.t) : ' '}</span>
              </span>
            ))}
          </code></pre>
        )}
      </div>
      <div className="cw-status mono">
        <span>{language === 'text' ? 'Plain text' : language === 'json' ? 'JSON' : language === 'diff' ? 'Diff' : 'Python'}</span>
        <span>{loading ? '…' : `${lines.length} lines`}</span>
      </div>
    </div>
  )
}

function FileIcon({ lang }: { lang: Lang }) {
  const colour = lang === 'python' ? 'var(--coder)' : lang === 'json' ? 'var(--triager)' : lang === 'diff' ? 'var(--reviewer)' : 'var(--grey-6)'
  return <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l5 5v15H6z" fill={colour} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
}

/** The code window as a dialog over the page. */
export function CodeDialog({ open, title, code, lang, loading, onClose }: {
  open: boolean; title: string; code: string; lang?: Lang; loading?: boolean; onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="cw-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} onClick={onClose}>
          <motion.div className="cw-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 40, scale: 0.94, filter: 'blur(10px)' }} animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }} exit={{ opacity: 0, y: 24, scale: 0.97, filter: 'blur(6px)' }}
            transition={{ duration: 0.5, ease: easeOut }}>
            <CodeWindow title={title} code={code} lang={lang} loading={loading} onClose={onClose} maxHeight="min(72svh, 760px)" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
