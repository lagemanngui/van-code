// /van-code:scan: the stack's official resources for AI agents, then the community's for the rest.
// On demand only: it reads node_modules and friends, then asks GitHub, the docs sites and skills.sh.
import type { EngineInterface } from 'claude-code'

import { type CommunitySkill, findCommunity } from './community.js'
import { findOfficial, type Finding, pickOwners } from './official.js'
import { discover, type Io, type Owner } from './scan.js'

const CATALOG = 'claude-plugins-official'
// what discover() reads the declared dependencies from; a change here is a change of stack
const MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'composer.json', 'pubspec.yaml']
const STALE_MS = 7 * 24 * 3600_000 // owners publish new skills often (nestjs/agent-skills is weeks old)

export type ScanCache = { hashes: Record<string, string>; text: string; items: ScanItem[]; at: number }
export const cacheKey = (roots: string[]) => `scan:${roots[0]}`

// One hash per repo, of its manifests; a repo without any hashes the empty string.
export async function manifestHashes(read: (path: string) => Promise<string>, roots: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const root of roots) {
    const parts = await Promise.all(MANIFESTS.map(async m => `${m}\0${await read(`${root}/${m}`).catch(() => '')}`))
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(parts.join('\0')))
    out[root] = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  }
  return out
}

// The repos whose manifests changed since the scan, or that it never saw.
export const changedRoots = (before: Record<string, string>, now: Record<string, string>) => Object.keys(now).filter(r => before[r] !== now[r])

export const isStale = (cache: ScanCache, now = Date.now()) => now - cache.at > STALE_MS

export async function stackScan($: EngineInterface, roots: string[]): Promise<{ text: string; items: ScanItem[] }> {
  const t = Date.now()
  const home = await $.env.get('HOME')
  const getJson = async (url: string) => JSON.parse((await $.http.fetch(url)).text) as unknown
  const io: Io = { read: p => $.fs.read(p), list: p => $.fs.list(p), home, fetchJson: getJson }
  const found = await Promise.all(roots.map(r => discover(io, r)))
  const owners = pickOwners(found.map(f => f.owners))
  if (owners.length === 0) return { text: `Stack scan: no dependencies found in ${roots.length} folder(s).`, items: [] }

  let catalog: { plugins?: unknown; name?: unknown } = {}
  try {
    catalog = JSON.parse(await $.fs.read(`${home}/.claude/plugins/marketplaces/${CATALOG}/.claude-plugin/marketplace.json`))
  } catch {} // no local catalog: GitHub still answers
  let ghFailed = 0
  const net = {
    catalog: (Array.isArray(catalog.plugins) ? catalog.plugins : []) as { name: string }[],
    catalogName: typeof catalog.name === 'string' ? catalog.name : CATALOG,
    gh: async (path: string, params: Record<string, string> = {}) => {
      const argv = ['gh', 'api', '-X', 'GET', path, ...Object.entries(params).flatMap(([k, v]) => ['-f', `${k}=${v}`])]
      const r = await $.process.run(argv, { timeoutMs: 30_000 })
      if (r.exitCode !== 0) {
        ghFailed += 1
        throw new Error(r.stderr)
      }
      return JSON.parse(r.stdout)
    },
    fetchText: async (url: string) => {
      const r = await $.http.fetch(url)
      return { ok: r.ok, text: r.text }
    },
  }
  const official = await findOfficial(net, owners)
  const community = await findCommunity(getJson, owners, official)
  const view = scanView(owners.slice(0, 15), official, community)
  const warn = ghFailed > 0 ? ['GitHub search failed, only docs sites and the local catalog were checked: is `gh` logged in?', ''] : []
  const head = `Stack scan: ${roots.length} folder(s), ${Math.min(owners.length, 15)} dependency owners, ${((Date.now() - t) / 1000).toFixed(1)}s`
  return { text: [head, '', ...warn, view.text].join('\n'), items: view.items }
}

export type ScanItem = { name: string; commands: string[] }

const shortOwner = (key: string) => key.slice(key.lastIndexOf('/') + 1)
const repoOf = (url: string) => url.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? url.replace(/^https?:\/\//, '')
// what gets installed: the plugin id, else the skills repo
const nameOf = (cmds: string[]) => cmds.at(-1)!.match(/plugin install (\S+)/)?.[1] ?? cmds.at(-1)!.match(/skills add (\S+)(?: --skill (\S+))?/)?.slice(1).filter(Boolean).join(' ') ?? cmds.at(-1)!

// One line per thing to install, numbered for `/van-code:scan install <n>`; docs and the rest in one line each.
export function scanView(owners: Owner[], official: Finding[], community: CommunitySkill[]): { text: string; items: ScanItem[] } {
  const order = new Map(owners.map((o, i) => [o.key, i]))
  const byOwner = <T extends { owner: string }>(xs: T[]) => [...xs].sort((a, b) => (order.get(a.owner) ?? 99) - (order.get(b.owner) ?? 99))
  const items: ScanItem[] = []
  const rows = (list: { owner: string; cmds: string[]; from: string; extra?: string }[]) => {
    const cells = list.map(r => {
      items.push({ name: nameOf(r.cmds), commands: r.cmds })
      return [String(items.length), shortOwner(r.owner), nameOf(r.cmds), (r.from === nameOf(r.cmds) ? '' : r.from) + (r.extra ?? '')]
    })
    const w = [0, 1, 2].map(c => Math.max(...cells.map(x => x[c]!.length)))
    return cells.map(x => `  ${x[0]!.padStart(w[0]!)}  ${x[1]!.padEnd(w[1]!)}  ${x[2]!.padEnd(w[2]!)}  ${x[3]}`)
  }
  const out: string[] = []
  const inst = byOwner(official.filter(f => f.install && f.install.length > 0))
  if (inst.length > 0) {
    out.push('Official, to install:')
    out.push(...rows(inst.map(f => ({ owner: f.owner, cmds: f.install!, from: f.kind === 'catalog' ? "Anthropic's catalog" : repoOf(f.url) }))))
    out.push('')
  }
  if (community.length > 0) {
    out.push('Community (review before installing):')
    out.push(...rows(byOwner(community).map(c => ({ owner: c.owner, cmds: c.install, from: c.url, extra: `, ${c.installs} installs` }))))
    out.push('')
  }
  const docs = byOwner(official.filter(f => f.kind === 'llms'))
  if (docs.length > 0) out.push(`Docs for agents (llms.txt): ${docs.map(f => f.url.replace(/^https:\/\//, '')).join(', ')}`)
  const mcp = official.filter(f => f.kind === 'mcp')
  if (mcp.length > 0) out.push(`MCP repos to look at: ${mcp.map(f => repoOf(f.url)).join(', ')}`)
  const has = new Set([...official, ...community].map(f => f.owner))
  const none = owners.filter(o => !has.has(o.key)).map(o => shortOwner(o.key))
  if (none.length > 0) out.push(`Nothing found for: ${none.join(', ')}`)
  out.push('')
  out.push(items.length > 0 ? 'Install with /van-code:scan install <n> (several: 1 3). Nothing was installed.' : 'Nothing to install.')
  return { text: out.join('\n'), items }
}
