import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { namedTests, reachesAny } from './checks.js'

const TOOL = 'mcp__van-code__assumptions'

function world(on: On, grep: (argv: string) => string) {
  let context: readonly string[] = []
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    // each repo answers rev-parse with its own root
    const out = argv.includes('rev-parse') ? `${argv.match(/-C (\/[a-z]+)/)?.[1] ?? '/p'}\n` : grep(argv)
    return { value: { exitCode: out ? 0 : 1, stdout: out, stderr: '' } } as never
  })
  on('tool.call', () => ({ result: {} }))
  // auth.ts is a risky area: Chong Li reviews it, and finds nothing
  on('model.complete', () => ({ value: { isAnswered: true, text: '', usage: {} } }) as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  return { context: () => context.join('\n') }
}
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

test('test files named by a command, matched by path suffix', () => {
  expect(namedTests('npx vitest run tests/a.test.ts --reporter dot')).toEqual(['tests/a.test.ts'])
  expect(namedTests('pytest tests/test_api.py::test_x -q')).toEqual(['tests/test_api.py'])
  expect(namedTests('npm test')).toEqual([])
  expect(reachesAny(['./tests/a.test.ts'], ['/p/tests/a.test.ts'])).toBe(true)
  expect(reachesAny(['tests/b.test.ts'], ['/p/tests/a.test.ts'])).toBe(false)
})

test('targets: an edit inside a repo target reaches it, a done claim with one open is flagged', async ($, on) => {
  const w = world(on, () => '')
  const r = await $.tool.call({ tool: TOOL, reset: true, targets: ['/api/', '/web', 'billing events schema'] } as never)
  expect(String(r.result)).toContain('T1 [OPEN] /api')

  await $.tool.call({ tool: 'Edit', file_path: '/api/src/a.ts', old_string: 'a', new_string: 'b' } as never)
  const l = await $.tool.call({ tool: TOOL, mark: [{ id: 3, state: 'na', note: 'no field changed' }] } as never)
  expect(String(l.result)).toContain('T1 [DONE] /api (edited src/a.ts)')
  expect(String(l.result)).toContain('T3 [N/A] billing events schema (no field changed)')

  await $.turn.complete({ answer: 'Pronto, feito.' } as never)
  await settle()
  await $.prompt.submit({ text: 'next' } as never)
  expect(w.context()).toContain('T2 /web')
  expect(w.context()).not.toContain('T1 /api')
})

test('a test run that does not reach the edited code is not proof; one that does is', async ($, on) => {
  // /p/src/auth.ts <- /p/tests/auth.test.ts; /p/tests/other.test.ts reaches nothing edited
  const w = world(on, argv => (argv.includes(')?auth(') ? 'tests/auth.test.ts\n' : ''))
  const edit = { tool: 'Edit', file_path: '/p/src/auth.ts', old_string: 'a', new_string: 'b' } as never

  await $.tool.call(edit)
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run tests/other.test.ts' } as never)
  await $.turn.complete({ answer: 'ok' } as never)
  await settle()
  await $.prompt.submit({ text: 'next' } as never)
  expect(w.context()).toContain('ran only tests/other.test.ts')
  expect(w.context()).toContain('tests/auth.test.ts')

  await $.tool.call(edit)
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run tests/auth.test.ts' } as never)
  await $.turn.complete({ answer: 'ok' } as never)
  await settle()
  await $.prompt.submit({ text: 'again' } as never)
  expect(w.context()).not.toContain('ran only')
  expect(w.context()).not.toContain('ran no test')
})

test('affected tests are searched in the repo of each file', async ($, on) => {
  world(on, argv => (argv.includes('-C /web grep') && argv.includes(')?client(') ? 'test/client.test.ts\n' : ''))
  const r = await $.tool.call({ tool: 'mcp__van-code__affected_tests', files: ['/api/src/server.ts', '/web/src/client.ts'] } as never)
  expect(String(r.result)).toContain('In /web:\ntest/client.test.ts')
})
