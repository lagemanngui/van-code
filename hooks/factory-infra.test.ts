import { expect, test } from 'claude-code/testing'

test('setup installs the infra checker the repo needs, and only that', async ($, on) => {
  const ran: string[] = []
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    ran.push(argv)
    // the repo tracks Terraform only; no terraform, tofu, helm or kubeconform installed
    const out = argv.includes('ls-files') && argv.includes('*.tf') ? 'infra/main.tf\n' : argv.startsWith('brew install') ? 'ok' : ''
    return { value: { exitCode: out ? 0 : 1, stdout: out, stderr: '' } } as never
  })
  on('settings.read', () => ({ value: {} }) as never)
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('clock.after', () => ({ value: { cancel: () => {} } }) as never)

  const r = await $.command.run({ command: 'van-code:setup', args: 'infra' } as never)
  expect(String((r as { text?: string }).text)).toContain('infra Terraform: opentofu installed')
  expect(ran).toContain('brew install opentofu')
  expect(ran.some(a => a === 'brew install helm' || a === 'brew install kubeconform')).toBe(false)
})
