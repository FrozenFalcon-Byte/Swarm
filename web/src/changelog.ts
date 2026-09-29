/*
 * What's new: the newest entry pops up once for everyone after a deploy (components/WhatsNew.tsx).
 * Add an entry at the top with every deploy. Keep it a quick update: a few short lines, one per change,
 * each tagged with the agent colour that suits it. The id only has to be new; a date works well.
 */

export type ChangeAgent = 'triager' | 'coder' | 'tester' | 'reviewer'
export interface Change { agent: ChangeAgent; text: string }
export interface Release { id: string; date: string; items: Change[] }

export const RELEASES: Release[] = [
  {
    id: '2026-09-29',
    date: '29 September',
    items: [
      { agent: 'coder', text: 'The Relay: scroll through one bug’s trip from dot to merge, under Just for fun' },
      { agent: 'triager', text: 'The loader glides out smoothly, no more stutter' },
      { agent: 'tester', text: 'The Rewind stopwatch hand now points where it should' },
      { agent: 'reviewer', text: 'A cleaner A2A guide, with no bar across the top' },
    ],
  },
]
