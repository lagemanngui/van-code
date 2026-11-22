import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { fileFindings, isImportedBy, parseRemotePr, reviewAsk, reviewText, slugOf, swallowCount, tierOf } from './review.js'

const ch = (path: string, added = 1, removed = 0, isRename = false) => ({ path, added, removed, isRename })

test('files sort into risk tiers by path', () => {
  expect(tierOf(ch('db/migrate/20261122_add.rb'))).toBe(0)
  expect(tierOf(ch('src/auth/session.ts'))).toBe(0)
  expect(tierOf(ch('proto/order.proto'))).toBe(0)
  expect(tierOf(ch('src/orders/handler.ts'))).toBe(1)
  expect(tierOf(ch('src/orders/handler.test.ts'))).toBe(2)
  expect(tierOf(ch('test.js'))).toBe(2) // ava and node:test keep it at the root
  expect(tierOf(ch('package-lock.json', 900, 200))).toBe(3)
  expect(tierOf(ch('src/__snapshots__/a.snap'))).toBe(3)
  expect(tierOf(ch('src/new-name.ts', 0, 0, true))).toBe(3) // a pure rename
  expect(tierOf(ch('src/authors.ts'))).toBe(1) // "auth" only as a whole word
})

test('a catch that drops the error is counted', () => {
  expect(swallowCount('try { a() } catch {}\np.catch(() => {})\ntry:\n  x()\nexcept Exception:\n  pass')).toBe(3)
  expect(swallowCount('catch (e) { log(e) }\np.catch(e => report(e))\nfs.stat(f).catch(() => undefined)')).toBe(0)
  expect(swallowCount("// catch {} in a comment\nconst s = 'try { a() } catch {}'")).toBe(0)
})

test("a colleague's change gets the mod's checks, each a labeled draft with its line", () => {
  const before = 'export function total(xs) {\n  return 0\n}\n'
  const after = 'export function total(xs) {\n  const r = xs as any\n  console.log(req.body)\n  try { go() } catch {}\n  return r\n}\n'
  const f = fileFindings('src/total.ts', before, after)
  expect(f).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: 'question', line: 2, text: expect.stringContaining('`as any`') }),
      expect.objectContaining({ label: 'blocker', line: 3, text: expect.stringContaining('logs raw request data') }),
      expect.objectContaining({ label: 'question', text: expect.stringContaining('1 new catch drops the error') }),
    ]),
  )
  const m = fileFindings('db/migrate/1_add.rb', '', 'add_column :orders, :paid, :boolean, null: false\n')
  expect(m).toEqual([expect.objectContaining({ label: 'blocker', text: expect.stringContaining('NOT NULL column with no default') })])
})

test('a changed test that imports the file by name covers it', () => {
  expect(isImportedBy('src/orders/handler.ts', "import { handle } from './handler'")).toBe(true)
  expect(isImportedBy('src/orders/index.ts', "import { handle } from '../orders'")).toBe(true)
  expect(isImportedBy('src/orders/handler.ts', "import { x } from './handlers'")).toBe(false)
})

test('the review puts a file with a blocker first and numbers the drafts, blockers first', () => {
  const text = reviewText({
    title: 'feature/x vs main',
    files: [ch('src/a.ts', 40, 2), ch('db/migrate/1.rb', 3), ch('src/util.ts', 5), ch('yarn.lock', 300, 100)],
    findings: [
      { file: 'src/a.ts', label: 'suggestion', text: 'debug leftover' },
      { file: 'src/util.ts', label: 'blocker', line: 4, text: 'logs a secret' },
    ],
    skipped: 0,
  })
  expect(text).toContain('1 blocker · 0 questions · 1 suggestion')
  expect(text.indexOf('src/util.ts')).toBeLessThan(text.indexOf('2 · Logic')) // pulled up to tier 1
  expect(text).toContain('1. [blocker] src/util.ts:L4: logs a secret')
  expect(text).toContain('2. [suggestion] src/a.ts: debug leftover')
  expect(text).toMatch(/4 · Skim \(noise\)\n +yarn\.lock/)
})

const NEW_FILE = ['export function load(ids: string[]) {', '  console.log(ids)', ...Array.from({ length: 10 }, (_, i) => `  const v${i} = ${i}`), '}'].join('\n')

function gitWorld(on: On) {
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: NEW_FILE.length, mtimeMs: 1, isLink: false } }) as never)
  on('fs.read', (_, e) => ({ value: (e as { path?: string }).path === '/r/src/new.ts' ? NEW_FILE : '' }) as never)
  on('process.run', (_, e) => {
    const a = (e as { argv: string[] }).argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (a.includes('--show-toplevel')) return out('/r\n')
    if (a.includes('--abbrev-ref origin/HEAD')) return out('', 1)
    if (a.includes('--verify -q main')) return out('abc\n')
    if (a.includes('merge-base')) return out('abc123\n')
    if (a.includes('--show-current')) return out('main\n')
    if (a.includes('ls-files --others')) return out('src/new.ts\0')
    if (a.includes('diff --numstat')) return out('')
    return out('', 1) // diff (no tracked change), show, grep
  })
}

