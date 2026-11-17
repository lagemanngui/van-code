import { expect, test } from 'claude-code/testing'

const TOOL = 'mcp__van-code__affected_tests'

test('affected_tests follows imports up to the tests', async ($, on) => {
  // a fake repo: src/auth.ts <- src/login.ts <- tests/login.test.ts
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    const out = argv.includes('rev-parse')
      ? '/p\n'
      : argv.includes(")?auth(")
        ? 'src/login.ts\n'
        : argv.includes(')?login(')
          ? 'tests/login.test.ts\n'
          : ''
    return { value: { exitCode: out ? 0 : 1, stdout: out, stderr: '' } } as never
  })
  const r = await $.tool.call({ tool: TOOL, files: ['/p/src/auth.ts'] } as never)
  expect(String(r.result)).toContain('tests/login.test.ts')
  expect(String(r.result)).not.toContain('src/login.ts\n')
})
