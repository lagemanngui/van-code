import { expect, test } from 'claude-code/testing'

import { isCovered, parseShellRead, resolvePath } from './reads.js'

const STAT = { kind: 'file', size: 10, mtimeMs: 1, isLink: false }

test('shell reads are recognised under rtk and cd prefixes', () => {
  expect(parseShellRead('rtk bypass cat pnpm-lock.yaml')?.reads).toEqual([{ file: 'pnpm-lock.yaml', range: [1, Infinity] }])
  expect(parseShellRead('cd /r && head -n 50 a.ts')).toEqual({ dir: '/r', isBypass: false, reads: [{ file: 'a.ts', lines: 50, range: [1, 50] }] })
  expect(parseShellRead("sed -n '10,40p' a.ts")?.reads).toEqual([{ file: 'a.ts', lines: 31, range: [10, 40] }])
  expect(parseShellRead('tail -20 a.ts')?.reads).toEqual([{ file: 'a.ts', lines: 20, range: undefined }])
  expect(parseShellRead('git show HEAD~1:yarn.lock')?.reads).toEqual([{ file: 'yarn.lock' }])
  expect(parseShellRead('cat a.ts | grep x')).toBeUndefined()
  expect(parseShellRead('cat a.ts > b.ts')).toBeUndefined()
  expect(parseShellRead("sed 's/a/b/' a.ts")).toBeUndefined()
  expect(resolvePath('/home', 'sub', 'a.ts')).toBe('/home/sub/a.ts')
})

test('ranges: inside a merged range is covered, past it is not', () => {
  expect(isCovered([[1, 200]], [50, 150])).toBe(true)
  expect(isCovered([[1, 100], [101, 300]], [80, 250])).toBe(true)
  expect(isCovered([[1, 100], [150, 300]], [80, 160])).toBe(false)
  expect(isCovered([], [1, 1])).toBe(false)
})

test('cat of a lockfile is blocked, a short head of it passes', async ($, on) => {
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('fs.stat', () => ({ value: STAT }) as never)
  on('tool.call', () => ({ result: 'text' }))
  expect((await $.tool.call({ tool: 'Bash', command: 'cd /r && cat pnpm-lock.yaml' })).deny).toContain('heavy file')
  expect((await $.tool.call({ tool: 'Bash', command: 'head -n 100 /r/pnpm-lock.yaml' })).deny).toBeUndefined()
})

test('a sub-range of a read, by Read or by cat, is refused once', async ($, on) => {
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('fs.stat', () => ({ value: STAT }) as never)
  on('tool.call', () => ({ result: 'text' }))
  expect((await $.tool.call({ tool: 'Read', file_path: '/p/b.ts', offset: 1, limit: 200 })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', file_path: '/p/b.ts', offset: 50, limit: 100 })).deny).toContain('already read')
  expect((await $.tool.call({ tool: 'Bash', command: 'cat /p/c.ts' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', file_path: '/p/c.ts' })).deny).toContain('already read')
  // rtk bypass: the first output was unusable, so the repeat goes through
  expect((await $.tool.call({ tool: 'Bash', command: 'cat /p/e.ts' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'rtk bypass cat /p/e.ts' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'cat /p/e.ts' })).deny).toContain('already read')
})

test('a read left behind by a compaction goes through even if session.compact never reached us', async ($, on) => {
  on('fs.stat', () => ({ value: STAT }) as never)
  on('tool.call', () => ({ result: 'text' }))
  let isCompacted = false
  on('session.messages', (_, e) =>
    ((e as { after?: string }).after
      ? { value: isCompacted ? { deny: 'left behind the last compaction' } : [] }
      : { value: [{ uuid: 'row-1' }] }) as never,
  )
  const read = () => $.tool.call({ tool: 'Read', file_path: '/p/d.ts' })
  expect((await read()).deny).toBeUndefined()
  isCompacted = true
  expect((await read()).deny).toBeUndefined()
})
