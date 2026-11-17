import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

function world(on: On) {
  const clock = mock.clock(on)
  const suggested: string[] = []
  on('model.complete', () => ({ value: { isAnswered: true, text: '"pode fazer"\nextra', usage: {} } }) as never)
  on('prompt.suggest', (_, e) => {
    suggested.push(e.text)
    return { isShown: true }
  })
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  return { clock, suggested }
}

test('with no engine suggestion, the mod proposes one after the turn', async ($, on) => {
  const { clock, suggested } = world(on)
  await $.prompt.submit({ text: 'faz o 3' } as never)
  await $.turn.complete({ answer: 'Feito. Quer que eu faça o 4?' } as never)
  await clock.advance(5_000)
  expect(suggested).toEqual(['pode fazer'])
})

test("the engine's own suggestion wins", async ($, on) => {
  const { clock, suggested } = world(on)
  await $.prompt.submit({ text: 'faz o 3' } as never)
  await $.turn.complete({ answer: 'Feito.' } as never)
  await $.prompt.suggest({ text: 'roda os testes', origin: { kind: 'suggestion' } } as never)
  await clock.advance(5_000)
  expect(suggested).toEqual(['roda os testes'])
})

test('a suggestion repeating the last command is dropped, and ours fills in', async ($, on) => {
  const { clock, suggested } = world(on)
  on('command.run', () => ({ text: 'ok' }))
  await $.command.run({ command: 'ponytail:ponytail', args: 'full' } as never)
  await $.turn.complete({ answer: 'Ponytail no full.' } as never)
  await $.prompt.suggest({ text: '/ponytail:ponytail full', origin: { kind: 'suggestion' } } as never)
  await clock.advance(5_000)
  expect(suggested).toEqual(['pode fazer'])
})

