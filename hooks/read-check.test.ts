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
  const r = await $.command.run({ command: 'van-code:stats', args: '' } as never)
  expect(String(r.text)).toContain("read 1 ·")
})

test('a file read whole that changed since comes back as its diff once; asking again goes through', async ($, on) => {
  let mtime = 1
  const v1 = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
  const v2 = v1.replace('line 100', 'line 100 changed')
  on('fs.stat', () => ({ value: { kind: 'file', size: 2000, mtimeMs: mtime, isLink: false } }) as never)
  on('fs.read', () => ({ value: mtime === 1 ? v1 : v2 }) as never)
  on('session.messages', () => ({ value: [{ uuid: 'u1' }] }) as never)
  on('process.run', (_, e) => {
    const isDiff = e.argv[0] === 'diff'
    return { value: { exitCode: isDiff ? 1 : 0, stdout: isDiff ? '--- your last read\n+++ now\n@@ -101 +101 @@\n-line 100\n+line 100 changed\n' : '', stderr: '' } } as never
  })
  on('tool.call', () => ({ result: 'text' }))

  const read = () => $.tool.call({ tool: 'Read', file_path: '/p/big.ts' })
  expect((await read()).deny).toBeUndefined()
  mtime = 2 // a formatter touched it
  const delta = await read()
  expect(delta.deny).toContain('changed since you read it whole')
  expect(delta.deny).toContain('+line 100 changed')
  expect((await read()).deny).toBeUndefined() // insisting goes through
})

test('after a diff re-read, lines past the first 2,000 are still unread', async ($, on) => {
  let mtime = 1
  const v1 = Array.from({ length: 3000 }, (_, i) => `row ${i}`).join('\n')
  on('fs.stat', () => ({ value: { kind: 'file', size: 30_000, mtimeMs: mtime, isLink: false } }) as never)
  on('fs.read', () => ({ value: mtime === 1 ? v1 : v1.replace('row 10', 'row 10 changed') }) as never)
  on('session.messages', () => ({ value: [{ uuid: 'u1' }] }) as never)
  on('process.run', (_, e) => ({ value: { exitCode: e.argv[0] === 'diff' ? 1 : 0, stdout: '--- your last read\n+++ now\n@@ -11 +11 @@\n-row 10\n+row 10 changed\n', stderr: '' } }) as never)
  on('tool.call', () => ({ result: 'text' }))

  expect((await $.tool.call({ tool: 'Read', file_path: '/p/big.txt' })).deny).toBeUndefined() // lines 1-2000
  mtime = 2
  expect((await $.tool.call({ tool: 'Read', file_path: '/p/big.txt' })).deny).toContain('changed since you read it whole')
  await $.tool.call({ tool: 'Read', file_path: '/p/big.txt', offset: 1, limit: 100 }) // goes through, and re-arms the repeat guard
  expect((await $.tool.call({ tool: 'Read', file_path: '/p/big.txt', offset: 2001, limit: 200 })).deny).toBeUndefined()
})

test('a whole read keeps the text only of a file a diff can apply to', async ($, on) => {
  const read: string[] = []
  on('fs.stat', () => ({ value: STAT }) as never)
  on('fs.read', (_, e) => {
    read.push((e as { path: string }).path)
    return { value: 'x' } as never
  })
  on('tool.call', () => ({ result: 'text' }))
  await $.tool.call({ tool: 'Read', file_path: '/p/scan.png' })
  await $.tool.call({ tool: 'Read', file_path: '/p/a.txt' })
  expect(read).toEqual(['/p/a.txt'])
})

test('read memory off: no text kept', { options: { readMemory: false } }, async ($, on) => {
  const read: string[] = []
  on('fs.stat', () => ({ value: STAT }) as never)
  on('fs.read', (_, e) => {
    read.push((e as { path: string }).path)
    return { value: 'x' } as never
  })
  on('tool.call', () => ({ result: 'text' }))
  await $.tool.call({ tool: 'Read', file_path: '/p/a.txt' })
  expect(read).toEqual([])
})
