import type { EngineInterface } from 'claude-code'

import { KITTY_APPS, kittyConf, LINUX_DEFAULT_SCRIPT, lsAlias, macDefaultScript, OPEN_ACTIONS, type Platform } from './kitty.js'

// "Factory equipment": tools the mod recommends, how to check and install each.
// `none`: nothing to recommend here (no known language in this folder).
export type Status = 'checking' | 'ok' | 'missing' | 'none'
export const RECS = [
  { id: 'rtk', desc: 'trims command output to save tokens', isOptional: false },
  { id: 'ponytail', desc: 'lazy senior dev mode: the smallest change that works', isOptional: false },
  { id: 'config', desc: 'caps huge Bash and MCP outputs', isOptional: false },
  { id: 'lsp', desc: 'IDE-style code navigation', isOptional: false },
  { id: 'commit-commands', desc: '/commit e /commit-push-pr', isOptional: false },
  { id: 'context7', desc: 'up-to-date library docs (external service)', isOptional: true },
  { id: 'security-guidance', desc: 'security review; spends tokens every turn', isOptional: true },
  { id: 'shellcheck', desc: 'finds real bugs in shell scripts after each edit', isOptional: true },
  { id: 'jq', desc: 'slices big JSON instead of reading it whole', isOptional: true },
  { id: 'ast-grep', desc: 'searches code by its structure, not by regex', isOptional: true },
  { id: 'infra', desc: 'checks Terraform, Helm and Kubernetes files right after each edit', isOptional: true },
  { id: 'playwright', desc: 'tests web UI like a user would: Microsoft playwright-cli and its official skill', isOptional: true },
  { id: 'diagnosing-bugs', desc: 'a diagnosis loop for hard bugs: a failing repro first, then ranked hypotheses (Matt Pocock skill)', isOptional: true },
  { id: 'kitty', desc: 'terminal with clickable file links, inline images and Shift+Enter (not made the default)', isOptional: true },
  { id: 'indra', desc: 'PDFs and scans as text, local OCR (free for personal use and companies under US$20M)', isOptional: true },
] as const
export type RecId = (typeof RECS)[number]['id']

// Recommended env caps; written only where the person has none of their own.
const ENV_CAPS: Record<string, string> = { BASH_MAX_OUTPUT_LENGTH: '15000', MAX_MCP_OUTPUT_TOKENS: '10000' }

// Language servers by the files that mark a project; each plugin needs its binary.
const LANGS = [
  { name: 'TypeScript', markers: ['tsconfig.json', 'package.json'], plugin: 'typescript-lsp', bin: 'typescript-language-server', setup: ['npm', 'i', '-g', 'typescript-language-server', 'typescript'] },
  { name: 'Python', markers: ['pyproject.toml', 'requirements.txt', 'setup.py'], plugin: 'pyright-lsp', bin: 'pyright-langserver', setup: ['npm', 'i', '-g', 'pyright'] },
  { name: 'Rust', markers: ['Cargo.toml'], plugin: 'rust-analyzer-lsp', bin: 'rust-analyzer', setup: ['brew', 'install', 'rust-analyzer'] },
  { name: 'Go', markers: ['go.mod'], plugin: 'gopls-lsp', bin: 'gopls', setup: ['brew', 'install', 'gopls'] },
]
const OFFICIAL = 'claude-plugins-official'
// Command-line tools: the binary is the id, Homebrew installs it.
const BREW_TOOLS: readonly string[] = ['shellcheck', 'jq', 'ast-grep']

export let cwd = ''
export const setCwd = (dir: string) => {
  cwd = dir
}
export let langs: typeof LANGS = []

// Infra checkers by the files the project tracks; `bins` is any one of them, `brew` installs the first.
// Terraform left Homebrew core over its license: OpenTofu (`tofu`) stands in.
const INFRA = [
  { name: 'Terraform', globs: ['*.tf', '*.tofu'], bins: ['terraform', 'tofu'], brew: 'opentofu' },
  { name: 'Helm', globs: ['*Chart.yaml'], bins: ['helm'], brew: 'helm' },
  { name: 'Kubernetes', globs: ['*k8s/*.yaml', '*kubernetes/*.yaml', '*manifests/*.yaml', '*k8s/*.yml'], bins: ['kubeconform'], brew: 'kubeconform' },
] as const
export let infra: (typeof INFRA)[number][] = []

