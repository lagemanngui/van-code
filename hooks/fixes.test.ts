import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const STAT = { kind: 'file', size: 4000, mtimeMs: 1, isLink: false }

function world(on: On, tscExit = 0) {
  let context: readonly string[] = []
  on('fs.stat', () => ({ value: STAT }) as never)
  on('process.run', () => ({ value: { exitCode: tscExit, stdout: '', stderr: '' } }) as never)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  on('command.run', () => ({ text: '' }))
  return { context: () => context.join('\n') }
}

const edit = { tool: 'Edit', file_path: '/p/src/a.ts', old_string: 'a', new_string: 'b' } as const

test('a clean type-check after an edit counts as verification', async ($, on) => {
  const w = world(on, 0)
  await $.tool.call(edit)
  await $.turn.complete({ answer: 'ok' } as never)
  await $.prompt.submit({ text: 'next' } as never)
  expect(w.context()).not.toContain('ran no test')
})

test("a subagent's turn end does not judge the main turn's edits", async ($, on) => {
  const w = world(on, 2) // tsc fails: the edit stays unverified
  await $.tool.call({ ...edit, agentId: 'a1' } as never)
  await $.turn.complete({ answer: 'ok', agentId: 'a1' } as never)
  await $.prompt.submit({ text: 'mid-turn' } as never)
  expect(w.context()).not.toContain('ran no test')
  await $.turn.complete({ answer: 'ok' } as never)
  await $.prompt.submit({ text: 'next' } as never)
  expect(w.context()).toContain('ran no test')
})

test('a clean syntax check of a file no test reaches counts as verification', async ($, on) => {
  const w = world(on, 0) // bash -n passes, git grep finds no importer
  await $.tool.call({ tool: 'Edit', file_path: '/p/run-all.sh', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'ok' } as never)
  for (let i = 0; i < 50; i++) await Promise.resolve() // the test search runs after the turn
  await $.prompt.submit({ text: 'next' } as never)
  expect(w.context()).not.toContain('ran no test')
})

test('a failed syntax check of an untested file still asks to verify', async ($, on) => {
  const w = world(on, 2)
  await $.tool.call({ tool: 'Edit', file_path: '/p/run-all.sh', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'ok' } as never)
  for (let i = 0; i < 50; i++) await Promise.resolve()
  await $.prompt.submit({ text: 'next' } as never)
  expect(w.context()).toContain('ran no test')
})

test('the scoreboard counts a skipped repeat read', async ($, on) => {
  world(on)
  const read = () => $.tool.call({ tool: 'Read', file_path: '/p/a.ts' })
  await read()
  await read()
  const r = await $.command.run({ command: 'van-code-stats', args: '' } as never)
  expect(String(r.text)).toContain('Repeat reads skipped: 1 (~1.0k tokens)')
})

test('read memory off: repeat reads go through', { options: { readMemory: false } }, async ($, on) => {
  world(on)
  const read = () => $.tool.call({ tool: 'Read', file_path: '/p/a.ts' })
  await read()
  expect((await read()).deny).toBeUndefined()
})

test('after installing a plugin, setup reloads the plugins by itself', async ($, on) => {
  const clock = mock.clock(on)
  const ran: string[] = []
  let isInstalled = false
  on('fs.stat', () => ({ value: STAT }) as never)
  on('settings.read', () => ({ value: { BASH_MAX_OUTPUT_LENGTH: '1', MAX_MCP_OUTPUT_TOKENS: '1' } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    if (argv.includes('plugin install commit-commands')) isInstalled = true
    if (argv === 'claude plugin list --json') {
      const list = [{ id: 'ponytail@ponytail', enabled: true }]
      if (isInstalled) list.push({ id: 'commit-commands@claude-plugins-official', enabled: true })
      return { value: { exitCode: 0, stdout: JSON.stringify(list), stderr: '' } } as never
    }
    // rtk shows its hook; everything else succeeds quietly
    return { value: { exitCode: 0, stdout: argv.startsWith('rtk') ? '[ok] settings.json' : '', stderr: '' } } as never
  })
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  const r = await $.command.run({ command: 'van-code-setup', args: 'commit-commands' } as never)
  expect(String(r.text)).toContain('commit-commands: installed')
  await clock.advance(1_000)
  expect(ran).toContain('reload-plugins')
})
