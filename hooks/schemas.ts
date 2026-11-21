// Schema guard: a change to a wire contract (protobuf, Avro) that breaks consumers or messages already in flight.

export const SCHEMA_FILE = /\.(proto|avsc)$/

type Field = { name: string; type: string }

// Protobuf fields per message, by tag; and the tags each message reserves.
// shortcut: line patterns, not a proto parser; a field split over lines, `oneof` nesting and map fields are read loosely.
function protoFields(text: string): { fields: Map<string, Map<number, Field>>; reserved: Map<string, Set<number>> } {
  const fields = new Map<string, Map<number, Field>>()
  const reserved = new Map<string, Set<number>>()
  // one entry per open brace: the message or enum it opens, or '' for a oneof, option or other block
  const stack: string[] = []
  for (const raw of text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')) {
    const line = raw.replace(/\/\/.*$/, '')
    const open = line.match(/^\s*(message|enum)\s+(\w+)\s*\{/)
    const outer = stack.filter(Boolean).at(-1)
    for (const [i, ch] of [...line.replace(/"[^"]*"/g, '')].entries())
      if (ch === '{') stack.push(open && i === line.indexOf('{') ? (outer ? `${outer}.${open[2]}` : open[2]!) : '')
      else if (ch === '}') stack.pop()
    const msg = stack.filter(Boolean).at(-1)
    const f = line.match(/^\s*(?:optional\s+|required\s+|repeated\s+)?(map<[^>]+>|[\w.]+)\s+(\w+)\s*=\s*(\d+)/)
    if (msg && f && !/^(message|enum|reserved|option|oneof)$/.test(f[1]!)) {
      const m = fields.get(msg) ?? new Map<number, Field>()
      m.set(Number(f[3]), { name: f[2]!, type: f[1]! })
      fields.set(msg, m)
    }
    const enumValue = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+)\s*[;[]/)
    if (msg && enumValue && !f) {
      const m = fields.get(msg) ?? new Map<number, Field>()
      m.set(Number(enumValue[2]), { name: enumValue[1]!, type: 'enum value' })
      fields.set(msg, m)
    }
    const res = line.match(/^\s*reserved\s+([\d\s,to]+);/)
    if (msg && res) {
      const set = reserved.get(msg) ?? new Set<number>()
      for (const part of res[1]!.split(',')) {
        const [a, b] = part.split('to').map(s => Number(s.trim()))
        for (let n = a!; n <= (b ?? a!) && n - a! < 10_000; n++) set.add(n)
      }
      reserved.set(msg, set)
    }
  }
  return { fields, reserved }
}

export function protoBreaks(before: string, after: string): string[] {
  const a = protoFields(before)
  const b = protoFields(after)
  const out: string[] = []
  for (const [msg, oldFields] of a.fields) {
    const now = b.fields.get(msg)
    if (!now) {
      out.push(`\`${msg}\` was removed`)
      continue
    }
    for (const [tag, f] of oldFields) {
      const g = now.get(tag)
      if (!g) {
        if (!b.reserved.get(msg)?.has(tag)) out.push(`\`${msg}.${f.name}\` (= ${tag}) was removed without \`reserved ${tag};\`, so the tag can be reused later`)
      } else if (g.type !== f.type) out.push(`\`${msg}.${f.name}\` (= ${tag}) changed type ${f.type} → ${g.type}: old messages decode wrong`)
      else if (g.name !== f.name && f.type !== 'enum value') out.push(`\`${msg}.${f.name}\` (= ${tag}) was renamed to \`${g.name}\`: the wire is fine, JSON consumers break`)
    }
    for (const [tag, g] of now) if (a.reserved.get(msg)?.has(tag)) out.push(`\`${msg}.${g.name}\` reuses reserved tag ${tag}`)
  }
  return out
}

type AvroRecord = { type?: unknown; name?: string; fields?: { name: string; type: unknown; default?: unknown }[] }

// Every record in an Avro schema, by name, nested ones included.
function avroRecords(node: unknown, out = new Map<string, AvroRecord>()): Map<string, AvroRecord> {
  if (Array.isArray(node)) for (const n of node) avroRecords(n, out)
  else if (node && typeof node === 'object') {
    const r = node as AvroRecord
    if (r.type === 'record' && r.name) out.set(r.name, r)
    for (const v of Object.values(node)) if (v && typeof v === 'object') avroRecords(v, out)
  }
  return out
}

export function avroBreaks(before: string, after: string): string[] {
  let a: Map<string, AvroRecord>
  let b: Map<string, AvroRecord>
  try {
    a = avroRecords(JSON.parse(before))
    b = avroRecords(JSON.parse(after))
  } catch {
    return [] // not valid JSON: the post-edit check's job
  }
  const out: string[] = []
  const typeOf = (t: unknown) => JSON.stringify(t)
  for (const [name, oldRec] of a) {
    const now = b.get(name)
    if (!now) {
      out.push(`record \`${name}\` was removed`)
      continue
    }
    const oldF = new Map((oldRec.fields ?? []).map(f => [f.name, f]))
    const newF = new Map((now.fields ?? []).map(f => [f.name, f]))
    for (const [f, of] of oldF) {
      const nf = newF.get(f)
      if (!nf) {
        if (of.default === undefined) out.push(`\`${name}.${f}\` was removed and had no default: readers on the old schema fail on new data`)
      } else if (typeOf(nf.type) !== typeOf(of.type)) out.push(`\`${name}.${f}\` changed type ${typeOf(of.type)} → ${typeOf(nf.type)}`)
    }
    for (const [f, nf] of newF) if (!oldF.has(f) && nf.default === undefined) out.push(`\`${name}.${f}\` was added with no default: data written on the old schema can no longer be read`)
  }
  return out
}

export const schemaBreaks = (file: string, before: string, after: string) =>
  file.endsWith('.proto') ? protoBreaks(before, after) : avroBreaks(before, after)

export const schemaNote = (file: string, breaks: string[]) =>
  `[Jean-Claude Van Code] Schema guard: ${file} changed incompatibly against the last commit:\n${breaks.map(b => `- ${b}`).join('\n')}\n` +
  'Producers and consumers deploy at different times, and messages already in flight use the old schema. Make the change additive (new field, deprecate the old, reserve its tag), or tell the user in one line why breaking it is safe here.'
