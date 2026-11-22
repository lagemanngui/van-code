import { expect, test } from 'claude-code/testing'

import { caseMiss, declaredDeps, envVars, importSpecs, isAlias, isDebug, isDocumented, isIoCall, isPiiLog, isUnbounded, loopAround, packageOf } from './cleanroom.js'

test('clean-room helpers: debug lines, env vars, imports, packages, case', () => {
  expect(['logger.info(req.body)', "log.error('bad', event.payload)", 'console.log({ password })', "logger.error('invalid token')", 'logger.info(order.id)', 'const token = req.headers.authorization'].map(isPiiLog)).toEqual([true, true, true, false, false, false])
  expect(['console.log(x)', 'debugger', 'breakpoint()', 'dbg!(v)', 'logger.info(x)'].map(isDebug)).toEqual([true, true, true, true, false])
  expect(envVars(["const k = process.env.STRIPE_KEY ?? ''", "os.getenv('DB_URL')", 'if (process.env.NODE_ENV)', 'os.Getenv("API_TOKEN")'])).toEqual(['STRIPE_KEY', 'DB_URL', 'API_TOKEN'])
  expect(isDocumented('# keys\nSTRIPE_KEY=\nexport DB_URL=postgres://', 'DB_URL')).toBe(true)
  expect(isDocumented('STRIPE_KEY_OLD=1', 'STRIPE_KEY')).toBe(false)
  expect(importSpecs(["import { a } from './Button'", "const z = require('zod')", "import('lodash/merge')", "import './styles.css'"])).toEqual(['./Button', 'zod', 'lodash/merge', './styles.css'])
  expect(['@tanstack/react-query/devtools', 'lodash/merge', 'node:fs', 'fs', './x', '@/lib/a', '#internal'].map(packageOf)).toEqual(['@tanstack/react-query', 'lodash', undefined, undefined, undefined, undefined, undefined])
  expect([...declaredDeps('{"name":"app","dependencies":{"react":"18"},"devDependencies":{"vitest":"1"}}')]).toEqual(['react', 'vitest', 'app'])
  const tsconfig = '{ "compilerOptions": { "paths": { "@app/*": ["src/*"], "shared": ["lib/shared"] } } }'
  expect(['@app/utils', 'shared', '@tanstack/react-query', 'zod'].map(p => isAlias(p, tsconfig))).toEqual([true, true, false, false])
  expect(caseMiss('Button', ['button.tsx', 'index.ts'])).toBe('button.tsx')
  expect(caseMiss('button', ['button.tsx'])).toBeUndefined()
  expect(caseMiss('Missing', ['button.tsx'])).toBeUndefined() // not there at all: tsc's job, not a case problem
})

test('at turn end, what the turn added and left in is reported; what it removed again is not', async ($, on) => {
  const files: Record<string, string> = {
    '/r/src/pay.ts': "import { Btn } from './Button'\nimport z from 'zod'\nimport { u } from '@app/utils'\nconst key = process.env.STRIPE_KEY\nconst api = 'http://localhost:3000/api'\nconsole.log(key)\nconsole.log(key)\nfor (const e of events) {\n  const c = await db.customer.findUnique({ where: { id: e.id } })\n}\nawait Promise.all(events.map(e => send(e)))",
    '/r/.env.example': 'DB_URL=\n',
    '/r/package.json': '{"dependencies":{"react":"18"}}',
    '/r/tsconfig.json': '{ "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }',
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
  expect(said).not.toContain('@app/utils') // a tsconfig paths alias, not a package
  expect(said).toContain('runs once per item of the loop at L8')
  expect(said).toContain('starts every item at once')
})

test('scale traps: a query per loop item, and every item started at once', () => {
  const ts = [
    'export async function enrich(events: Event[]) {',
    '  for (const e of events) {',
    '    if (e.customerId) {',
    '      const c = await db.customer.findUnique({ where: { id: e.customerId } })',
    '    }',
    '  }',
    '  const one = await db.customer.findMany({ where: { id: { in: ids } } })',
    '  for await (const row of stream) {',
    '    await sink.send(row)',
    '  }',
    '}',
  ]
  expect(loopAround(ts, 3)).toBe(1) // through the if, out to the for
  expect(loopAround(ts, 6)).toBeUndefined() // outside any loop: the function stops the walk
  expect(loopAround(ts, 8)).toBeUndefined() // for await streams one at a time by design
  const py = ['def sync(orders):', '    for o in orders:', '        user = User.objects.get(id=o.user_id)']
  expect(loopAround(py, 2)).toBe(1)
  expect(['await db.customer.findUnique({})', 'const x = await fetch(url)', 'User.objects.get(id=1)', 'await sleep(10)', 'total += o.amount'].map(isIoCall)).toEqual([true, true, true, false, false])
  expect(['await Promise.all(events.map(e => process(e)))', 'await asyncio.gather(*[fetch(u) for u in urls])', 'await Promise.all(chunk.map(e => process(e)))', 'await Promise.all([a(), b()])'].map(isUnbounded)).toEqual([true, true, false, false])
})
