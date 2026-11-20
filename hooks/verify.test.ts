import { expect, test } from 'claude-code/testing'

import { verifySegments } from './register.js'

test('reading or committing a test file is not running it', () => {
  expect(verifySegments('cat tests/a.test.ts')).toEqual([])
  expect(verifySegments('rtk bypass head -n 50 tests/test_api.py')).toEqual([])
  expect(verifySegments('git commit -m "add tests"')).toEqual([])
  expect(verifySegments('grep -rn test src | wc -l')).toEqual([])
  expect(verifySegments('cd /r && npm test')).toEqual(['npm test'])
  expect(verifySegments('CI=1 npx vitest run tests/a.test.ts')).toEqual(['npx vitest run tests/a.test.ts'])
  expect(verifySegments('rtk pytest -q && cat out.txt')).toEqual(['pytest -q'])
  expect(verifySegments('bash -n x.sh')).toEqual(['bash -n x.sh'])
})

test('infra files: terraform, helm charts and Kubernetes manifests get their checker', async ($, on) => {
  const ran: string[] = []
  const files: Record<string, string> = {
    '/c/templates/deploy.yaml': '{{ .Values.x }}',
    '/k/deploy.yaml': 'apiVersion: apps/v1\nkind: Deployment\n',
    '/w/ci.yml': 'on: push\njobs: {}\n',
  }
  on('fs.stat', (_, e) => {
    const p = String((e as { path: string }).path)
    if (p === '/c/Chart.yaml' || p in files || p === '/t/main.tf') return { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } } as never
    throw new Error('ENOENT')
  })
  on('fs.read', (_, e) => ({ value: files[String((e as { path: string }).path)] ?? '' }) as never)
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    ran.push(argv)
    const isBad = argv.startsWith('terraform fmt') || argv.startsWith('kubeconform')
    return { value: { exitCode: isBad ? 1 : 0, stdout: isBad ? 'Error: bad thing' : '', stderr: '' } } as never
  })

  on('tool.call', () => ({ result: {} }))
  on('ui.toast', () => ({ value: undefined }) as never)
  const edit = async (file_path: string) => {
    const r = await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' } as never)
    return (r.context ?? []).join('\n')
  }

  expect(await edit('/t/main.tf')).toContain('terraform fmt reports errors') // no .terraform: not initialised
  expect(await edit('/c/templates/deploy.yaml')).toBe('')
  expect(ran).toContain('helm lint /c')
  expect(await edit('/k/deploy.yaml')).toContain('kubeconform reports errors')
  expect(await edit('/w/ci.yml')).toBe('') // not a manifest
  expect(ran.some(a => a.includes('ci.yml'))).toBe(false)
})
