// Stack scan, step 2 (network, on demand): what each dependency owner publishes for AI agents.
// Official means it lives under that owner: a Claude plugin marketplace, a published skills
// folder, an llms.txt on its docs site, or a plugin of Anthropic's catalog built from its repos.
import type { Owner } from './scan.js'

export type Finding = {
  owner: string // github.com/nestjs
  kind: 'catalog' | 'plugin' | 'skills' | 'llms' | 'mcp'
  title: string
  url: string
  install?: string[] // commands, in order
  note?: string
}

export type Net = {
  gh: (path: string, params?: Record<string, string>) => Promise<any> // `gh api`, authenticated
  fetchText: (url: string) => Promise<{ ok: boolean; text: string }>
  catalog: { name: string; description?: string; source?: unknown; homepage?: string }[] // Anthropic's marketplace, read locally
  catalogName: string
}

const OWNERS_MAX = 15 // the owners searched; each batch of them is one GitHub code search
const QUERY_MAX = 230 // GitHub rejects search queries past 256 characters
const PER_OWNER_MAX = 2 // marketplaces, and MCP repos, shown per owner
// A repo of a big org is only about this project if it is one the project uses, or the org's
// collection for agents (skills, agent-skills, agent-plugins, comfy-skills): a single product's
// plugin (mlintern-plugin) is about that product.
const AGENT_REPO = /(^|[-_.])(skills|plugins)$/i
// Skills inside .claude/, .agents/ or .cursor/ are the repo's own (for its contributors), not published.
const isInternalSkill = (path: string) => /(^|\/)\.[^/]+\//.test(path)

const orgOf = (key: string) => key.slice(key.lastIndexOf('/') + 1)
const repoOwner = (url: string) => url.match(/github\.com[/:]([^/]+)\//)?.[1]?.toLowerCase()

// Every owner once, across the repos scanned, heaviest first.
export function pickOwners(lists: Owner[][]): Owner[] {
  const all = new Map<string, Owner>()
  for (const o of lists.flat()) {
    const had = all.get(o.key)
    if (!had) all.set(o.key, { ...o, deps: [...o.deps], repos: [...o.repos], homepages: [...o.homepages] })
    else {
      had.score += o.score
      for (const d of o.deps) if (!had.deps.includes(d)) had.deps.push(d)
      for (const r of o.repos) if (!had.repos.includes(r)) had.repos.push(r)
      for (const h of o.homepages) if (!had.homepages.includes(h)) had.homepages.push(h)
    }
  }
  // shortcut: GitHub only; owners on GitLab or Bitbucket get the llms.txt probe alone.
  return [...all.values()].sort((a, b) => b.score - a.score || a.org.localeCompare(b.org)).slice(0, OWNERS_MAX)
}

// org:a org:b ... in queries short enough for GitHub.
function batches(orgs: string[], rest: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const o of orgs) {
    const next = `${cur} org:${o}`.trim()
    if (cur && next.length + rest.length + 1 > QUERY_MAX) {
      out.push(`${cur} ${rest}`)
      cur = `org:${o}`
    } else cur = next
  }
  if (cur) out.push(`${cur} ${rest}`)
  return out
}

function fromCatalog(net: Net, owners: Owner[]): Finding[] {
  const out: Finding[] = []
  for (const p of net.catalog) {
    const src = p.source as { url?: string; repo?: string } | string | undefined
    const url = typeof src === 'string' ? '' : (src?.url ?? (src?.repo ? `https://github.com/${src.repo}` : ''))
    const by = url ? repoOwner(url) : undefined
    // its repo is under the owner, or it is named exactly like a package the project uses
    const name = p.name.toLowerCase()
    // named like a package the project uses, or from the owner's repos and named for it (not logfire for pydantic)
    const owner = owners.find(
      o => o.host === 'github.com' && (o.deps.includes(name) || o.repos.includes(name) || (o.org === by && [o.org, ...o.repos].some(n => name.includes(n.replace(/-org$/, ''))))),
    )
    if (!owner) continue
    out.push({
      owner: owner.key,
      kind: 'catalog',
      title: `${p.name} (Anthropic's official marketplace)${p.description ? `: ${p.description.slice(0, 90)}` : ''}`,
      url: p.homepage ?? url,
      install: [`claude plugin install ${p.name}@${net.catalogName}`],
    })
  }
  return out
}

