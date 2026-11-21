import { expect, test } from 'claude-code/testing'

import { checkReceipts, hashesIn } from './receipts.js'

const seen = new Set(hashesIn('ok main\n   7a056df..edc0fa1  main -> main\nedc0fa1 Version 0.4.6'))

test('a test count that differs from the last run of the turn is flagged', () => {
  const output = ' 76 pass\n 1 fail\n ... later ...\n 77 pass\n 0 fail'
  expect(checkReceipts('Os 77 testes passam.', output, seen)).toEqual([])
  expect(checkReceipts('All 76 tests pass.', output, seen)).toEqual(['"76 tests pass", but the last test run of this turn printed "77 pass"'])
  expect(checkReceipts('Os 76 testes passam.', '', seen)).toEqual([]) // no run with a count this turn: nothing to contradict
})

test('a commit hash no tool output showed is flagged; one it showed passes', () => {
  expect(checkReceipts('Pushed as `edc0fa1`.', '', seen)).toEqual([])
  expect(checkReceipts('Pushed as `deadbee`.', '', seen)).toEqual(['commit `deadbee`, which no tool output in this session showed'])
  expect(checkReceipts('Took `1234567` ms.', '', seen)).toEqual([]) // digits only: not a hash
})

test('a contradicted claim reaches Claude on the next message', async ($, on) => {
  let context: readonly string[] = []
  on('tool.call', () => ({ result: {}, text: ' 76 pass\n 0 fail' }) as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  await $.tool.call({ tool: 'Bash', command: 'claude plugin test .' } as never)
  await $.turn.complete({ answer: 'Done: 77 tests pass.' } as never)
  await $.prompt.submit({ text: 'next' } as never)
  expect(context.join('\n')).toContain('Receipts: your last answer claimed "77 tests pass"')
  // the turn's output starts over: the same claim next turn, with no run, is not judged again
  await $.turn.complete({ answer: 'Still 77 tests pass.' } as never)
  await $.prompt.submit({ text: 'again' } as never)
  expect(context.join('\n')).not.toContain('Receipts')
})

test('a count read from a source file is not a test run', async ($, on) => {
  let context: readonly string[] = []
  on('tool.call', () => ({ result: {}, text: '// `76 pass`, `5 passed`, `12 passing`' }) as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  await $.tool.call({ tool: 'Bash', command: 'rg -n RUN_COUNT hooks/receipts.ts' } as never)
  await $.turn.complete({ answer: 'If I write "91 testes passam" and the run printed another number, it flags it.' } as never)
  await $.prompt.submit({ text: 'next' } as never)
  expect(context.join('\n')).not.toContain('Receipts')
})

test('a hash the repository has is real, even when no output this session showed it (a reload forgets them)', async ($, on) => {
  let context: readonly string[] = []
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  on('process.run', (_, e) => ({ value: { exitCode: e.argv.join(' ').includes('87ec976') ? 0 : 1, stdout: '', stderr: '' } }) as never)
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  await $.turn.complete({ answer: 'Pushed `87ec976` and `deadbee`.' } as never)
  await $.prompt.submit({ text: 'next' } as never)
  const said = context.join('\n')
  expect(said).not.toContain('`87ec976`')
  expect(said).toContain('commit `deadbee`')
})
