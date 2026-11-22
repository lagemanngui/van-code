import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { bump, findSwitch, merge, offHints, prune, totals, turnSummary } from './switches.js'

test('a switch is found by key, title or a unique prefix', () => {
  expect(findSwitch('anti-cheat')).toBe('antiCheat')
  expect(findSwitch('Clean-room check')).toBe('cleanRoom')
  expect(findSwitch('chong')).toBe('chongLi')
  expect(findSwitch('comp')).toBeUndefined() // compactRestore or compactTrim
  expect(findSwitch('nope')).toBeUndefined()
})

test('history keeps 30 days and suggests turning off what Claude keeps going past', () => {
  const now = Date.UTC(2026, 10, 22)
  const h = prune({ '2026-09-01': { guard: 9 } }, now)
  for (let i = 0; i < 6; i++) bump(h, now, 'outlineFirst')
  for (let i = 0; i < 3; i++) bump(h, now, 'outlineFirst.past')
  bump(h, now, 'gitGuard')
  expect(totals(h)).toEqual({ outlineFirst: 6, 'outlineFirst.past': 3, gitGuard: 1 })
  expect(offHints(totals(h))).toEqual([expect.stringContaining('Outline first: Claude went past it 3 of 6 times')])
  expect(prune('garbage', now)).toEqual({})
})

test("the turn's toast counts repeats and names the notes waiting", () => {
  expect(turnSummary(['antiCheat', 'cleanRoom', 'cleanRoom'], 2)).toBe('Van Code: Anti-cheat, Clean-room check ×2 · 2 notes for Claude with your next message · /van-code:log')
  expect(turnSummary([], 0)).toBeUndefined()
})

function world(on: On) {
  const toasts: string[] = []
  on('fs.stat', () => ({ value: { kind: 'file', size: 4000, mtimeMs: 1, isLink: false } }) as never)
  on('fs.read', () => ({ value: 'x' }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'boom' } }) as never)
  on('tool.call', () => ({ result: {}, isError: true, text: 'boom' }) as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined } as never
  })
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('settings.read', () => ({ value: {} }) as never)
  on('command.run', () => ({ text: '' }))
  return { toasts }
}

const loop = (n: number) => ({ tool: 'Bash', command: `npm test -- case${n}` }) as const

test('a turn gets one toast, and /van-code log lists what fired', async ($, on) => {
  const w = world(on)
  await $.prompt.submit({ text: 'fix the tests' } as never)
  for (let i = 0; i < 3; i++) await $.tool.call(loop(i)) // three related failures: the loop breaker
  expect(w.toasts).toEqual([]) // nothing mid-turn
  await $.turn.complete({ answer: 'still failing' } as never)
  for (let i = 0; i < 50; i++) await Promise.resolve()
  expect(w.toasts.filter(t => t.startsWith('Van Code:'))).toEqual([expect.stringContaining('Loop breaker')])
  const r = await $.command.run({ command: 'van-code:log', args: '' } as never)
  expect(String(r.text)).toContain('Loop breaker')
})

test('/van-code off turns a switch off for the session, and /van-code shows it', async ($, on) => {
  world(on)
  const off = await $.command.run({ command: 'van-code', args: 'off git guard' } as never)
  expect(String(off.text)).toContain('Git guard off for this session')
  const r = await $.command.run({ command: 'van-code', args: '' } as never)
  expect(String(r.text)).toMatch(/✗ Git guard +gitGuard +off for this session/)
  const p = await $.command.run({ command: 'van-code', args: 'profile light' } as never)
  expect(String(p.text)).toMatch(/✗ Automatic Chong Li +chongLi +off by profile light/)
  const bad = await $.command.run({ command: 'van-code', args: 'off nope' } as never)
  expect(String(bad.text)).toContain('No switch named "nope"')
})

