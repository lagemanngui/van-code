import { expect, test } from 'claude-code/testing'

const TOOL = 'mcp__van-code__assumptions'

test('the ledger records, verifies and resets assumptions', async $ => {
  // the registered tool's name is not in the typed tool list, hence the cast
  const call = (input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as never)
  const first = await call({ reset: true, add: ['A holds', 'B holds'] })
  expect(String(first.result)).toContain('#1 [OPEN] A holds')

  const checked = await call({
    verify: [
      { id: 1, holds: true, evidence: 'read the types' },
      { id: 2, holds: false, evidence: 'grep found 3 callers' },
    ],
  })
  expect(String(checked.result)).toContain('#1 [HOLDS] A holds (evidence: read the types)')
  expect(String(checked.result)).toContain('#2 [FALSE] B holds')

  const fresh = await call({ reset: true })
  expect(String(fresh.result)).toBe('Ledger is empty.')
})
