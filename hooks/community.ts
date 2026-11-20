// Stack scan, step 3 (network, on demand): for owners with nothing official, the community's
// skills from the skills.sh registry. Never installed on their own: shown with who wrote them.
import type { Finding } from './official.js'
import type { Owner } from './scan.js'

export type CommunitySkill = { owner: string; term: string; name: string; source: string; skillId: string; installs: number; url: string; install: string[] }

const SEARCH = 'https://skills.sh/api/search' // what `npx skills find` asks (vercel-labs/skills)
const OWNERS_MAX = 10
const PER_OWNER = 3
const MIN_INSTALLS = 10 // the registry's search is fuzzy; a skill nobody installs is mostly noise
const MIN_TERM = 5 // "http" or "pdf" match every other skill, none of them about this package

const norm = (s: string) => s.toLowerCase().replace(/[_\s.]+/g, '-')

// What to search for: the npm scope the owner's packages share (@adonisjs/*), else its main package.
export function termFor(owner: Owner): string {
  const scopes = owner.deps.map(d => d.match(/^@([^/]+)\//)?.[1]).filter((s): s is string => !!s)
  if (scopes.length > 0 && scopes.length === owner.deps.length && new Set(scopes).size === 1) return norm(scopes[0]!)
  return norm(owner.deps[0]!.replace(/^@[^/]+\//, ''))
}

export async function findCommunity(fetchJson: (url: string) => Promise<unknown>, owners: Owner[], official: Finding[]): Promise<CommunitySkill[]> {
  // an owner that publishes something real for agents needs no stand-in; an MCP "see also" is not that
  const covered = new Set(official.filter(f => f.kind !== 'mcp').map(f => f.owner))
  const ask = owners.filter(o => !covered.has(o.key)).slice(0, OWNERS_MAX)
  const lists = await Promise.all(
    ask.map(async o => {
      const term = termFor(o)
      if (term.length < MIN_TERM) return []
      const json = (await fetchJson(`${SEARCH}?${new URLSearchParams({ q: term })}`).catch(() => undefined)) as { skills?: unknown } | undefined
      const skills = (Array.isArray(json?.skills) ? json.skills : []) as Record<string, unknown>[]
      return skills
        .filter(s => typeof s === 'object' && s !== null && typeof s.source === 'string' && typeof s.skillId === 'string' && typeof s.name === 'string')
        .map(s => ({ name: s.name as string, source: s.source as string, skillId: s.skillId as string, installs: typeof s.installs === 'number' ? s.installs : 0 }))
        // about this package by name, not a fuzzy neighbour ("IP Geolocator" for geolocator)
        .filter(s => s.installs >= MIN_INSTALLS && (norm(s.name).includes(term) || norm(s.skillId).includes(term)))
        // from an org already shown as official (flutter/agent-plugins): it is listed there, not here
        .filter(s => !covered.has(`github.com/${s.source.split('/')[0]!.toLowerCase()}`))
        .sort((a, b) => b.installs - a.installs)
        .slice(0, PER_OWNER)
        .map(s => ({
          owner: o.key,
          term,
          ...s,
          url: `https://skills.sh/${s.source}/${s.skillId}`,
          install: [`npx skills add ${s.source} --skill ${s.skillId} -a claude-code -y`],
        }))
    }),
  )
  return lists.flat()
}

export function communityText(owners: Owner[], found: CommunitySkill[]): string {
  const out: string[] = []
  for (const o of owners) {
    const mine = found.filter(f => f.owner === o.key)
    if (mine.length === 0) continue
    out.push(`${o.key} (searched "${mine[0]!.term}")`)
    for (const f of mine) {
      out.push(`  [community] ${f.name} by ${f.source.split('/')[0]}, ${f.installs} installs: review it before installing`)
      out.push(`      ${f.url}`)
      for (const c of f.install) out.push(`      $ ${c}`)
    }
  }
  return out.length > 0 ? out.join('\n') : 'No community skills found for the rest.'
}
