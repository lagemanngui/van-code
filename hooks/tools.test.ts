import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// `which <bin>` succeeds for the binaries given; every other command succeeds quietly.
function world(on: On, bins: string[], size = 10, run?: (argv: readonly string[]) => number | { exitCode: number; stdout: string } | undefined) {
  on('fs.stat', () => ({ value: { kind: 'file', size, mtimeMs: 1, isLink: false } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '/d' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [], cost: { usd: 1 } } }) as never)
  on('command.run', () => ({ text: '' }))
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    const ok = e.argv[0] === 'which' ? bins.includes(e.argv[1]!) : true
    const code = run?.(e.argv)
    if (typeof code === 'object') return { value: { ...code, stderr: '' } } as never
    if (code !== undefined) return { value: { exitCode: code, stdout: '/p/x.sh:3:5: warning: Quote this to prevent word splitting. [SC2046]', stderr: '' } } as never
    return { value: { exitCode: ok ? 0 : 1, stdout: argv.includes('plugin list') ? '[]' : '', stderr: '' } } as never
  })
}

test('a big JSON is pointed to jq once, by Read or by cat', async ($, on) => {
  world(on, ['jq'], 100_000)
  on('tool.call', () => ({ result: '{}' }))
  await $.command.run({ command: 'van-code', args: '' } as never)
  for (let i = 0; i < 200; i++) await Promise.resolve() // the equipment check runs in the background
  const read = () => $.tool.call({ tool: 'Read', file_path: '/d/data.json' })
  expect((await read()).deny).toContain('jq keys')
  expect((await read()).deny).toBeUndefined() // insisting goes through
  expect((await $.tool.call({ tool: 'Bash', command: 'cat /d/other.json' } as never)).deny).toContain('jq')
})

test('related commands failing three times in a row are called a loop', async ($, on) => {
  world(on, [])
  on('tool.call', (_, e) => ({ result: {}, text: (e as { command: string }).command.includes('build') ? 'tsc: 2 errors' : 'Error: ECONNREFUSED 127.0.0.1:5432', isError: true }) as never)
  const run = (command: string) => $.tool.call({ tool: 'Bash', command } as never)
  const note = async (command: string) => ((await run(command)).context ?? []).join()
  expect(await note('npm test')).not.toContain('in a row')
  await run('npm run build') // an unrelated failure restarts the streak
  await run('npm test')
  await run('DATABASE_URL=x npm test')
  const said = await note('docker compose up db') // other tool, same error
  expect(said).toContain('3 related commands failed in a row')
  expect(said).toContain('`DATABASE_URL=x npm test` → Error: ECONNREFUSED')
})

test('discarding uncommitted work is refused once, with the files that would be lost', async ($, on) => {
  let porcelain = ' M src/a.ts'
  world(on, [], 10, argv => (argv[0] === 'git' && argv[1] === 'status' ? { exitCode: 0, stdout: porcelain } : undefined))
  on('tool.call', () => ({ result: '' }))
  const run = (command: string) => $.tool.call({ tool: 'Bash', command } as never)
  expect((await run('git reset --hard')).deny).toContain('src/a.ts')
  expect((await run('git reset --hard')).deny).toBeUndefined() // insisting goes through
  porcelain = ''
  expect((await run('git clean -fd')).deny).toBeUndefined() // a clean tree has nothing to lose
  expect((await run('git push --force')).deny).toContain('force')
})

test('shellcheck findings come back after a shell edit when it is installed', async ($, on) => {
  world(on, ['shellcheck'], 10, argv => (argv[0] === 'shellcheck' ? 1 : undefined))
  on('tool.call', () => ({ result: {} }))
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/p/x.sh', old_string: 'a', new_string: 'b' })
  expect((ran.context ?? []).join('\n')).toContain('SC2046')
})

test('the scoreboard shows what the last request cost and did', async ($, on) => {
  world(on, [])
  on('tool.call', () => ({ result: 'ok' }))
  await $.prompt.submit({ text: 'do it' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.turn.complete({ answer: 'done' } as never)
  for (let i = 0; i < 20; i++) await Promise.resolve()
  const r = await $.command.run({ command: 'van-code:stats', args: '' } as never)
  expect(String(r.text)).toContain('Last request: ~US$ 0.00, 1 tool calls')
  // the average is over this mod's own requests, not the engine's whole-session total
  expect(String(r.text)).toContain('Average per request: ~US$ 0.00 over 1')
})