function cheatWorld(on: On) {
  const file = { text: 'const x = f() as any' } // what the file holds after the cheat
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('fs.read', () => ({ value: file.text }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '/p' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  on('tool.call', (_, e) => ({ result: {}, ...((e as { command?: string }).command?.includes('vitest') ? { isError: true } : {}) }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  return file
}
const cheat = { tool: 'Edit', file_path: '/p/a.ts', old_string: 'const x = f()', new_string: 'const x = f() as any' } as const
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

test('a finding whose lines a later edit removes is logged as fixed', async ($, on) => {
  const file = cheatWorld(on)
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' } as never)
  await $.tool.call(cheat)
  file.text = 'const x: number = f()'
  await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'const x = f() as any', new_string: 'const x: number = f()' } as never)
  const r = await $.command.run({ command: 'van-code:log', args: '' } as never)
  expect(String(r.text)).toMatch(/Anti-cheat .*`as any`.*→ fixed/)
})

test('a finding still there a full turn after Claude was told is logged as kept', async ($, on) => {
  cheatWorld(on)
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' } as never)
  await $.tool.call(cheat)
  await $.turn.complete({ answer: 'ok' } as never)
  await settle()
  expect(String((await $.command.run({ command: 'van-code:log', args: '' } as never)).text)).toContain('→ open')
  await $.turn.complete({ answer: 'ok' } as never)
  await settle()
  expect(String((await $.command.run({ command: 'van-code:log', args: '' } as never)).text)).toContain('→ kept')
})

test('/van-code reset undoes the session changes', async ($, on) => {
  world(on)
  await $.command.run({ command: 'van-code', args: 'off antiCheat' } as never)
  await $.command.run({ command: 'van-code', args: 'profile minimal' } as never)
  const r = await $.command.run({ command: 'van-code', args: 'reset' } as never)
  expect(String(r.text)).toContain('Back to /config (undid Anti-cheat off, profile minimal)')
  expect(String(r.text)).toMatch(/✓ Anti-cheat/)
})

test('two histories add up day by day', () => {
  expect(merge({ d1: { a: 1 } }, { d1: { a: 2, b: 1 }, d2: { a: 1 } })).toEqual({ d1: { a: 3, b: 1 }, d2: { a: 1 } })
})

// A store and a transcript, as the engine keeps them across /reload-plugins (which fires no session.start).
function stored(on: On, transcript: string, seed: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(seed))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_, e) => {
    store.set((e as { key: string }).key, (e as { value: unknown }).value)
    return { value: undefined } as never
  })
  on('session.info', () => ({ value: { transcriptPath: transcript } }) as never)
  return store
}

test('counts reach the 30-day history and the log is saved, with no session.start', async ($, on) => {
  world(on)
  const store = stored(on, '/t/a.jsonl')
  await $.prompt.submit({ text: 'fix the tests' } as never)
  for (let i = 0; i < 3; i++) await $.tool.call(loop(i))
  await $.turn.complete({ answer: 'still failing' } as never)
  for (let i = 0; i < 500 && !store.has('history'); i++) await Promise.resolve() // the save runs after the turn's checks settle
  expect(JSON.stringify(store.get('history'))).toContain('"loop"')
  expect(JSON.stringify(store.get('session'))).toContain('/t/a.jsonl')
  const r = await $.command.run({ command: 'van-code:stats', args: '' } as never)
  expect(String(r.text)).toContain('Last 30 days (all sessions): Loop breaker')
})

test("after a reload the same session's log comes back, another session's does not", async ($, on) => {
  world(on)
  const entry = { at: 0, feature: 'antiCheat', text: 'a.ts: `as any`' }
  stored(on, '/t/a.jsonl', { session: { transcript: '/t/a.jsonl', log: [entry], fired: { antiCheat: 1 }, stats: {} } })
  const r = await $.command.run({ command: 'van-code:log', args: '' } as never)
  expect(String(r.text)).toContain('a.ts: `as any`')
})

test("another session's saved log stays out", async ($, on) => {
  world(on)
  const entry = { at: 0, feature: 'antiCheat', text: 'a.ts: `as any`' }
  stored(on, '/t/b.jsonl', { session: { transcript: '/t/a.jsonl', log: [entry], fired: { antiCheat: 1 }, stats: {} } })
  const r = await $.command.run({ command: 'van-code:log', args: '' } as never)
  expect(String(r.text)).not.toContain('a.ts')
})

test('a bench run leaves the history and the session snapshot alone', async ($, on) => {
  world(on)
  const store = stored(on, '/t/a.jsonl')
  on('env.get', (_, e) => ({ value: (e as { name: string }).name === 'VAN_CODE_BENCH' ? '1' : undefined }) as never)
  await $.prompt.submit({ text: 'fix the tests' } as never)
  for (let i = 0; i < 3; i++) await $.tool.call(loop(i))
  await $.turn.complete({ answer: 'still failing' } as never)
  for (let i = 0; i < 500; i++) await Promise.resolve()
  expect(store.has('history')).toBe(false)
  expect(store.has('session')).toBe(false)
})
