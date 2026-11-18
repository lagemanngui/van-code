#!/usr/bin/env python3
"""Benchmark: the same tasks under three arms, scored and costed.

  pure     Claude Code alone: no user settings, plugins, MCP or CLAUDE.md.
  vancode  pure + the van-code mod (--plugin-dir).
  full     vancode + the equipment: RTK hook and instructions, env caps, ponytail, commit-commands.

Each run gets a fresh copy of the case's fixture, a clean environment (env -i, so this
session's own CLAUDE_CODE_PLUGIN_DIRS and caps do not leak in), and is graded by the case's
hidden check after Claude finishes. Python 3.9+, stdlib only.

  python3 bench/run.py --runs 3 --max-cost 10
  python3 bench/run.py --cases bugfix-* --arms pure,vancode --model sonnet
"""
import argparse
import concurrent.futures
import fnmatch
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

BENCH = Path(__file__).resolve().parent
MOD = BENCH.parent
HOME = Path.home()
ARMS = ['pure', 'vancode', 'full']
TOOLS = 'Bash,Read,Edit,Write,Grep,Glob,mcp__van-code'


def arm_flags(arm):
    flags = ['--setting-sources', 'project,local', '--strict-mcp-config']
    if arm in ('vancode', 'full'):
        flags += ['--plugin-dir', str(MOD)]
    if arm == 'full':
        flags += ['--settings', str(BENCH / 'arms' / 'full.json')]
        rtk = HOME / '.claude' / 'RTK.md'
        if rtk.exists():
            flags += ['--append-system-prompt-file', str(rtk)]
    return flags


