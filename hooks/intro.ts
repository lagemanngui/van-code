// The intro: pixel-art flying kick into Clawd, drawn with half blocks.
// Pixel art drawn with half blocks: each text row holds two pixel rows.
const PAL: Record<string, string> = {
  k: '#2b1d14', // hair
  s: '#e0a77a', // skin
  h: '#b97a52', // skin shade
  w: '#f2f2f2', // belt
  n: '#1f2a44', // pants
  o: '#D97757', // Claude orange
  O: '#f0a07e', // Claude highlight
  b: '#6ec3ff', // sweat drop
  l: '#7a7a7a', // speed lines
  y: '#F5C542', // impact
  Y: '#fff6c8', // impact core
  t: '#E8894F', // title
  T: '#FFC48A', // title highlight
}

const H = 26 // pixels = 13 text rows
export const MAX_W = 72
export const MIN_W = 48

const RUN_A = [
  '.....kkk.......',
  '....kkkkk......',
  '....kkssss.....',
  '....ksssks.....',
  '.....sssss.....',
  '......ss.......',
  '....ssssss.....',
  '...shssssssss..',
  '..sh.ssss...ss.',
  '.sh..ssss....s.',
  '.....hsss......',
  '.....wwww......',
  '.....nnnnn.....',
  '....nnnnnnn....',
  '...nnn...nnn...',
  '..nnn.....nnn..',
  '.nnn.......nn..',
  '.nn.........nn.',
  '.ss.........ss.',
  'ss...........ss',
]
const RUN_B = [
  ...RUN_A.slice(0, 14),
  '.....nn.nnn....',
  '.....nn..nn....',
  '.....nn..nn....',
  '.....nn...nn...',
  '.....ss...ss...',
  '....ss.....ss..',
]
const KICK = [
  '..kkk...........................',
  '.kkkkk..........................',
  '.kkssss.........................',
  '.ksssks.........................',
  '..sssss.........................',
  '...ss..ss.......................',
  '..ssssssss......................',
  '.shsssss.ss.....................',
  'sh.sssss..ss....................',
  's..hsssss.......................',
  '....hssss.......................',
  '.....wwwww......................',
  '.....nnnnnnnnnnnnnnnss',
  '....nnnnnnnnnnnnnnnsss',
  '...nnnn.........................',
  '..nnnn..........................',
  '.nnnn...........................',
  '.ss.............................',
]
const LEG = KICK[12]!.length
const SPEED_LINES = [
  '..........llllllll',
  '................',
  '................',
  '................',
  '.......lllllllllll',
  '................',
  '................',
  '................',
  'llllllllllllll',
  '................',
  '................',
  '................',
  '.....llllllllll',
]
const SPLIT = [
  '..............kkk..............',
  '.............kkkkk.............',
  '.............kssss.............',
  '.............ksksk.............',
  '..............sss..............',
  '...............s...............',
  '..ss.......sssssssss.......ss..',
  '...sssssssssssssssssssssssss...',
  '...........sssssssss...........',
  '............hsssssh............',
  '............hsssssh............',
  '............wwwwwww............',
  '..nnnnnnnnnnnnnnnnnnnnnnnnnnn..',
  'ssnnnnnnnnnnnnnnnnnnnnnnnnnnnss',
]
// Clawd, the Claude Code mascot, from its welcome-screen sprite with rows doubled.
const CLAWD = [
  '...OOOOOOOOOOOO...',
  '...oooooooooooo...',
  '...oo.oooooo.oo...',
  '...oo.oooooo.oo...',
  '.oooooooooooooooo.',
  '.oooooooooooooooo.',
  '...oooooooooooo...',
  '...oooooooooooo...',
  '....o.o....o.o....',
  '....o.o....o.o....',
]
// Wide eyes and a sweat drop when he sees the kick coming.
const CLAWD_SCARED = [
  '.b.OOOOOOOOOOOO...',
  'bbboooooooooooo...',
  '.b.o..oooooo..o...',
  '...o..oooooo..o...',
  '.oooooooooooooooo.',
  '.oooooooooooooooo.',
  '...oooooooooooo...',
  '...oooooooooooo...',
  '...o..o....o..o...',
  '..o....o..o....o..',
]
const BOOM = [
  'y.....y.....y',
  '.y....y....y.',
  '..y..yyy..y..',
  '...yyyYyyy...',
  '..yyyYYYyyy..',
  'yyyyYYYYYyyyy',
  '..yyyYYYyyy..',
  '...yyyYyyy...',
  '..y..yyy..y..',
  '.y....y....y.',
  'y.....y.....y',
]

