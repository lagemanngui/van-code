import { expect, test } from 'claude-code/testing'

import { avroBreaks, protoBreaks } from './schemas.js'

const PROTO = `syntax = "proto3";
message Order {
  string id = 1;
  int64 total_cents = 2;
  oneof payer {
    string user_id = 3;
    string org_id = 4;
  }
  message Line { string sku = 1; }
  enum Status {
    PENDING = 0;
    PAID = 1;
  }
}`

test('protobuf: removed, retyped, renamed and reused tags are breaking; additions are not', () => {
  expect(protoBreaks(PROTO, PROTO.replace('  string id = 1;\n', '  string id = 1;\n  string note = 9;\n'))).toEqual([])
  expect(protoBreaks(PROTO, PROTO.replace('  int64 total_cents = 2;\n', ''))).toEqual(['`Order.total_cents` (= 2) was removed without `reserved 2;`, so the tag can be reused later'])
  expect(protoBreaks(PROTO, PROTO.replace('  int64 total_cents = 2;\n', '  reserved 2;\n'))).toEqual([])
  expect(protoBreaks(PROTO, PROTO.replace('int64 total_cents = 2', 'int32 total_cents = 2'))).toEqual(['`Order.total_cents` (= 2) changed type int64 → int32: old messages decode wrong'])
  expect(protoBreaks(PROTO, PROTO.replace('string org_id = 4', 'string team_id = 4'))).toEqual(['`Order.org_id` (= 4) was renamed to `team_id`: the wire is fine, JSON consumers break'])
  expect(protoBreaks(PROTO.replace('  int64 total_cents = 2;\n', '  reserved 2;\n'), PROTO.replace('  int64 total_cents = 2;\n', '  reserved 2;\n  string coupon = 2;\n'))).toEqual(['`Order.coupon` reuses reserved tag 2'])
  expect(protoBreaks(PROTO, PROTO.replace('    PAID = 1;\n', ''))).toEqual(['`Order.Status.PAID` (= 1) was removed without `reserved 1;`, so the tag can be reused later'])
})

test('avro: a field added or removed without a default, or retyped, is breaking', () => {
  const v1 = JSON.stringify({ type: 'record', name: 'Order', fields: [{ name: 'id', type: 'string' }, { name: 'note', type: ['null', 'string'], default: null }] })
  const add = (f: object) => JSON.stringify({ type: 'record', name: 'Order', fields: [{ name: 'id', type: 'string' }, { name: 'note', type: ['null', 'string'], default: null }, f] })
  expect(avroBreaks(v1, add({ name: 'total', type: 'long', default: 0 }))).toEqual([])
  expect(avroBreaks(v1, add({ name: 'total', type: 'long' }))).toEqual(['`Order.total` was added with no default: data written on the old schema can no longer be read'])
  expect(avroBreaks(v1, JSON.stringify({ type: 'record', name: 'Order', fields: [{ name: 'note', type: ['null', 'string'], default: null }] }))).toEqual(['`Order.id` was removed and had no default: readers on the old schema fail on new data'])
  expect(avroBreaks(v1, v1.replace('"id","type":"string"', '"id","type":"int"'))).toEqual(['`Order.id` changed type "string" → "int"'])
  expect(avroBreaks(v1, '{ not json')).toEqual([])
})

test('an edit of a .proto is compared with its last commit', async ($, on) => {
  on('fs.read', () => ({ value: PROTO.replace('  int64 total_cents = 2;\n', '') }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: e.argv.includes('show') ? PROTO : '', stderr: '' } }) as never)
  on('tool.call', () => ({ result: {} }))
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/r/proto/order.proto', old_string: '  int64 total_cents = 2;\n', new_string: '' } as never)
  expect((ran.context ?? []).join('\n')).toContain('Schema guard: /r/proto/order.proto changed incompatibly')
})