// shortcut: only git-tracked files are seen; a folder outside git finds no infra.
async function detectInfra($: EngineInterface) {
  const tracks = async (root: string, globs: readonly string[]) => {
    const r = await run($, ['git', '-C', root, 'ls-files', '--', ...globs])
    return r.ok && r.out.trim() !== ''
  }
  const found = await Promise.all(INFRA.map(async i => (await Promise.all(roots.map(r => tracks(r, i.globs)))).some(Boolean)))
  infra = INFRA.filter((_, n) => found[n])
}
let plugins: { id: string; enabled: boolean }[] = []

// Runs a host command; a command that cannot start counts as a failure.
export async function run($: EngineInterface, argv: string[], timeoutMs = 60_000) {
  try {
    const r = await $.process.run(argv, { timeoutMs })
    return { ok: r.exitCode === 0, out: r.stdout + r.stderr }
  } catch (err) {
    return { ok: false, out: String(err) }
  }
}

async function loadPlugins($: EngineInterface) {
  const r = await run($, ['claude', 'plugin', 'list', '--json'])
  try {
    plugins = r.ok ? JSON.parse(r.out) : []
  } catch {
    plugins = []
  }
}

const isEnabled = (id: string) => plugins.some(p => p.id === id && p.enabled)

// Where projects live: the folder Claude runs in and, for a folder that holds several
// repos side by side (not a monorepo), each repo one level down.
const ROOTS_MAX = 100 // shortcut: a folder with more repos than this is scanned in part
export let roots: string[] = []
export async function findRoots($: EngineInterface): Promise<string[]> {
  const entries = await $.fs.list(cwd).catch(() => [])
  const subs = entries.filter(e => e.kind === 'dir' && !e.name.startsWith('.') && e.name !== 'node_modules').slice(0, ROOTS_MAX)
  const isRepo = await Promise.all(subs.map(e => $.fs.exists(`${cwd}/${e.name}/.git`).catch(() => false)))
  return [cwd, ...subs.filter((_, i) => isRepo[i]).map(e => `${cwd}/${e.name}`)]
}

// What the folder holds: its repos, their languages and their infra files.
export async function detectProjects($: EngineInterface) {
  roots = await findRoots($)
  await Promise.all([detectLangs($), detectInfra($), detectWeb($)])
}

// A web frontend: a UI framework in a package.json, or an index.html at a root.
const WEB_DEPS = /"(react|react-dom|vue|svelte|@sveltejs\/kit|next|nuxt|@angular\/core|solid-js|astro|@remix-run\/react|vite|preact|lit)"\s*:/
export let hasWeb = false
async function detectWeb($: EngineInterface) {
  const each = await Promise.all(
    roots.map(async r => WEB_DEPS.test(await $.fs.read(`${r}/package.json`).catch(() => '')) || (await $.fs.exists(`${r}/index.html`).catch(() => false))),
  )
  hasWeb = each.some(Boolean)
}

// playwright-cli writes its skill to <cwd>/.claude/skills/playwright-cli (read in its skillCheck.js):
// installed from HOME it is the user's skill, in every project.
const PW_SKILL = '.claude/skills/playwright-cli/SKILL.md'
async function hasPlaywrightSkill($: EngineInterface) {
  const home = await $.env.get('HOME')
  const dirs = [home, ...roots].filter(Boolean)
  return (await Promise.all(dirs.map(d => $.fs.exists(`${d}/${PW_SKILL}`).catch(() => false)))).some(Boolean)
}

// diagnosing-bugs from mattpocock/skills (MIT), installed as the user's own skill for every project.
const DIAG_SKILL = '.claude/skills/diagnosing-bugs/SKILL.md'
const DIAG_INSTALL = ['npx', '-y', 'skills', 'add', 'https://github.com/mattpocock/skills', '--skill', 'diagnosing-bugs', '-g', '-y']
async function hasDiagSkill($: EngineInterface) {
  try {
    const home = await $.env.get('HOME')
    return !!home && (await $.fs.exists(`${home}/${DIAG_SKILL}`))
  } catch {
    return false
  }
}

