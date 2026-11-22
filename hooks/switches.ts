// The mod's switches grouped for /van-code, the profiles, and the history kept between sessions.

type Switch = { key: string; title: string }
// Titles match plugin.json's userConfig (a test holds them together).
export const GROUPS: [group: string, switches: Switch[]][] = [
  ['Reading', [
    { key: 'guard', title: 'Heavy-file guard' },
    { key: 'readMemory', title: 'Read memory' },
    { key: 'outlineFirst', title: 'Outline first' },
  ]],
  ['Editing', [
    { key: 'postEditCheck', title: 'Post-edit check' },
    { key: 'antiCheat', title: 'Anti-cheat' },
    { key: 'intentDiff', title: 'Intent diff' },
    { key: 'archaeology', title: 'Archaeology' },
    { key: 'migrationGate', title: 'Migration gate' },
    { key: 'schemaGuard', title: 'Schema guard' },
  ]],
  ['Proof', [
    { key: 'proveIt', title: 'Prove it works' },
    { key: 'receipts', title: 'Receipts' },
    { key: 'cleanRoom', title: 'Clean-room check' },
    { key: 'chongLi', title: 'Automatic Chong Li' },
  ]],
  ['Rails', [
    { key: 'infraGuard', title: 'Infra guard' },
    { key: 'gitGuard', title: 'Git guard' },
    { key: 'noAttribution', title: 'No AI attribution' },
  ]],
  ['Session', [
    { key: 'cardPlan', title: 'Card plan' },
    { key: 'suggestions', title: 'Reply suggestions' },
    { key: 'contextAlarm', title: 'Context alarm' },
    { key: 'rules', title: 'Van Code rules' },
    { key: 'adhd', title: 'ADHD mode' },
    { key: 'compactRestore', title: 'Compaction restore' },
    { key: 'compactTrim', title: 'Compaction trim' },
    { key: 'usageHeader', title: 'Usage header' },
    { key: 'intro', title: 'Intro animation' },
  ]],
]
export const SWITCHES = GROUPS.flatMap(([, s]) => s)

// Behaviors with no switch of their own, named in the log.
const LABELS: Record<string, string> = { loop: 'Loop breaker', ledger: 'Assumption ledger', pdf: 'PDF to OCR', jq: 'JSON to jq' }
export const titleOf = (key: string) => SWITCHES.find(s => s.key === key)?.title ?? LABELS[key] ?? key

// What each profile turns off on top of the /config switches.
export const PROFILES: Record<string, string[]> = {
  full: [],
  // no Haiku calls, no end-of-turn reviews: the guards, checks and proof stay
  light: ['chongLi', 'intentDiff', 'suggestions', 'archaeology', 'cleanRoom', 'cardPlan'],
  // the safety rails and read savings only
  minimal: SWITCHES.map(s => s.key).filter(k => !['guard', 'readMemory', 'infraGuard', 'gitGuard', 'noAttribution', 'compactRestore', 'compactTrim', 'usageHeader', 'intro'].includes(k)),
}

// A switch by key or title, ignoring case, spaces and dashes: `anti-cheat`, `chongli`, `Clean-room check`.
export function findSwitch(name: string): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')
  const n = norm(name)
  const exact = SWITCHES.find(s => norm(s.key) === n || norm(s.title) === n)
  if (exact) return exact.key
  // a prefix of 4+ letters, when only one switch starts with it
  const some = n.length >= 4 ? SWITCHES.filter(s => norm(s.key).startsWith(n) || norm(s.title).startsWith(n)) : []
  return some.length === 1 ? some[0]!.key : undefined
}

// Day (YYYY-MM-DD, UTC) → behavior → times it fired; `<behavior>.past` counts the times Claude went past it.
export type History = Record<string, Record<string, number>>
export const HISTORY_DAYS = 30
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function bump(h: History, ms: number, key: string) {
  const d = (h[dayOf(ms)] ??= {})
  d[key] = (d[key] ?? 0) + 1
}

// Only the last HISTORY_DAYS days, so the store stays small.
export function prune(h: unknown, ms: number): History {
  if (!h || typeof h !== 'object') return {}
  const from = dayOf(ms - (HISTORY_DAYS - 1) * 86_400_000)
  return Object.fromEntries(Object.entries(h as History).filter(([d]) => d >= from))
}

// Two histories added up, day by day; neither is changed.
export function merge(a: History, b: History): History {
  const out: History = {}
  for (const h of [a, b]) for (const [d, day] of Object.entries(h)) for (const [k, n] of Object.entries(day)) (out[d] ??= {})[k] = (out[d][k] ?? 0) + n
  return out
}

export function totals(h: History): Record<string, number> {
  const out: Record<string, number> = {}
  for (const day of Object.values(h)) for (const [k, n] of Object.entries(day)) out[k] = (out[k] ?? 0) + n
  return out
}

// Switches Claude went past at least half the times they fired (5 or more): likely false blocks here.
export function offHints(t: Record<string, number>): string[] {
  return SWITCHES.filter(s => (t[s.key] ?? 0) >= 5 && (t[`${s.key}.past`] ?? 0) * 2 >= t[s.key]!).map(
    s => `${s.title}: Claude went past it ${t[`${s.key}.past`]} of ${t[s.key]} times. \`/van-code off ${s.key}\` for this session, or turn it off in /config.`,
  )
}

// The one toast a turn gets: what fired, and the notes waiting for the next message.
export function turnSummary(fired: string[], pending: number): string | undefined {
  if (fired.length === 0 && pending === 0) return undefined
  const counts = new Map<string, number>()
  for (const f of fired) counts.set(f, (counts.get(f) ?? 0) + 1)
  const what = [...counts].map(([f, n]) => (n > 1 ? `${titleOf(f)} ×${n}` : titleOf(f))).join(', ')
  const wait = pending > 0 ? `${pending} note${pending > 1 ? 's' : ''} for Claude with your next message` : ''
  return `Van Code: ${[what, wait].filter(Boolean).join(' · ')} · /van-code:log`
}
