import { expect, test } from 'claude-code/testing'

import { bar, left, prettyModel } from './usage'

test('countdown formats', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  expect(left('2026-01-01T02:30:00Z', now)).toBe('2h30m')
  expect(left('2026-01-03T05:00:00Z', now)).toBe('2d5h')
  expect(left('2026-01-01T00:04:00Z', now)).toBe('4m')
  expect(left(undefined, now)).toBe('?')
})

test('bar always 10 cells', () => {
  for (const p of [0, 3, 42, 99.9, 100, 130]) expect(bar(p).join('').length).toBe(10)
  expect(bar(50)).toEqual(['█████', '·····'])
})

test('model name', () => {
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('custom')).toBe('custom')
})