async function detectLangs($: EngineInterface) {
  const found = await Promise.all(
    LANGS.map(async l => {
      for (const root of roots)
        for (const m of l.markers) {
          try {
            await $.fs.stat(`${root}/${m}`)
            return true
          } catch {}
        }
      return false
    }),
  )
  langs = LANGS.filter((_, i) => found[i])
}

async function hasBin($: EngineInterface, bin: string) {
  return (await run($, ['which', bin])).ok
}

async function platformOf($: EngineInterface): Promise<Platform> {
  return (await $.session.info().catch(() => undefined))?.platform ?? 'unknown'
}

async function hasKitty($: EngineInterface) {
  if (await hasBin($, 'kitty')) return true
  const home = await $.env.get('HOME')
  return (await Promise.all(KITTY_APPS.map(a => $.fs.exists(a.replace('~', home ?? '~')).catch(() => false)))).some(Boolean)
}

async function makeKittyDefault($: EngineInterface, mac: boolean): Promise<string> {
  if (mac) {
    const r = await run($, ['osascript', '-l', 'JavaScript', '-e', macDefaultScript('net.kovidgoyal.kitty')])
    if (!r.ok) return `kitty: could not make it the default (${r.out.trim().split('\n').at(-1)})`
    const was = r.out.trim()
    return `kitty: now the default terminal, for shell scripts and ssh:// links (before: ${was})`
  }
  const r = await run($, ['sh', '-c', LINUX_DEFAULT_SCRIPT])
  if (!r.ok) return `kitty: could not make it the default (${r.out.trim().split('\n').at(-1)})`
  return 'kitty: set as the default terminal for xdg-terminal-exec and GNOME; on Debian or Ubuntu also run `sudo update-alternatives --config x-terminal-emulator`'
}

// kitty: the app, then its config only where the person has none. The shell's rc file is theirs: the ls line is shown, not written.
async function installKitty($: EngineInterface): Promise<string> {
  const platform = await platformOf($)
  if (platform === 'windows' || platform === 'unknown') return 'kitty: no build for this system (macOS and Linux, WSL included)'
  const mac = platform === 'macos'
  const brew = mac && (await hasBin($, 'brew'))
  const out: string[] = []
  if (!(await hasKitty($))) {
    const argv = brew
      ? ['brew', 'install', '--cask', 'kitty']
      : ['sh', '-c', 'curl -fsSL https://sw.kovidgoyal.net/kitty/installer.sh | sh /dev/stdin launch=n'] // kitty's official installer
    if (!(await run($, argv, 600_000)).ok) return `kitty: ${brew ? '`brew install --cask kitty`' : "kitty's official installer (sw.kovidgoyal.net/kitty)"} failed`
    // the installer leaves kitty in ~/.local/kitty.app on Linux; its docs link the commands into ~/.local/bin
    if (!mac) await run($, ['sh', '-c', 'mkdir -p ~/.local/bin && ln -sf ~/.local/kitty.app/bin/kitty ~/.local/kitty.app/bin/kitten ~/.local/bin/'])
    out.push('kitty: installed')
    // asked once, on a fresh install; WSL's terminal belongs to Windows
    if (platform !== 'wsl') {
      const answer = await $.ui
        .ask('Make kitty your default terminal?', { header: 'kitty', options: ['No, keep the current one', 'Yes, make kitty the default'] })
        .catch(() => '') // dismissed, or no one to ask
      out.push(answer.startsWith('Yes') ? await makeKittyDefault($, mac) : 'kitty: not made the default terminal')
    }
  } else out.push('kitty: already installed')
  if (brew) {
    // the config's font, and GNU ls for clickable names; failures here leave kitty working
    await run($, ['brew', 'install', '--cask', 'font-jetbrains-mono'], 600_000)
    await run($, ['brew', 'install', 'coreutils'], 600_000)
  }
  const dir = `${await $.env.get('HOME')}/.config/kitty`
  await run($, ['mkdir', '-p', dir])
  for (const [file, text] of [['kitty.conf', kittyConf(platform)], ['open-actions.conf', OPEN_ACTIONS]] as const) {
    if (await $.fs.exists(`${dir}/${file}`).catch(() => true)) out.push(`kitty: ${dir}/${file} exists, left as is`)
    else {
      await $.fs.write(`${dir}/${file}`, text)
      out.push(`kitty: wrote ${dir}/${file}`)
    }
  }
  out.push(`kitty: for clickable names in ls, add to your shell's rc file: ${lsAlias(platform)}`)
  if (mac) out.push("kitty: if it will not open from Finder or the Dock, `xattr -dr com.apple.quarantine /Applications/kitty.app` lets it (it turns macOS's Gatekeeper check off for kitty)")
  out.push('kitty: quit it fully and open it again, so the config takes effect')
  return out.join('\n')
}

