import { expect, test } from 'claude-code/testing'

test('after a compaction the user words and the ledger come back with the next tool result', async ($, on) => {
  let told = ''
  on('session.compact', (_, e) => {
    told = e.instructions ?? ''
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)

  await $.prompt.submit({ text: 'never touch the billing repo' } as never)
  await $.tool.call({ tool: 'mcp__van-code__assumptions', reset: true, add: ['api v2 is live'] } as never)
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'old', toolUses: [] }] } as never)
  expect(told).toContain('word for word')

  const after = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  const ctx = (after.context ?? []).join('\n')
  expect(ctx).toContain('> never touch the billing repo')
  expect(ctx).toContain('#1 [OPEN] api v2 is live')
  // handed over once
  expect(((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).context ?? []).join('\n')).not.toContain('billing')
})
