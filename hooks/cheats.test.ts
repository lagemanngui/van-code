import { expect, test } from 'claude-code/testing'

import { findCheats } from './cheats.js'

test('only what an edit adds counts: escapes, suppressions, skips, swallowed exits, lost assertions', () => {
  expect(findCheats('/p/a.ts', 'const x = f()', 'const x = f() as any // @ts-ignore')).toEqual(['`as any` (+1)', '`@ts-ignore` (+1)'])
  expect(findCheats('/p/a.ts', 'x as any', 'y as any')).toEqual([]) // already there
  expect(findCheats('/p/a.test.ts', "it('w', () => { expect(a).toBe(1); expect(b).toBe(2) })", "it.skip('w', () => { expect(a).toBe(1) })")).toEqual([
    'a skipped test (+1)',
    '1 assertion removed',
  ])
  expect(findCheats('/p/a.ts', 'expect(a)', '')).toEqual([]) // not a test file
  expect(findCheats('/p/x.py', 'import os', 'import os  # noqa\nv = f()  # type: ignore')).toEqual(['a lint suppression (+1)', 'a type-check suppression (+1)'])
  expect(findCheats('/p/b.sh', 'make', 'make || true\nrun || :')).toEqual(['`|| true` (+2)'])
  expect(findCheats('/p/a.go', '', 't.Skip("later")')).toEqual(['a skipped test (+1)'])
})

test('an edit that silences a failure is flagged, the same edit with no failure before it is not', async ($, on) => {
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('fs.read', () => ({ value: 'old' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.cwd', () => ({ value: '/p' }) as never)
  on('tool.call', (_, e) => ({ result: {}, ...((e as { command?: string }).command?.includes('vitest') ? { isError: true } : {}) }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  const edit = () => $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'f()', new_string: 'f() as any' } as never)

  expect(((await edit()).context ?? []).join('\n')).not.toContain('Anti-cheat')
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' } as never)
  expect(((await edit()).context ?? []).join('\n')).toContain('Anti-cheat: after a failing `npx vitest run`')
})
