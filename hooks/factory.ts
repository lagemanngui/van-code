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

export let cwd = ''
export const setCwd = (dir: string) => {
  cwd = dir
}
export let langs: typeof LANGS = []
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

async function detectLangs($: EngineInterface) {
  const found = await Promise.all(
    LANGS.map(async l => {
      for (const m of l.markers) {
        try {
          await $.fs.stat(`${cwd}/${m}`)
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
  await Promise.all([loadPlugins($), detectLangs($)])
  await Promise.all(
    RECS.map(async r => {
      status[r.id] = await check($, r.id)
      $.ui.invalidate('ui.render')
    }),
  )
}

