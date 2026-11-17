import { expect, test } from 'claude-code/testing'

const BIG = Array.from({ length: 40 }, (_, i) => `const x${i} = ${i}`).join('\n')

test('a big code change gets an automatic Chong Li review, a small one does not', async ($, on) => {
  const asked: string[] = []
  on('model.complete', (_, e) => {
    asked.push(String(e.prompt))
    return { value: { isAnswered: true, text: 'x.ts: quebra com lista vazia', usage: {} } } as never
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })

  // small change: no review
  await $.tool.call({ tool: 'Edit', file_path: '/p/y.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'ok' } as never)
  expect(asked.length).toBe(0)

  // big change: reviewed, the finding reaches the model with the next message
  await $.tool.call({ tool: 'Edit', file_path: '/p/x.ts', old_string: 'a', new_string: BIG })
  await $.turn.complete({ answer: 'ok' } as never)
  for (let i = 0; i < 50; i++) await Promise.resolve() // let the background review settle
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('const x39 = 39')
  await $.prompt.submit({ text: 'next' } as never)
  expect(context.join('\n')).toContain('x.ts: quebra com lista vazia')
})
