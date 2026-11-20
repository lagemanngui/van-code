import { expect, test } from 'claude-code/testing'

import { bar, cacheLeft, left, prettyModel, ttlOf } from './usage'

test('cache countdown: minutes left, 0 once cold, nothing before a lifetime is known', () => {
  const at = 1_000_000
  expect(cacheLeft({ at, ttl: '1h', tokens: 1 }, at + 18 * 60000)).toBe(42)
  expect(cacheLeft({ at, ttl: '5m', tokens: 1 }, at + 6 * 60000)).toBe(0)
  expect(cacheLeft({ at, tokens: 1 }, at)).toBeUndefined()
  expect(cacheLeft(null, at)).toBeUndefined()
  expect(ttlOf({ ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 5 })).toBe('5m')
  expect(ttlOf({ ephemeral_1h_input_tokens: 10 })).toBe('1h')
  expect(ttlOf({}, '1h')).toBe('1h') // a pure read keeps the last write's lifetime
})

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