def clean_env():
    # only what login and the tools need; nothing from the session running the bench
    keep = ['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'LANG']
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env['TERM'] = 'dumb'
    return env


def run_one(case, arm, i, args):
    work = Path(tempfile.mkdtemp(prefix=f'vcbench-{case.name}-{arm}-'))
    rec = {'case': case.name, 'arm': arm, 'run': i, 'work': str(work)}
    try:
        subprocess.run([sys.executable, '-I', str(case / 'setup.py'), str(work)], check=True, capture_output=True)
        subprocess.run(['git', 'init', '-q'], cwd=work, check=True)
        subprocess.run(['git', 'add', '-A'], cwd=work, check=True)
        subprocess.run(['git', '-c', 'user.name=bench', '-c', 'user.email=bench@localhost', 'commit', '-qm', 'fixture'], cwd=work, check=True)
        cmd = ['claude', '-p', (case / 'prompt.md').read_text(), '--output-format', 'stream-json', '--verbose',
               '--no-session-persistence', '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS,
               '--max-budget-usd', str(args.run_budget)] + arm_flags(arm)
        if args.model:
            cmd += ['--model', args.model]
        t0 = time.time()
        p = subprocess.run(cmd, cwd=work, env=clean_env(), stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=args.timeout)
        rec['wall_s'] = round(time.time() - t0, 1)
        tools = {}
        for line in p.stdout.splitlines():
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get('type') == 'system' and m.get('subtype') == 'init':
                rec['model'] = m.get('model')
                rec['plugins'] = sorted(x['name'] for x in m.get('plugins', []) if x.get('path') != 'builtin')
            elif m.get('type') == 'assistant':
                for b in m.get('message', {}).get('content', []):
                    if b.get('type') == 'tool_use':
                        tools[b['name']] = tools.get(b['name'], 0) + 1
            elif m.get('type') == 'result':
                u = m.get('usage') or {}
                rec.update(
                    cost_usd=m.get('total_cost_usd'),
                    turns=m.get('num_turns'),
                    is_error=m.get('is_error'),
                    input_tokens=(u.get('input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0),
                    output_tokens=u.get('output_tokens') or 0,
                    answer=(m.get('result') or '')[-500:],
                )
        rec['tools'] = tools
        rec['tool_calls'] = sum(tools.values())
        if 'cost_usd' not in rec:
            rec['error'] = 'no result: ' + p.stderr[-500:]
        # hidden check: copied in only now, so Claude never saw it
        hidden = case / 'hidden'
        if hidden.exists():
            shutil.copytree(hidden, work, dirs_exist_ok=True)
        g = subprocess.run([sys.executable, '-I', str(case / 'grade.py'), str(work)], capture_output=True, text=True, timeout=300)
        rec['passed'] = g.returncode == 0
        rec['grade_out'] = (g.stdout + g.stderr)[-800:]
    except subprocess.TimeoutExpired:
        rec.update(passed=False, error='timeout')
    except Exception as err:  # a broken run is recorded, never fatal
        rec.update(passed=False, error=repr(err))
    finally:
        if not args.keep:
            shutil.rmtree(work, ignore_errors=True)
    return rec


def med(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return statistics.median(xs) if xs else None


def summarize(recs):
    rows = ['| case | arm | passed | cost US$ (median) | input tokens | output tokens | tool calls | turns | wall s |',
            '|---|---|---|---|---|---|---|---|---|']
    for case in sorted({r['case'] for r in recs}):
        for arm in ARMS:
            rs = [r for r in recs if r['case'] == case and r['arm'] == arm]
            if not rs:
                continue
            f = lambda k, fmt='{:.0f}': (fmt.format(med([r.get(k) for r in rs])) if med([r.get(k) for r in rs]) is not None else '–')
            rows.append(f"| {case} | {arm} | {sum(r.get('passed', False) for r in rs)}/{len(rs)} | {f('cost_usd', '{:.3f}')} | "
                        f"{f('input_tokens')} | {f('output_tokens')} | {f('tool_calls')} | {f('turns')} | {f('wall_s')} |")
    return '\n'.join(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--runs', type=int, default=3)
    ap.add_argument('--arms', default=','.join(ARMS))
    ap.add_argument('--cases', default='*', help='glob over case folder names')
    ap.add_argument('--model', help='model for every run (default: Claude Code default)')
    ap.add_argument('--max-cost', type=float, default=10.0, help='stop launching runs past this total, US$')
    ap.add_argument('--run-budget', type=float, default=3.0, help='per-run --max-budget-usd')
    ap.add_argument('--timeout', type=int, default=900, help='per-run seconds')
    ap.add_argument('-j', '--jobs', type=int, default=3)
    ap.add_argument('--keep', action='store_true', help='keep the run folders')
    args = ap.parse_args()

    arms = [a for a in args.arms.split(',') if a]
    assert all(a in ARMS for a in arms), f'arms are {ARMS}'
    cases = sorted(c for c in (BENCH / 'cases').iterdir() if c.is_dir() and fnmatch.fnmatch(c.name, args.cases))
    assert cases, 'no case matches'
    # arm-major interleaving so a cost stop leaves every arm with similar coverage
    jobs = [(c, a, i) for i in range(args.runs) for c in cases for a in arms]

    out_dir = BENCH / 'results' / time.strftime('%Y%m%d-%H%M%S')
    out_dir.mkdir(parents=True)
    spent = 0.0
    lock = threading.Lock()
    recs = []

    def go(job):
        nonlocal spent
        with lock:
            if spent >= args.max_cost:
                return None
        r = run_one(*job, args)
        with lock:
            spent += r.get('cost_usd') or 0
            recs.append(r)
            with open(out_dir / 'runs.jsonl', 'a') as f:
                f.write(json.dumps(r) + '\n')
            print(f"[{len(recs)}/{len(jobs)}] {r['case']} {r['arm']} #{r['run']}: "
                  f"{'pass' if r.get('passed') else 'FAIL'} US$ {r.get('cost_usd') or 0:.3f} total {spent:.2f}"
                  + (f" ({r['error']})" if r.get('error') else ''), flush=True)
        return r

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        list(ex.map(go, jobs))

    table = summarize(recs)
    skipped = len(jobs) - len(recs)
    note = f'\n\n{skipped} runs skipped: the US$ {args.max_cost} ceiling was reached.' if skipped else ''
    (out_dir / 'summary.md').write_text(f'# van-code bench {out_dir.name}\n\n{table}{note}\n')
    print('\n' + table + note + f'\n\nResults: {out_dir}')


if __name__ == '__main__':
    main()
