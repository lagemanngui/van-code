import { expect, test } from 'claude-code/testing'

import { fixesRemoved, parseBlame, removedLines } from './archaeology.js'

const H1 = 'a'.repeat(40)
const H2 = 'b'.repeat(40)
const BLAME = [
  `${H1} 10 10 2`, 'author x', 'summary Prevent refresh race in mobile clients (#482)', 'filename a.ts', '\tif (inFlight) return inFlight',
  `${H1} 11 11`, '\tconst grace = 30_000',
  `${H2} 12 12 1`, 'author y', 'summary Rename helpers', 'filename a.ts', '\treturn refresh()',
].join('\n')

test('the fix commits behind the removed lines are found; renames and kept lines are not', () => {
  const removed = removedLines('if (inFlight) return inFlight\nconst grace = 30_000\nreturn refresh()', 'return refresh()')
  expect([...removed]).toEqual(['if (inFlight) return inFlight', 'const grace = 30_000'])
  expect([...removedLines('}\n);\ngo()', '')]).toEqual(['go()'])
  expect(fixesRemoved(parseBlame(BLAME), removed)).toEqual([{ hash: 'aaaaaaa', summary: 'Prevent refresh race in mobile clients (#482)', lines: [10, 11] }])
  // a merge's PR number is not a fix
  expect(fixesRemoved(parseBlame(BLAME.replace('Prevent refresh race in mobile clients (#482)', 'Merge pull request #12 from x/y')), removed)).toEqual([])
  // the rename commit owns a removed line, but it is not a fix
  expect(fixesRemoved(parseBlame(BLAME), new Set(['return refresh()']))).toEqual([])
})

test('an edit removing a fix line gets the fix commit on its result, once', async ($, on) => {
  const file = Array.from({ length: 9 }, (_, i) => `line ${i}`).concat(['if (inFlight) return inFlight', 'const grace = 30_000', 'return refresh()']).join('\n')
  on('fs.read', () => ({ value: file }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  const asked: string[] = []
  on('process.run', (_, e) => {
    asked.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: e.argv.includes('blame') ? BLAME : '', stderr: '' } } as never
  })
  on('tool.call', () => ({ result: {} }))
  const edit = () => $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'if (inFlight) return inFlight\nconst grace = 30_000', new_string: '' } as never)

  const ran = await edit()
  expect(asked.some(a => a.includes('blame -L 10,11'))).toBe(true)
  expect((ran.context ?? []).join('\n')).toContain('`aaaaaaa` "Prevent refresh race in mobile clients (#482)" (L10-11)')
  expect(((await edit()).context ?? []).join('\n')).not.toContain('Archaeology') // told once
})

test('"fix" counts when it leads the summary, not mid-sentence', () => {
  const row = (summary: string) => ({ hash: 'a'.repeat(40), summary, line: 1, text: 'guard()' })
  const removed = new Set(['guard()'])
  expect(fixesRemoved([row('fix: empty input crashed')], removed)).toHaveLength(1)
  expect(fixesRemoved([row('Fix the retry loop')], removed)).toHaveLength(1)
  expect(fixesRemoved([row('feat(api)!: fix duplicate events')], removed)).toHaveLength(1)
  expect(fixesRemoved([row('Log shows what was fixed or kept')], removed)).toHaveLength(0)
  expect(fixesRemoved([row('Handle the race in the consumer')], removed)).toHaveLength(1)
})