// The GitHub repos the catalog's plugins come from: found there, they are not listed twice.
const catalogRepos = (net: Net) =>
  new Set(
    net.catalog
      .map(p => (typeof p.source === 'object' && p.source ? ((p.source as { url?: string }).url ?? '') : '').match(/github\.com\/([^/]+\/[^/.]+)/)?.[1]?.toLowerCase())
      .filter((r): r is string => !!r),
  )

// A repo of the owner speaks to this project: one it uses, one plainly for agents, or a plugin named for it.
const isAboutProject = (owner: Owner, repo: string, names: string[] = []) =>
  owner.repos.includes(repo.split('/')[1]!.toLowerCase()) ||
  AGENT_REPO.test(repo.split('/')[1]!) ||
  names.some(n => n === owner.org || owner.deps.includes(n) || owner.repos.includes(n))

async function fromGitHub(net: Net, owners: Owner[]): Promise<Finding[]> {
  const gh = owners.filter(o => o.host === 'github.com')
  if (gh.length === 0) return []
  const orgs = gh.map(o => o.org)
  const ownerFor = (repo: string) => gh.find(o => o.org === repo.split('/')[0]!.toLowerCase())
  const search = async (kind: 'code' | 'repositories', q: string) =>
    ((await net.gh(`search/${kind}`, { q, per_page: '100' }).catch(() => undefined))?.items ?? []) as any[]
  const out: Finding[] = []

  // 1. Claude plugin marketplaces: installable as they are
  const inCatalog = catalogRepos(net)
  const markets = new Set<string>()
  for (const q of batches(orgs, 'path:.claude-plugin filename:marketplace.json'))
    for (const it of await search('code', q)) markets.add(it.repository.full_name)
  const shown = new Map<string, number>()
  // heaviest owners first, a few per owner (one busy org cannot crowd out the rest);
  // within an owner, its collection for agents before a tool that also ships a plugin
  const rank = (r: string) => gh.indexOf(ownerFor(r)!) * 2 + (AGENT_REPO.test(r.split('/')[1]!) ? 0 : 1)
  const ordered = [...markets].sort((a, b) => rank(a) - rank(b))
  const installs = new Set<string>()
  for (const repo of ordered) {
    const owner = ownerFor(repo)
    if (!owner || inCatalog.has(repo.toLowerCase()) || (shown.get(owner.key) ?? 0) >= PER_OWNER_MAX) continue
    // the raw file, not the API's base64: the code search only saw public repos anyway
    const file = await net.fetchText(`https://raw.githubusercontent.com/${repo}/HEAD/.claude-plugin/marketplace.json`).catch(() => ({ ok: false, text: '' }))
    // a third party's file: any shape, so only a string name and plugins with string names are read
    let parsed: unknown
    try {
      parsed = file.ok ? JSON.parse(file.text) : undefined
    } catch {}
    const raw = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as { name?: unknown; plugins?: unknown }
    const market = { name: typeof raw.name === 'string' ? raw.name : undefined }
    const plugins = (Array.isArray(raw.plugins) ? raw.plugins : []).filter(
      (p): p is { name: string } => typeof p === 'object' && p !== null && typeof (p as { name?: unknown }).name === 'string',
    )
    // a marketplace for the repo's own maintainers (aiobotocore-bot) says nothing to its users
    if (!isAboutProject(owner, repo, plugins.map(p => p.name.toLowerCase()))) continue
    // the same plugin@marketplace from two repos: the first, the collection, stands
    const ids = plugins.map(p => `${p.name}@${market.name}`)
    if (ids.length > 0 && ids.every(id => installs.has(id))) continue
    for (const id of ids) installs.add(id)
    shown.set(owner.key, (shown.get(owner.key) ?? 0) + 1)
    out.push({
      owner: owner.key,
      kind: 'plugin',
      title: `Claude Code plugin marketplace ${repo}${plugins.length ? `: ${plugins.map(p => p.name).join(', ')}` : ''}`,
      url: `https://github.com/${repo}`,
      install: market.name
        ? [`claude plugin marketplace add ${repo}`, ...plugins.map(p => `claude plugin install ${p.name}@${market.name}`)]
        : [`claude plugin marketplace add ${repo}`],
    })
  }

  // 2. published skills (a skills/ folder), in repos the project uses or plainly for agents
  const skills = new Map<string, string[]>()
  for (const q of batches(orgs, 'filename:SKILL.md'))
    for (const it of await search('code', q)) {
      const repo = it.repository.full_name as string
      if (isInternalSkill(it.path) || markets.has(repo)) continue
      const owner = ownerFor(repo)
      if (!owner || inCatalog.has(repo.toLowerCase()) || !isAboutProject(owner, repo)) continue
      skills.set(repo, [...(skills.get(repo) ?? []), (it.path as string).split('/').slice(-2, -1)[0]!])
    }
  for (const [repo, names] of skills)
    out.push({
      owner: ownerFor(repo)!.key,
      kind: 'skills',
      title: `Agent skills in ${repo}: ${[...new Set(names)].slice(0, 8).join(', ')}`,
      url: `https://github.com/${repo}`,
      install: [`npx skills add ${repo} -a claude-code -y`],
    })

  // 3. repos named for MCP: often a library to build servers with, so only "see also"
  const mcps = new Map<string, number>()
  for (const q of batches(orgs, 'mcp in:name archived:false'))
    for (const it of await search('repositories', q)) {
      const owner = ownerFor(it.full_name)
      if (!owner || (mcps.get(owner.key) ?? 0) >= PER_OWNER_MAX) continue
      mcps.set(owner.key, (mcps.get(owner.key) ?? 0) + 1)
      out.push({ owner: owner.key, kind: 'mcp', title: `${it.full_name}${it.description ? `: ${it.description}` : ''}`, url: it.html_url, note: 'named for MCP: check whether it is a server to use or a library to build one' })
    }
  return out
}

