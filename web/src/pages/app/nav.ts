/* The dashboard's pages, shared by the sidebar, the command bar and the pin picker in Settings → Appearance. */

export const NAV: { to: string; label: string; icon: string; group: 'main' | 'guard' | 'play' | 'foot'; admin?: boolean }[] = [
  { to: '/app', label: 'Overview', icon: 'overview', group: 'main' }, { to: '/app/repos', label: 'Repositories', icon: 'repos', group: 'main' },
  { to: '/app/agents', label: 'Agents', icon: 'agents', group: 'main' }, { to: '/app/tools', label: 'Tools', icon: 'tools', group: 'main' },
  { to: '/app/lab', label: 'Test lab', icon: 'lab', group: 'main', admin: true },
  { to: '/app/a2a', label: 'A2A guide', icon: 'a2a', group: 'main', admin: true },
  { to: '/app/rules', label: 'House rules', icon: 'rules', group: 'guard' }, { to: '/app/quiet-hours', label: 'Quiet hours', icon: 'quiet', group: 'guard' },
  { to: '/app/fun', label: 'Just for fun', icon: 'fun', group: 'play' },
  { to: '/app/settings', label: 'Settings', icon: 'settings', group: 'foot' }, { to: '/app/help', label: 'Help', icon: 'help', group: 'foot' },
]

export const ICONS: Record<string, string> = {
  rules: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z M9 12l2 2 4-4',
  fun: 'M12 22a10 10 0 100-20 10 10 0 000 20z M8 14.5s1.5 2.5 4 2.5 4-2.5 4-2.5 M9 9.5h.01 M15 9.5h.01',
  rocket: 'M12 2c3 2.5 4.5 6 4.5 10.5L14 16h-4l-2.5-3.5C7.5 8 9 4.5 12 2z M12 11a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z M10 16l-1 5 3-2 3 2-1-5 M7.5 12.5L4 15l3.5 1 M16.5 12.5L20 15l-3.5 1',
  hive: 'M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z M12 8.2l3.3 1.9v3.8L12 15.8l-3.3-1.9v-3.8z',
  quiet: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  a2a: 'M6.5 9a3 3 0 100-6 3 3 0 000 6z M17.5 21a3 3 0 100-6 3 3 0 000 6z M9.5 6h5a3 3 0 013 3v3 M14.5 18h-5a3 3 0 01-3-3v-3 M15.5 10l2 2 2-2 M8.5 14l-2-2-2 2',
  lab: 'M9 3h6 M10 3v6L4.5 18.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3 M7.5 14h9',
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  repos: 'M4 4h11l5 5v11H4z M15 4v5h5',
  agents: 'M8 12a3 3 0 100-6 3 3 0 000 6z M16 18a3 3 0 100-6 3 3 0 000 6z M10.6 10.5l2.8 2.9 M5 20a3 3 0 016 0',
  help: 'M12 22a10 10 0 100-20 10 10 0 000 20z M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3 M12 17h.01',
  tools: 'M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
}