test('with no target, a new file not yet added is reviewed too', async ($, on) => {
  gitWorld(on)
  const r = await $.command.run({ command: 'van-code:review', args: '' } as never)
  const text = String(r.text)
  expect(text).toContain('main with uncommitted changes vs main (from abc123) · 1 file, +13')
  expect(text).toContain('[suggestion] src/new.ts:L2: debug leftover `console.log(ids)`')
  expect(text).toContain('+13 lines and no test reaches it')
})

test('--claude hands the review to Claude and starts a turn to check it', async ($, on) => {
  gitWorld(on)
  let scheduled = 0
  on('clock.after', () => {
    scheduled += 1
    return { value: { cancel: () => {} } } as never
  })
  const r = (await $.command.run({ command: 'van-code:review', args: '--claude' } as never)) as { text?: string; isTextDisplayOnly?: true; context?: string[] }
  expect(r.isTextDisplayOnly).toBeUndefined() // the review itself is what Claude reads
  expect(r.context).toBeUndefined() // nothing hidden to show twice
  expect(r.text).toContain('debug leftover')
  expect(r.text).toContain('Claude is checking the drafts now.')
  expect(scheduled).toBe(1)
})

test('a PR named in full is read from its URL or org/repo#n; a GitHub remote gives its slug', () => {
  expect(parseRemotePr('https://github.com/acme/api/pull/42')).toEqual({ slug: 'acme/api', n: '42' })
  expect(parseRemotePr('github.com/acme/api.v2/pull/7/files')).toEqual({ slug: 'acme/api.v2', n: '7' })
  expect(parseRemotePr('acme/api#42')).toEqual({ slug: 'acme/api', n: '42' })
  expect(parseRemotePr('#42')).toBeUndefined()
  expect(parseRemotePr('feature/x')).toBeUndefined()
  expect(slugOf('git@github.com:Acme/API.git\n')).toBe('acme/api')
  expect(slugOf('https://github.com/acme/api')).toBe('acme/api')
  expect(slugOf('https://gitlab.com/acme/api.git')).toBeUndefined()
})

test('a PR of a repo not cloned here is reviewed from the cached clone, and Claude is told where it is', async ($, on) => {
  const cache = '/home/u/.cache/van-code/repos/github.com/acme/api.git'
  const seen: string[] = []
  on('session.cwd', () => ({ value: '/elsewhere' }) as never)
  on('env.get', () => ({ value: '/home/u' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('clock.after', () => ({ value: { cancel: () => {} } }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never) // the cache exists
  on('process.run', (_, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string } }
    const a = argv.join(' ')
    seen.push(`${init?.cwd ?? ''} ${a}`)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (a.includes('--show-toplevel')) return out('', 128) // not in a repo
    if (a.startsWith('gh pr view')) return out(JSON.stringify({ baseRefName: 'main', baseRefOid: 'ba5e', headRefOid: 'f00d', title: 'Add paid flag' }))
    if (a.startsWith('git fetch')) return out('')
    if (a.includes('merge-base')) return out('abc123\n')
    if (a.includes('diff --numstat')) return out('1\t0\tdb/migrate/1_paid.rb\0')
    if (a.includes('show f00d:db/migrate/1_paid.rb')) return out('add_column :orders, :paid, :boolean, null: false\n')
    return out('', 1)
  })
  const r = (await $.command.run({ command: 'van-code:review', args: 'https://github.com/acme/api/pull/42 --claude' } as never)) as { text?: string; context?: string[] }
  expect(r.text).toContain('acme/api PR #42 "Add paid flag" vs origin/main (from abc123)')
  expect(seen).toContain(`${cache} git merge-base ba5e f00d`) // the PR's own base: a merged PR still has its diff
  expect(r.text).toContain('[blocker] db/migrate/1_paid.rb')
  expect(seen).toContain(`${cache} gh pr view 42 --json baseRefName,baseRefOid,headRefOid,title -R acme/api`)
  expect(seen.some(c => c.startsWith('gh repo clone'))).toBe(false) // cached already: no clone
  expect(reviewAsk(cache)).toContain(`git -C ${cache} show`)
})

test('--claude with no drafts starts no turn', async ($, on) => {
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  let scheduled = 0
  on('clock.after', () => {
    scheduled += 1
    return { value: { cancel: () => {} } } as never
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('fs.read', () => ({ value: 'export const ok = 1\n' }) as never)
  on('process.run', (_, e) => {
    const a = (e as { argv: string[] }).argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (a.includes('--show-toplevel')) return out('/r\n')
    if (a.includes('--verify -q main')) return out('abc\n')
    if (a.includes('merge-base')) return out('abc123\n')
    if (a.includes('--show-current')) return out('main\n')
    if (a.includes('diff --numstat')) return out('1\t0\tsrc/ok.ts\0')
    return out('', 1)
  })
  const r = await $.command.run({ command: 'van-code:review', args: '--claude' } as never)
  expect(String(r.text)).toContain('Nothing for Claude to check.')
  expect(scheduled).toBe(0)
})
