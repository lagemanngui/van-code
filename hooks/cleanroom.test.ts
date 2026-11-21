import { expect, test } from 'claude-code/testing'

import { caseMiss, declaredDeps, envVars, importSpecs, isDebug, isDocumented, packageOf } from './cleanroom.js'

test('clean-room helpers: debug lines, env vars, imports, packages, case', () => {
  expect(['console.log(x)', 'debugger', 'breakpoint()', 'dbg!(v)', 'logger.info(x)'].map(isDebug)).toEqual([true, true, true, true, false])
  expect(envVars(["const k = process.env.STRIPE_KEY ?? ''", "os.getenv('DB_URL')", 'if (process.env.NODE_ENV)', 'os.Getenv("API_TOKEN")'])).toEqual(['STRIPE_KEY', 'DB_URL', 'API_TOKEN'])
  expect(isDocumented('# keys\nSTRIPE_KEY=\nexport DB_URL=postgres://', 'DB_URL')).toBe(true)
  expect(isDocumented('STRIPE_KEY_OLD=1', 'STRIPE_KEY')).toBe(false)
  expect(importSpecs(["import { a } from './Button'", "const z = require('zod')", "import('lodash/merge')", "import './styles.css'"])).toEqual(['./Button', 'zod', 'lodash/merge', './styles.css'])
  expect(['@tanstack/react-query/devtools', 'lodash/merge', 'node:fs', 'fs', './x', '@/lib/a', '#internal'].map(packageOf)).toEqual(['@tanstack/react-query', 'lodash', undefined, undefined, undefined, undefined, undefined])
  expect([...declaredDeps('{"name":"app","dependencies":{"react":"18"},"devDependencies":{"vitest":"1"}}')]).toEqual(['react', 'vitest', 'app'])
  expect(caseMiss('Button', ['button.tsx', 'index.ts'])).toBe('button.tsx')
  expect(caseMiss('button', ['button.tsx'])).toBeUndefined()
  expect(caseMiss('Missing', ['button.tsx'])).toBeUndefined() // not there at all: tsc's job, not a case problem
})

test('at turn end, what the turn added and left in is reported; what it removed again is not', async ($, on) => {
  const files: Record<string, string> = {
    '/r/src/pay.ts': "import { Btn } from './Button'\nimport z from 'zod'\nconst key = process.env.STRIPE_KEY\nconst api = 'http://localhost:3000/api'\nconsole.log(key)",
    '/r/.env.example': 'DB_URL=\n',
    '/r/package.json': '{"dependencies":{"react":"18"}}',
  }
  on('fs.read', (_, e) => ({ value: files[(e as { path: string }).path] ?? '' }) as never)
  on('fs.stat', (_, e) => {
    if (!((e as { path: string }).path in files)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } } as never
  })
  on('fs.list', () => ({ value: [{ name: 'button.tsx', kind: 'file' }, { name: 'pay.ts', kind: 'file' }] }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('clock.every', () => ({ value: { cancel: () => {} } }) as never)
  on('clock.after', () => ({ value: { cancel: () => {} } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })

  await $.tool.call({ tool: 'Edit', file_path: '/r/src/pay.ts', old_string: 'x', new_string: `${files['/r/src/pay.ts']}\nconsole.debug('gone')` } as never)
  await $.turn.complete({ answer: 'done' } as never)
  for (let i = 0; i < 3000; i++) await Promise.resolve() // let the background check settle
  await $.prompt.submit({ text: 'next' } as never)
  const said = context.join('\n')
  expect(said).toContain('Clean-room check')
  expect(said).toContain("debug leftover `console.log(key)`")
  expect(said).not.toContain('gone') // added, then not in the file any more
  expect(said).toContain('hardcoded local URL')
  expect(said).toContain('env `STRIPE_KEY` not in .env.example')
  expect(said).toContain("imports `./Button` but the file is `button.tsx`")
  expect(said).toContain('imports `zod`, not declared in package.json')
})