// 3x5 pixel font, only the letters the title needs.
const FONT: Record<string, string[]> = {
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  E: ['###', '#..', '##.', '#..', '###'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  '-': ['...', '...', '###', '...', '...'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  L: ['#..', '#..', '#..', '#..', '###'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  ' ': ['..', '..', '..', '..', '..'],
}
const TITLE = ['JEAN-CLAUDE', 'VAN CODE']

// Renders the first `count` letters of a line; top row lit for a bit of shine.
function word(text: string, count: number): string[] {
  const rows = ['', '', '', '', '']
  ;[...text].forEach((ch, i) => {
    const g = FONT[ch]!
    rows.forEach((_, r) => {
      const ink = i < count ? (r === 0 ? 'T' : 't') : '.'
      rows[r] += g[r]!.replace(/#/g, ink) + '.'
    })
  })
  return rows
}

// Quarter turn clockwise.
function rotate(art: string[]): string[] {
  const w = Math.max(...art.map(r => r.length))
  return Array.from({ length: w }, (_, x) =>
    art.map((_, y) => art[art.length - 1 - y]![x] ?? '.').join(''),
  )
}
const SPIN = [CLAWD, rotate(CLAWD), rotate(rotate(CLAWD)), rotate(rotate(rotate(CLAWD)))]

const RUN_END = 10
const KICK_END = RUN_END + 8
const SCARED_FROM = RUN_END + 3
const HIT_END = KICK_END + 10
const LETTERS = TITLE.join('').length
const HOLD_FRAMES = 30 // title stays ~3s once spelled out
export const LAST = HIT_END + LETTERS + HOLD_FRAMES
const KICK_ARC = [6, 4, 2, 1, 0, 0, 0, 0]
const ICON_Y = 8

type Pixels = (string | undefined)[][]

export function pixels(f: number, w: number): Pixels {
  const p: Pixels = Array.from({ length: H }, () => Array(w).fill(undefined))
  // impact shake: the whole scene jolts one pixel for a few frames
  const jolt = f >= KICK_END && f < KICK_END + 3 ? ((f - KICK_END) % 2 ? -1 : 1) : 0
  const stamp = (art: string[], x: number, y: number) =>
    art.forEach((row, dy) =>
      [...row].forEach((ch, dx) => {
        const line = p[y + dy]
        const px = x + dx + jolt
        if (ch !== '.' && line && px >= 0 && px < w) line[px] = PAL[ch]
      }),
    )

  const iconX = w - 20
  const kickX = iconX - LEG + 2 // foot sinks 2px into Clawd
  const kickFrom = Math.max(0, kickX - 19)
  const kickY = ICON_Y - 8 // leg rows line up with Clawd's belly

  if (f < RUN_END) {
    stamp(f % 2 ? RUN_B : RUN_A, Math.round((kickFrom * f) / (RUN_END - 1)), H - RUN_A.length)
    stamp(CLAWD, iconX, ICON_Y)
  } else if (f < KICK_END) {
    const k = f - RUN_END
    const x = Math.round(kickFrom + ((kickX - kickFrom) * (k + 1)) / (KICK_END - RUN_END))
    const y = kickY + KICK_ARC[k]!
    stamp(SPEED_LINES, x - 19, y + 1)
    stamp(KICK, x, y)
    const isScared = f >= SCARED_FROM
    stamp(isScared ? CLAWD_SCARED : CLAWD, iconX + (isScared && f % 2 ? 1 : 0), ICON_Y)
  } else if (f < HIT_END) {
    const k = f - KICK_END
    stamp(KICK, kickX, kickY)
    // spinning arc: up, then down and off to the right
    stamp(SPIN[k % 4]!, iconX + 3 + k * 3, Math.round(ICON_Y - 5 * k + 0.7 * k * k))
    if (k < 4) stamp(BOOM, iconX - 4, ICON_Y - 1)
  } else {
    const shown = f - HIT_END
    const [a, b] = TITLE as [string, string]
    const top = word(a, shown)
    const bottom = word(b, shown - a.length)
    stamp(top, Math.round((w - top[0]!.length) / 2), 0)
    stamp(bottom, Math.round((w - bottom[0]!.length) / 2), 6)
    stamp(SPLIT, Math.round((w - SPLIT[0]!.length) / 2), H - SPLIT.length)
  }
  return p
}

export type Cell = { ch: string; fg?: string; bg?: string }

// Two pixel rows -> one row of half-block cells.
export function cells(p: Pixels): Cell[][] {
  const rows: Cell[][] = []
  for (let y = 0; y < p.length; y += 2) {
    rows.push(
      p[y]!.map((top, x): Cell => {
        const bot = p[y + 1]![x]
        if (!top && !bot) return { ch: ' ' }
        if (!bot) return { ch: '▀', fg: top }
        if (!top) return { ch: '▄', fg: bot }
        if (top === bot) return { ch: '█', fg: top }
        return { ch: '▀', fg: top, bg: bot }
      }),
    )
  }
  return rows
}

