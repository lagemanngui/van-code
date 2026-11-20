import { expect, test, type TestBody } from 'claude-code/testing'

import { kittyConf, lsAlias } from './kitty.js'

test('the kitty config keeps macOS keys and cmd shortcuts on macOS only', () => {
  expect(kittyConf('macos')).toContain('map cmd+d launch --location=vsplit --cwd=current')
  expect(kittyConf('macos')).toContain('hide_window_decorations no')
  expect(kittyConf('linux')).not.toContain('macos_')
  expect(kittyConf('linux')).not.toContain('map cmd')
  expect(lsAlias('macos')).toContain('alias ls="gls --hyperlink=auto')
  expect(lsAlias('linux')).toContain('alias ls="ls --hyperlink=auto')
})

const setup = async (
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  platform: string,
  existing: string[] = [],
  answer = 'No, keep the current one',
) => {
  const ran: string[] = []
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' } as never, ((_: unknown, e: unknown) => {
    const q = (e as { questions: { question: string }[] }).questions[0]!.question
    asked.push(q)
    return { result: { questions: [], answers: { [q]: answer } } }
  }) as never)
  const wrote: string[] = []
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    ran.push(argv)
    const ok = !argv.startsWith('which kitty') && (argv !== 'which brew' || platform === 'macos')
    return { value: { exitCode: ok ? 0 : 1, stdout: ok ? 'ok' : '', stderr: '' } } as never
  })
  on('session.info', () => ({ value: { platform } }) as never)
  on('env.get', () => ({ value: '/h' }) as never)
  on('fs.exists', (_, e) => ({ value: existing.includes((e as { path: string }).path) }) as never)
  on('fs.write', (_, e) => {
    wrote.push((e as { path: string }).path)
    return { value: undefined } as never
  })
  on('settings.read', () => ({ value: {} }) as never)
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('clock.after', () => ({ value: { cancel: () => {} } }) as never)
  const r = await $.command.run({ command: 'van-code-setup', args: 'kitty' } as never)
  return { ran, wrote, asked, text: String((r as { text?: string }).text) }
}

test('setup kitty on macOS: Homebrew cask, font, config written, the rc line only shown', async ($, on) => {
  const { ran, wrote, text } = await setup($, on, 'macos', ['/h/.config/kitty/kitty.conf'])
  expect(ran).toContain('brew install --cask kitty')
  expect(ran).toContain('brew install --cask font-jetbrains-mono')
  expect(wrote).toEqual(['/h/.config/kitty/open-actions.conf']) // their kitty.conf is left alone
  expect(text).toContain('kitty.conf exists, left as is')
  expect(text).toContain('alias ls="gls --hyperlink=auto')
  expect(text).toContain('xattr -dr com.apple.quarantine')
})

test('setup kitty on Linux: the official installer, no Homebrew, no quarantine note', async ($, on) => {
  const { ran, text } = await setup($, on, 'linux')
  expect(ran.some(a => a.includes('sw.kovidgoyal.net/kitty/installer.sh') && a.includes('launch=n'))).toBe(true)
  expect(ran.some(a => a.startsWith('brew install'))).toBe(false)
  expect(text).not.toContain('xattr')
  expect(text).toContain('alias ls="ls --hyperlink=auto')
})

test('a fresh kitty install asks once to make it the default; yes on macOS sets the shell-script and ssh handlers', async ($, on) => {
  const { ran, asked, text } = await setup($, on, 'macos', [], 'Yes, make kitty the default')
  expect(asked).toEqual(['Make kitty your default terminal?'])
  const osa = ran.find(a => a.startsWith('osascript -l JavaScript'))!
  expect(osa).toContain('"public.unix-executable", "com.apple.terminal.shell-script"')
  expect(osa).toContain('LSSetDefaultHandlerForURLScheme($("ssh"), $("net.kovidgoyal.kitty"))')
  expect(text).toContain('kitty: now the default terminal')
})

test('no makes no change on Linux', async ($, on) => {
  const linux = await setup($, on, 'linux')
  expect(linux.text).toContain('kitty: not made the default terminal')
  expect(linux.ran.some(a => a.includes('xdg-terminals.list'))).toBe(false)
})

test('WSL is not asked: its terminal belongs to Windows', async ($, on) => {
  const wsl = await setup($, on, 'wsl')
  expect(wsl.asked).toEqual([])
})
