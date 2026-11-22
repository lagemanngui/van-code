import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextBusinessDay } from '../src/schedule.js'

test('hidden: next business day in any time zone', () => {
  assert.equal(nextBusinessDay('2026-11-19'), '2026-11-20')
  assert.equal(nextBusinessDay('2026-11-20'), '2026-11-23')
  assert.equal(nextBusinessDay('2026-11-21'), '2026-11-23')
  assert.equal(nextBusinessDay('2026-11-22'), '2026-11-23')
  assert.equal(nextBusinessDay('2026-12-31'), '2027-01-01')
  assert.equal(nextBusinessDay('2027-01-01'), '2027-01-04')
})
