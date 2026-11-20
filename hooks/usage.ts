// Usage header (ported from the usage-header mod): model, rate-limit bars with the
// time until they renew, and context, drawn as a band above the prompt.
import type { EngineInterface, SessionRateLimit } from 'claude-code'

export type Snapshot = { model: string; limits: readonly SessionRateLimit[]; contextPercent?: number; now: number }

export const NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
export const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const EIGHTHS = ' ▏▎▍▌▋▊▉'
const BAR = 10

export function left(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return '?'
  let m = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 60000))
  const d = Math.floor(m / 1440)
  m -= d * 1440
  const h = Math.floor(m / 60)
  m -= h * 60
  return d ? `${d}d${h}h` : h ? `${h}h${m}m` : `${m}m`
}

export function prettyModel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : id
}

// 0–100 as a BAR-cell bar with eighth-cell precision; returns [filled, empty]
export function bar(p: number): [string, string] {
  const eighths = Math.round((Math.min(100, Math.max(0, p)) / 100) * BAR * 8)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8 ? EIGHTHS[eighths % 8]! : ''
  return ['█'.repeat(full) + part, '·'.repeat(BAR - full - (part ? 1 : 0))]
}

// Prompt cache of the main thread: when its last request went out, how long the cache holds, how big the prompt is.
export type CacheState = { at: number; ttl?: '5m' | '1h'; tokens: number }
export let cache: CacheState | null = null
export const setCache = (c: CacheState | null) => {
  cache = c
}
const TTL_MS = { '5m': 300_000, '1h': 3_600_000 }
// Minutes until the cache lapses (0 = cold); undefined while no lifetime is known.
export function cacheLeft(c: CacheState | null, now: number): number | undefined {
  if (!c?.ttl) return undefined
  return Math.max(0, Math.ceil((c.at + TTL_MS[c.ttl] - now) / 60000))
}
// The lifetime a request gave its cache: the shorter when it wrote both; a read keeps the last write's.
export const ttlOf = (u: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }, prev?: '5m' | '1h') =>
  u.ephemeral_5m_input_tokens ? '5m' : u.ephemeral_1h_input_tokens ? '1h' : prev

export const usageColor =(p: number) => (p >= 90 ? 'red' : p >= 70 ? 'yellow' : 'green')

export let snap: Snapshot | null = null
export let usageFrame = 0
export const shown: Record<string, number> = {} // bar values mid-tween
let anim: { cancel: () => void } | undefined
let isWorking = false
export const setWorking = (v: boolean) => {
  isWorking = v
}

export async function refreshUsage($: EngineInterface) {
  const [model, usage, now] = await Promise.all([$.session.model(), $.session.usage(), $.clock.now()])
  snap = { model, limits: usage.rateLimits, contextPercent: usage.context.percent, now }
  $.ui.invalidate('ui.render')
}

const isTweening = () => !!snap && snap.limits.some(l => Math.abs((shown[l.kind] ?? 0) - l.percentUsed) > 0.1)

// fast ticks only while a turn runs or a bar is still sliding
export function animateUsage($: EngineInterface) {
  if (anim) return
  anim = $.clock.every(90, () => {
    if (!isWorking && !isTweening()) {
      anim?.cancel()
      anim = undefined
    }
    usageFrame += 1
    $.ui.invalidate('ui.render')
  })
}