async function check($: EngineInterface, id: RecId): Promise<Status> {
  const ok = (b: boolean): Status => (b ? 'ok' : 'missing')
  if (id === 'rtk') {
    const r = await run($, ['rtk', 'init', '--show'])
    return ok(r.ok && r.out.includes('[ok] settings.json'))
  }
  if (id === 'config') {
    const env = ((await $.settings.read({ key: 'env' })) ?? {}) as Record<string, string>
    return ok(Object.keys(ENV_CAPS).every(k => env[k] !== undefined))
  }
  if (id === 'lsp') {
    if (langs.length === 0) return 'none'
    const each = await Promise.all(langs.map(async l => isEnabled(`${l.plugin}@${OFFICIAL}`) && (await hasBin($, l.bin))))
    return ok(each.every(Boolean))
  }
  if (id === 'ponytail') return ok(isEnabled('ponytail@ponytail'))
  if (id === 'indra') return ok(await hasBin($, 'indra-ocr'))
  if (id === 'kitty') {
    const platform = await platformOf($)
    if (platform === 'windows' || platform === 'unknown') return 'none' // kitty has no Windows build
    return ok(await hasKitty($))
  }
  if (id === 'diagnosing-bugs') return ok(await hasDiagSkill($))
  if (id === 'playwright') {
    if (!hasWeb) return 'none'
    return ok((await hasBin($, 'playwright-cli')) && (await hasPlaywrightSkill($)))
  }
  if (id === 'infra') {
    if (infra.length === 0) return 'none'
    const each = await Promise.all(infra.map(async i => (await Promise.all(i.bins.map(b => hasBin($, b)))).some(Boolean)))
    return ok(each.every(Boolean))
  }
  if (BREW_TOOLS.includes(id)) return ok(await hasBin($, id))
  return ok(isEnabled(`${id}@${OFFICIAL}`))
}

// Installs or enables one plugin; adds its marketplace first when it is unknown.
async function installPlugin($: EngineInterface, id: string, marketplace: string): Promise<boolean> {
  if (plugins.some(p => p.id === id)) return (await run($, ['claude', 'plugin', 'enable', id])).ok
  if ((await run($, ['claude', 'plugin', 'install', id], 180_000)).ok) return true
  await run($, ['claude', 'plugin', 'marketplace', 'add', marketplace], 180_000)
  return (await run($, ['claude', 'plugin', 'install', id], 180_000)).ok
}

