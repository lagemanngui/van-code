import { expect, test } from 'claude-code/testing'

import { outline } from './outline.js'

test('the outline lists declarations with ranges, and skips control flow and comments', () => {
  const ts = [
    'import x from "y"',
    'export function a(n: number) {',
    '  if (n) {',
    '    return 1',
    '  }',
    '}',
    '// function notMe() {',
    'export class B {',
    '  async run(x: string): Promise<void> {',
    '  }',
    '}',
    'export const c = async (s: string) => s',
  ].join('\n')
  expect(outline(ts)).toEqual([
    'L2-7  export function a(n: number)',
    'L8-11  export class B',
    'L9-11  async run(x: string): Promise<void>',
    'L12-12  export const c = async (s: string) => s',
  ])
  expect(outline('class A:\n    def f(self):\n        pass\n\ndef g():\n    pass')).toEqual(['L1-4  class A:', 'L2-4  def f(self):', 'L5-6  def g():'])
  expect(outline('package x\n\nfunc (s *S) Do() error {\n}\ntype S struct {\n}')).toEqual(['L3-4  func (s *S) Do() error', 'L5-6  type S struct'])
})

test('a whole read of a big code file gets its outline once; slices and insisting go through', async ($, on) => {
  const big = Array.from({ length: 500 }, (_, i) => (i % 100 === 0 ? `export function f${i}() {` : '  x()')).join('\n')
  on('fs.stat', () => ({ value: { kind: 'file', size: big.length, mtimeMs: 1, isLink: false } }) as never)
  on('fs.read', () => ({ value: big }) as never)
  on('tool.call', () => ({ result: 'text' }))

  const first = await $.tool.call({ tool: 'Read', file_path: '/p/big.ts' })
  expect(first.deny).toContain('L101-200  export function f100()')
  expect((await $.tool.call({ tool: 'Read', file_path: '/p/big.ts' })).deny).toBeUndefined() // insisted
  expect((await $.tool.call({ tool: 'Read', file_path: '/p/other.ts', offset: 100, limit: 50 })).deny).toBeUndefined()
})
