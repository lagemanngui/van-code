import type { EngineInterface } from 'claude-code'

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
  await Promise.all([detectLangs($), detectInfra($)])
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

