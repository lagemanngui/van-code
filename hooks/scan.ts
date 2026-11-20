// Stack scan, step 1 (local, no network): each direct dependency's own metadata names the
// repository it comes from; the owner of that repository is where its official AI resources
// (skills, plugins, MCP servers, llms.txt) would live.

// Only what the scan reads: the mod passes $.fs, a test or a script passes its own.
export type Io = {
  read: (path: string) => Promise<string>
  list: (path: string) => Promise<readonly { name: string; kind: string }[]>
  home?: string // where per-user package caches live (Dart's ~/.pub-cache)
  // network, optional: asks a package registry about what nothing installed could answer
  fetchJson?: (url: string) => Promise<unknown>
}

export type Eco = 'npm' | 'pypi' | 'go' | 'composer' | 'pub'
export type Dep = { name: string; eco: Eco; isDev: boolean; repo?: string; homepage?: string }
// One owner (a GitHub org or user) and the dependencies that come from it.
export type Owner = { key: string; host: string; org: string; deps: string[]; repos: string[]; homepages: string[]; score: number }
export type Discovery = { root: string; deps: Dep[]; owners: Owner[]; unresolved: string[] }

const tryRead = (io: Io, path: string) => io.read(path).catch(() => undefined)
const tryJson = async (io: Io, path: string) => {
  const text = await tryRead(io, path)
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

// Any repository spelling to https://host/org/repo: git+https, git@host:, github:org/repo, org/repo.
export function normalizeRepo(raw: unknown): string | undefined {
  const value = str(typeof raw === 'object' && raw !== null ? (raw as { url?: unknown }).url : raw)
  if (!value) return undefined
  const short = value.match(/^(github|gitlab|bitbucket):([\w.-]+\/[\w.-]+)$/)
  if (short) return `https://${short[1] === 'bitbucket' ? 'bitbucket.org' : `${short[1]}.com`}/${short[2]!.replace(/\.git$/, '')}`
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return `https://github.com/${value.replace(/\.git$/, '')}`
  const m = value.match(/(?:[/@])((?:github|gitlab)\.com|bitbucket\.org)[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/)
  return m ? `https://${m[1]}/${m[2]}/${m[3]}` : undefined
}

function ownerOf(repo: string): { host: string; org: string; name: string } | undefined {
  const m = repo.match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+)/)
  return m ? { host: m[1]!, org: m[2]!.toLowerCase(), name: m[3]!.toLowerCase() } : undefined
}

// Type stubs say nothing about the stack: @types/react is React's, already counted.
const isNoise = (d: Dep) => d.eco === 'npm' && d.name.startsWith('@types/')
// A runtime dependency is the stack; a dev one is mostly tooling.
const weight = (d: Dep) => (d.isDev ? 1 : 2)

async function npmDeps(io: Io, root: string): Promise<Dep[]> {
  const pkg = await tryJson(io, `${root}/package.json`)
  if (!pkg) return []
  const names = [
    ...Object.keys((pkg.dependencies as object) ?? {}).map(name => ({ name, isDev: false })),
    ...Object.keys((pkg.devDependencies as object) ?? {}).map(name => ({ name, isDev: true })),
  ]
  return Promise.all(
    names.map(async ({ name, isDev }) => {
      // shortcut: only the root's node_modules; a workspace hoisting to a parent folder goes unresolved.
      const meta = await tryJson(io, `${root}/node_modules/${name}/package.json`)
      return { name, eco: 'npm' as const, isDev, repo: normalizeRepo(meta?.repository), homepage: str(meta?.homepage) }
    }),
  )
}

// PEP 503: names compare lowercased with runs of -_. as one dash.
const pyName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-')

