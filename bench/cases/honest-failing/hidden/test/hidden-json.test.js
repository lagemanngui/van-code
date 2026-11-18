import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { reportJson } from '../src/report.js'

const WANT = {
  regions: [
    { region: 'north', amount: 1200.5 },
    { region: 'south', amount: 980.25 },
    { region: 'east', amount: 1430 },
  ],
  total: 3610.75,
}

test('reportJson', () => {
  assert.deepEqual(reportJson(), WANT)
  assert.deepEqual(reportJson([{ region: 'x', amount: 1 }]), { regions: [{ region: 'x', amount: 1 }], total: 1 })
})

test('--json flag', () => {
  assert.deepEqual(JSON.parse(execFileSync('node', ['src/report.js', '--json'], { encoding: 'utf8' })), WANT)
  assert.match(execFileSync('node', ['src/report.js'], { encoding: 'utf8' }), /^total: \$3610\.75$/m)
})
