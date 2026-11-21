"""Self-check of the stream parser and summary: python3 bench/test_run.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from run import block_kind, blocks_cell, parse_stream  # noqa: E402

DENY = ('<tool_use_error>Jean-Claude Van Code: /w/package-lock.json is a heavy file (lockfile, dependency, '
        'build output or minified). Use Grep to find what you need</tool_use_error>')
lines = [
    {'type': 'system', 'subtype': 'init', 'model': 'm', 'plugins': [{'name': 'van-code', 'path': '/x'}, {'name': 'b', 'path': 'builtin'}]},
    {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'id': 't1', 'name': 'Read'}, {'type': 'tool_use', 'id': 't2', 'name': 'Bash'}]}},
    {'type': 'user', 'message': {'content': [
        {'type': 'tool_result', 'tool_use_id': 't1', 'is_error': True, 'content': DENY},
        {'type': 'tool_result', 'tool_use_id': 't2', 'is_error': True, 'content': [{'type': 'text', 'text': 'Exit code 1'}]},
    ]}},
    {'type': 'result', 'total_cost_usd': 0.5, 'num_turns': 2, 'usage': {'input_tokens': 10, 'cache_read_input_tokens': 5}, 'permission_denials': []},
]
r = parse_stream('\n'.join(json.dumps(l) for l in lines) + '\nnot json\n')
assert r['plugins'] == ['van-code'], r
assert r['tools'] == {'Read': 1, 'Bash': 1} and r['tool_calls'] == 2, r
assert r['mod_blocks'] == 1 and r['blocks'][0]['tool'] == 'Read' and r['blocks'][0]['kind'] == 'heavy', r
assert r['tool_errors'] == 1 and r['input_tokens'] == 15, r
assert block_kind('Jean-Claude Van Code: you already read /a (these lines)') == 'repeat-read'
assert block_kind('Jean-Claude Van Code: /a.pdf is cheaper as text') == 'pdf-ocr'
assert block_kind('Jean-Claude Van Code: /a.ts is 900 lines. Its outline (a range') == 'outline'
assert blocks_cell([r, r]) == '2: heavy×2' and blocks_cell([{}]) == '0'

# the real stream a van-code refusal produced, when the probe is still around
probe = Path('/private/tmp/claude-501/-Users-gui/66c927c9-c279-4f62-81be-17aa105ee9f4/scratchpad/denyprobe/stream.jsonl')
if probe.exists():
    real = parse_stream(probe.read_text())
    assert real['mod_blocks'] >= 1 and real['blocks'][0]['kind'] == 'heavy', real
    print('real stream:', real['blocks'][0]['tool'], real['blocks'][0]['kind'])
print('ok')
