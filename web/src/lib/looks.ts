import type { Prefs } from './types'

/* The themes and typefaces you can pick (Settings → Appearance, and the last step of first-time setup). */

export const FONTS: [NonNullable<Prefs['font']>, string][] = [
  ['grotesk', 'Schibsted'], ['bricolage', 'Bricolage'], ['geist', 'Geist'], ['outfit', 'Outfit'], ['rounded', 'Nunito'], ['serif', 'Fraunces'], ['mono', 'Geist Mono'],
]
/** Whole looks in one click: each sets the colour, canvas, typeface and corners together, and brings a backdrop of its own. */
export const THEMES: { id: NonNullable<Prefs['look']>; name: string; says: string; look: Prefs; swatch: string[] }[] = [
  { id: 'plain', name: 'Plain', says: 'Just the dashboard, nothing behind it', look: { look: 'plain', accent: 'green', canvas: 'white', font: 'grotesk', corners: 'round' }, swatch: ['var(--green)', 'var(--ink)', 'var(--grey-6)'] },
  { id: 'swarm', name: 'Swarm', says: 'The four agents, glowing softly along the top', look: { look: 'swarm', accent: 'green', canvas: 'white', font: 'bricolage', corners: 'round' }, swatch: ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)'] },
  { id: 'studio', name: 'Mint', says: 'A faint dot grid, with a light wandering over it', look: { look: 'studio', accent: 'ink', canvas: 'mist', font: 'geist', corners: 'soft' }, swatch: ['#9fe0b4', '#bfe6ff', 'var(--ink)'] },
  { id: 'paper', name: 'Paper', says: 'Warm paper, a peach glow in the corner', look: { look: 'paper', accent: 'coral', canvas: 'paper', font: 'serif', corners: 'soft' }, swatch: ['var(--tester)', '#f1e4c8', 'var(--triager)'] },
  { id: 'candy', name: 'Candy', says: 'Pastel sprinkles, bobbing in the corner', look: { look: 'candy', accent: 'pink', canvas: 'white', font: 'rounded', corners: 'round' }, swatch: ['var(--lab)', '#c9c2f5', 'var(--mint-strong)'] },
  { id: 'harbour', name: 'Harbour', says: 'Light glinting on still water', look: { look: 'harbour', accent: 'sky', canvas: 'mist', font: 'outfit', corners: 'soft' }, swatch: ['var(--coder)', '#8fe1d0', '#c9c2f5'] },
  { id: 'sunny', name: 'Sunny', says: 'Morning light, sending out slow rings', look: { look: 'sunny', accent: 'yellow', canvas: 'paper', font: 'rounded', corners: 'round' }, swatch: ['var(--triager)', '#ffd79a', 'var(--tester)'] },
]
