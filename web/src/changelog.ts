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
    id: '2026-09-29d',
    date: '29 September',
    items: [
      { agent: 'triager', text: 'Everything about notifications now lives in Settings → Notifications, including how the notes look' },
      { agent: 'coder', text: 'One switch for sounds: a chime on notes in Swarm, a pop with browser notifications' },
      { agent: 'reviewer', text: 'A worker between passes shows as on call: it starts when there’s work' },
    ],
  },
  {
    id: '2026-09-29c',
    date: '29 September',
    items: [
      { agent: 'triager', text: 'Settings → Notifications: pick what alerts you, from ready to merge to sent back' },
      { agent: 'coder', text: 'Get a note in Swarm, a browser notification or a soft pop, and send yourself a test' },
      { agent: 'reviewer', text: 'Mute the repositories you don’t need to hear from' },
    ],
  },
  {
    id: '2026-09-29b',
    date: '29 September',
    items: [
      { agent: 'coder', text: 'A touch of motion blur on things that move fast: page changes, ⌘K, dialogs and notes' },
      { agent: 'tester', text: 'Your Weekly Rewind blurs as the crew drops in and the stamp comes down' },
    ],
  },
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