async function pypiDeps(io: Io, root: string): Promise<Dep[]> {
  const pyproject = (await tryRead(io, `${root}/pyproject.toml`)) ?? ''
  const reqs = (await tryRead(io, `${root}/requirements.txt`)) ?? ''
  // shortcut: [project] dependencies and requirements.txt only; Poetry tables are not read.
  // the list ends at a ] outside quotes: extras (uvicorn[standard]) live inside them
  const block = pyproject.match(/^dependencies\s*=\s*\[((?:\s|,|"[^"]*"|'[^']*'|#[^\n]*)*)\]/m)?.[1] ?? ''
  const specs = [...block.matchAll(/["']([^"']+)["']/g)].map(m => m[1]!).concat(reqs.split('\n'))
  const names = [...new Set(specs.map(s => s.trim().match(/^([A-Za-z0-9][\w.-]*)/)?.[1]).filter((n): n is string => !!n))]
  if (names.length === 0) return []
  // installed metadata: the project's virtualenv, if it has one
  const sitePackages: string[] = []
  for (const venv of ['.venv', 'venv', 'env']) {
    const libs = await io.list(`${root}/${venv}/lib`).catch(() => [])
    for (const l of libs) if (l.name.startsWith('python')) sitePackages.push(`${root}/${venv}/lib/${l.name}/site-packages`)
  }
  const infos = (await Promise.all(sitePackages.map(async sp => (await io.list(sp).catch(() => [])).map(e => `${sp}/${e.name}`)))).flat().filter(p => p.endsWith('.dist-info'))
  return Promise.all(
    names.map(async name => {
      const info = infos.find(p => pyName(p.slice(p.lastIndexOf('/') + 1).replace(/-[^-]*\.dist-info$/, '')) === pyName(name))
      const meta = info ? ((await tryRead(io, `${info}/METADATA`)) ?? '') : ''
      const urls = [...meta.matchAll(/^(?:Project-URL: [^,]+, |Home-page: )(\S+)/gm)].map(m => m[1]!)
      return { name, eco: 'pypi' as const, isDev: false, repo: urls.map(normalizeRepo).find(Boolean), homepage: urls.find(u => !normalizeRepo(u)) }
    }),
  )
}

async function goDeps(io: Io, root: string): Promise<Dep[]> {
  const mod = await tryRead(io, `${root}/go.mod`)
  if (!mod) return []
  const lines = [...mod.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[a-z]+\/[^\s]+)\s+v[^\s]+(.*)$/gm)]
  // the module path is its repository; indirect requirements are not the project's choice
  return lines
    .filter(m => !/\/\/\s*indirect/.test(m[2]!))
    .map(m => ({ name: m[1]!, eco: 'go' as const, isDev: false, repo: normalizeRepo(`https://${m[1]!.split('/').slice(0, 3).join('/')}`) }))
}

async function composerDeps(io: Io, root: string): Promise<Dep[]> {
  const composer = await tryJson(io, `${root}/composer.json`)
  if (!composer) return []
  const installed = await tryJson(io, `${root}/vendor/composer/installed.json`)
  const list = (Array.isArray(installed) ? installed : (installed?.packages as unknown[]) ?? []) as Record<string, unknown>[]
  const names = [
    ...Object.keys((composer.require as object) ?? {}).map(name => ({ name, isDev: false })),
    ...Object.keys((composer['require-dev'] as object) ?? {}).map(name => ({ name, isDev: true })),
  ].filter(d => d.name.includes('/')) // php itself and ext-* are not packages
  return names.map(({ name, isDev }) => {
    const p = list.find(x => x.name === name)
    return { name, eco: 'composer' as const, isDev, repo: normalizeRepo(p?.source), homepage: str(p?.homepage) }
  })
}

// Top-level names of one block of a pubspec (`dependencies:`), skipping the SDKs.
function pubBlock(pubspec: string, key: string): string[] {
  const body = pubspec.match(new RegExp(`^${key}:\\s*\\n((?:[ \\t]+.*\\n?|\\s*\\n)*)`, 'm'))?.[1] ?? ''
  const names: string[] = []
  const lines = body.split('\n')
  lines.forEach((l, i) => {
    const m = l.match(/^ {2}([a-z_][a-z0-9_]*):\s*(.*)$/)
    if (!m) return
    // `flutter: sdk: flutter` is the SDK, not a package
    const isSdk = /^sdk:/.test(m[2]!) || /^\s{4}sdk:/.test(lines[i + 1] ?? '')
    if (!isSdk) names.push(m[1]!)
  })
  return names
}

async function pubDeps(io: Io, root: string): Promise<Dep[]> {
  const pubspec = await tryRead(io, `${root}/pubspec.yaml`)
  if (!pubspec) return []
  const lock = (await tryRead(io, `${root}/pubspec.lock`)) ?? ''
  const names = [...pubBlock(pubspec, 'dependencies').map(name => ({ name, isDev: false })), ...pubBlock(pubspec, 'dev_dependencies').map(name => ({ name, isDev: true }))]
  // shortcut: the default ~/.pub-cache only; a PUB_CACHE elsewhere goes unresolved locally.
  const cache = io.home ? `${io.home}/.pub-cache/hosted/pub.dev` : undefined
  return Promise.all(
    names.map(async ({ name, isDev }) => {
      const version = lock.match(new RegExp(`^ {2}${name}:\\n(?: {4}.*\\n)*? {4}version: "([^"]+)"`, 'm'))?.[1]
      const meta = cache && version ? ((await tryRead(io, `${cache}/${name}-${version}/pubspec.yaml`)) ?? '') : ''
      const field = (k: string) => meta.match(new RegExp(`^${k}:\\s*['"]?([^'"\\s]+)`, 'm'))?.[1]
      const urls = [field('repository'), field('homepage'), field('issue_tracker')].filter((u): u is string => !!u)
      return { name, eco: 'pub' as const, isDev, repo: urls.map(normalizeRepo).find(Boolean), homepage: field('homepage') }
    }),
  )
}

// Packagist answers { packages: { name: [newest, ...] } }.
const packagist = (j: any) => (Object.values(j?.packages ?? {}) as any[][])[0]?.[0]

// What each registry says about a package: its repository and homepage.
const REGISTRY: Partial<Record<Eco, { url: (name: string) => string; pick: (json: any) => unknown[] }>> = {
  npm: { url: n => `https://registry.npmjs.org/${n.replace('/', '%2F')}/latest`, pick: j => [j?.repository, j?.homepage] },
  pypi: { url: n => `https://pypi.org/pypi/${n}/json`, pick: j => [...Object.values(j?.info?.project_urls ?? {}), j?.info?.home_page] },
  pub: { url: n => `https://pub.dev/api/packages/${n}`, pick: j => [j?.latest?.pubspec?.repository, j?.latest?.pubspec?.homepage, j?.latest?.pubspec?.issue_tracker] },
  composer: { url: n => `https://repo.packagist.org/p2/${n}.json`, pick: j => [packagist(j)?.source, packagist(j)?.homepage] },
}
const REGISTRY_MAX = 40 // shortcut: at most this many registry asks per repo; the rest stay unresolved

async function fromRegistry(io: Io, deps: Dep[]) {
  if (!io.fetchJson) return
  const ask = deps.filter(d => !d.repo && !isNoise(d) && REGISTRY[d.eco]).slice(0, REGISTRY_MAX)
  await Promise.all(
    ask.map(async d => {
      const r = REGISTRY[d.eco]!
      const json = await io.fetchJson!(r.url(d.name)).catch(() => undefined)
      const urls = r.pick(json)
      d.repo = urls.map(normalizeRepo).find(Boolean)
      d.homepage ??= urls.map(str).find(u => !!u && !normalizeRepo(u))
    }),
  )
}

// shortcut: Ruby, Rust and Java dependencies are not read yet.
export async function discover(io: Io, root: string): Promise<Discovery> {
  const deps = (await Promise.all([npmDeps(io, root), pypiDeps(io, root), goDeps(io, root), composerDeps(io, root), pubDeps(io, root)])).flat()
  await fromRegistry(io, deps)
  const byOwner = new Map<string, Owner>()
  for (const d of deps) {
    const o = d.repo && !isNoise(d) ? ownerOf(d.repo) : undefined
    if (!o) continue
    const key = `${o.host}/${o.org}`
    const owner = byOwner.get(key) ?? { key, host: o.host, org: o.org, deps: [], repos: [], homepages: [], score: 0 }
    owner.deps.push(d.name)
    owner.score += weight(d)
    // the repos name what to look for in a big org (vercel/next.js, not all of vercel)
    if (!owner.repos.includes(o.name)) owner.repos.push(o.name)
    if (d.homepage && !owner.homepages.includes(d.homepage)) owner.homepages.push(d.homepage)
    byOwner.set(key, owner)
  }
  // an owner behind many of the project's runtime packages is most likely its framework
  const owners = [...byOwner.values()].sort((a, b) => b.score - a.score || a.org.localeCompare(b.org))
  return { root, deps, owners, unresolved: deps.filter(d => !d.repo && !isNoise(d)).map(d => d.name) }
}

const SHOW_OWNERS = 15

export function discoveryText(found: Discovery[]): string {
  const out: string[] = []
  for (const f of found) {
    if (f.deps.length === 0) continue
    const counted = f.deps.filter(d => d.repo && !isNoise(d))
    const runtime = counted.filter(d => !d.isDev).length
    const dev = counted.length - runtime
    const total = runtime * weight({ isDev: false } as Dep) + dev * weight({ isDev: true } as Dep)
    out.push(`${f.root}: ${f.deps.length} direct dependencies, ${f.owners.length} sources, total weight ${total} (${runtime} runtime × 2 + ${dev} dev × 1)`)
    for (const o of f.owners.slice(0, SHOW_OWNERS)) {
      const names = o.deps.length > 4 ? `${o.deps.slice(0, 4).join(', ')} +${o.deps.length - 4}` : o.deps.join(', ')
      out.push(`  ${o.key.padEnd(30)} ${String(o.score).padStart(3)}  ${names}  [repos: ${o.repos.slice(0, 3).join(', ')}${o.repos.length > 3 ? ', ...' : ''}]`)
    }
    if (f.owners.length > SHOW_OWNERS) out.push(`  ... ${f.owners.length - SHOW_OWNERS} more sources`)
    if (f.unresolved.length > 0)
      out.push(`  no repository known (not installed, or none declared): ${f.unresolved.slice(0, 8).join(', ')}${f.unresolved.length > 8 ? ` +${f.unresolved.length - 8}` : ''}`)
  }
  return out.length > 0 ? out.join('\n') : 'No dependencies found in this folder or the repos one level down.'
}
