import { expect, test } from 'claude-code/testing'

const STAT = { kind: 'file', size: 10, mtimeMs: 1, isLink: false }

test('an unchanged repeat read is refused once, then goes through', async ($, on) => {
  on('fs.stat', () => ({ value: STAT }) as never)
  on('tool.call', () => ({ result: 'file text' }))

  const read = () => $.tool.call({ tool: 'Read', file_path: '/p/a.ts' })
  expect((await read()).deny).toBeUndefined()
  expect((await read()).deny).toContain('already read /p/a.ts')
  expect((await read()).deny).toBeUndefined() // insisting goes through
})

test('a broken shell script edit gets the checker errors back', async ($, on) => {
  on('fs.stat', () => ({ value: STAT }) as never)
  on('tool.call', () => ({ result: {} }))
  on('process.run', (_, e) =>
    (e.argv[0] === 'bash'
      ? { value: { exitCode: 2, stdout: '', stderr: '/p/x.sh: line 3: syntax error' } }
      : { value: { exitCode: 0, stdout: '', stderr: '' } }) as never,
  )

  const ran = await $.tool.call({ tool: 'Edit', file_path: '/p/x.sh', old_string: 'a', new_string: 'b' })
  expect((ran.context ?? []).join('\n')).toContain('line 3: syntax error')
})

test('a big log is heavy, a small one reads whole, and insisting past a refusal is counted', async ($, on) => {
  on('fs.stat', (_, e) => ({ value: { ...STAT, size: (e as { path: string }).path.includes('big') ? 500_000 : 10 } }) as never)
  on('tool.call', () => ({ result: 'file text' }))
  on('command.run', () => ({ text: '' }))
  on('session.cwd', () => ({ value: '/p' }) as never)

  expect((await $.tool.call({ tool: 'Read', file_path: '/p/big.log' })).deny).toContain('wc -l')
  expect((await $.tool.call({ tool: 'Bash', command: 'cat /p/big.csv' } as never)).deny).toContain('duckdb')
  expect((await $.tool.call({ tool: 'Read', file_path: '/p/small.log' })).deny).toBeUndefined()
  await $.tool.call({ tool: 'Read', file_path: '/p/small.log' }) // refused as a repeat
  await $.tool.call({ tool: 'Read', file_path: '/p/small.log' }) // insisted
  const r = await $.command.run({ command: 'van-code-stats', args: '' } as never)
  expect(String(r.text)).toContain("read 1 ·")
})