// llms.txt: the docs site's own index for LLMs, at the homepage or its docs. subdomain.
async function fromLlmsTxt(net: Net, owners: Owner[]): Promise<Finding[]> {
  const tried = new Set<string>()
  const out: Finding[] = []
  await Promise.all(
    owners.map(async o => {
      for (const home of o.homepages.slice(0, 2)) {
        let host: string
        try {
          host = new URL(home).host.replace(/^www\./, '')
        } catch {
          continue
        }
        if (/github\.com|npmjs\.com|pypi\.org|pub\.dev/.test(host)) continue // not the project's own site
        for (const url of [`https://${host}/llms.txt`, `https://docs.${host}/llms.txt`]) {
          if (tried.has(url) || host.startsWith('docs.') && url.includes('docs.docs.')) continue
          tried.add(url)
          const r = await net.fetchText(url).catch(() => ({ ok: false, text: '' }))
          // a real llms.txt is Markdown that opens with a title; a site's 404 page is HTML
          if (r.ok && /^#\s/.test(r.text.trimStart())) {
            out.push({ owner: o.key, kind: 'llms', title: `llms.txt: ${r.text.trimStart().split('\n')[0]!.replace(/^#\s*/, '')}`, url })
            return
          }
        }
      }
    }),
  )
  return out
}

export async function findOfficial(net: Net, owners: Owner[]): Promise<Finding[]> {
  const [catalog, github, llms] = await Promise.all([fromCatalog(net, owners), fromGitHub(net, owners), fromLlmsTxt(net, owners)])
  return [...catalog, ...github, ...llms]
}

const LABEL: Record<Finding['kind'], string> = { catalog: 'official', plugin: 'official', skills: 'official', llms: 'official docs', mcp: 'see also' }

export function officialText(owners: Owner[], found: Finding[]): string {
  const out: string[] = []
  for (const o of owners) {
    const mine = found.filter(f => f.owner === o.key).sort((a, b) => (a.kind === 'mcp' ? 1 : 0) - (b.kind === 'mcp' ? 1 : 0))
    out.push(`${o.key} (${o.deps.slice(0, 3).join(', ')}${o.deps.length > 3 ? ', ...' : ''})`)
    if (mine.length === 0) out.push('  nothing official found')
    for (const f of mine) {
      out.push(`  [${LABEL[f.kind]}] ${f.title}`)
      out.push(`      ${f.url}`)
      for (const c of f.install ?? []) out.push(`      $ ${c}`)
      if (f.note) out.push(`      note: ${f.note}`)
    }
  }
  return out.join('\n')
}

export const orgsSearched = (owners: Owner[]) => owners.map(o => orgOf(o.key))