export async function install($: EngineInterface, id: RecId): Promise<string> {
  if (id === 'rtk') {
    if (!(await hasBin($, 'rtk'))) {
      const brew = await run($, ['brew', 'install', 'rtk'], 600_000)
      if (!brew.ok) return 'rtk: `brew install rtk` failed (is Homebrew installed?)'
    }
    const init = await run($, ['rtk', 'init', '-g', '--auto-patch'])
    return init.ok ? 'rtk: installed and hooked' : 'rtk: `rtk init -g --auto-patch` failed'
  }
  if (id === 'config') {
    const path = `${await $.env.get('HOME')}/.claude/settings.json`
    let settings: { env?: Record<string, string> }
    try {
      settings = JSON.parse(await $.fs.read(path))
    } catch {
      return 'config: could not read ~/.claude/settings.json, nothing changed'
    }
    const env = (settings.env ??= {})
    for (const [k, v] of Object.entries(ENV_CAPS)) env[k] ??= v
    await $.fs.write(path, JSON.stringify(settings, null, 2) + '\n')
    return 'config: BASH_MAX_OUTPUT_LENGTH and MAX_MCP_OUTPUT_TOKENS written to settings.json'
  }
  if (id === 'lsp') {
    const out: string[] = []
    for (const l of langs) {
      if (!(await hasBin($, l.bin)) && !(await run($, l.setup, 600_000)).ok) {
        out.push(`lsp ${l.name}: \`${l.setup.join(' ')}\` failed`)
        continue
      }
      const isOk = await installPlugin($, `${l.plugin}@${OFFICIAL}`, `anthropics/${OFFICIAL}`)
      out.push(isOk ? `lsp ${l.name}: installed` : `lsp ${l.name}: installing ${l.plugin} failed`)
    }
    return out.join('\n')
  }
  if (id === 'diagnosing-bugs') {
    const r = await run($, DIAG_INSTALL, 300_000)
    return r.ok ? 'diagnosing-bugs: skill installed in ~/.claude/skills' : `diagnosing-bugs: \`${DIAG_INSTALL.join(' ')}\` failed`
  }
  if (id === 'playwright') {
    if (!(await hasBin($, 'playwright-cli')) && !(await run($, ['npm', 'install', '-g', '@playwright/cli@latest'], 600_000)).ok)
      return 'playwright: `npm install -g @playwright/cli@latest` failed (needs Node 20+)'
    const home = await $.env.get('HOME')
    try {
      const r = await $.process.run(['playwright-cli', 'install', '--skills'], { cwd: home, timeoutMs: 180_000 })
      if (r.exitCode !== 0) return 'playwright: installed, but `playwright-cli install --skills` failed'
    } catch {
      return 'playwright: installed, but `playwright-cli install --skills` failed'
    }
    return 'playwright: playwright-cli and its skill installed (it drives your installed Chrome; without one, run `playwright-cli install-browser`)'
  }
  if (id === 'infra') {
    const out: string[] = []
    for (const i of infra) {
      if ((await Promise.all(i.bins.map(b => hasBin($, b)))).some(Boolean)) continue
      const isOk = (await run($, ['brew', 'install', i.brew], 600_000)).ok
      out.push(isOk ? `infra ${i.name}: ${i.brew} installed` : `infra ${i.name}: \`brew install ${i.brew}\` failed (is Homebrew installed?)`)
    }
    return out.join('\n') || 'infra: nothing to install'
  }
  if (BREW_TOOLS.includes(id)) {
    return (await run($, ['brew', 'install', id], 600_000)).ok ? `${id}: installed` : `${id}: \`brew install ${id}\` failed (is Homebrew installed?)`
  }
  if (id === 'kitty') return installKitty($)
  if (id === 'indra') {
    // uv brings its own Python 3.10+, which indra-ocr needs; macOS ships 3.9
    const argv = (await hasBin($, 'uv'))
      ? ['uv', 'tool', 'install', '--python', '3.12', 'indra-ocr']
      : (await hasBin($, 'pipx'))
        ? ['pipx', 'install', 'indra-ocr']
        : undefined
    if (!argv) return 'indra: needs uv (`brew install uv`) or pipx'
    if (!(await run($, argv, 600_000)).ok) return `indra: \`${argv.join(' ')}\` failed`
    return (await hasBin($, 'indra-ocr'))
      ? 'indra: installed (the first run downloads ~76 MB of models)'
      : 'indra: installed, but indra-ocr is not on PATH: run `uv tool update-shell` (or `pipx ensurepath`) and restart the shell'
  }
  if (id === 'ponytail') {
    const isOk = await installPlugin($, 'ponytail@ponytail', 'DietrichGebert/ponytail')
    return isOk ? 'ponytail: installed' : 'ponytail: `claude plugin install ponytail@ponytail` failed'
  }
  const isOk = await installPlugin($, `${id}@${OFFICIAL}`, `anthropics/${OFFICIAL}`)
  return isOk ? `${id}: installed` : `${id}: \`claude plugin install ${id}@${OFFICIAL}\` failed`
}

export const status: Record<string, Status> = {}

// Something the person should act on: a recommended item missing.
export const isLacking = () => RECS.some(r => !r.isOptional && status[r.id] === 'missing')

export async function checkAll($: EngineInterface) {
  for (const r of RECS) status[r.id] = 'checking'
  $.ui.invalidate('ui.render')
  await Promise.all([loadPlugins($), detectProjects($)])
  await Promise.all(
    RECS.map(async r => {
      status[r.id] = await check($, r.id)
      $.ui.invalidate('ui.render')
    }),
  )
}

