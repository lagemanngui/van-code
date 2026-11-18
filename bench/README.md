# van-code bench

The same tasks under three arms, each run graded by a hidden check and costed from Claude Code's own result.

| Arm | What loads |
|---|---|
| `pure` | Claude Code alone: no user settings, plugins, MCP servers or user CLAUDE.md (`--setting-sources project,local --strict-mcp-config`) |
| `vancode` | `pure` + this mod (`--plugin-dir`) |
| `full` | `vancode` + the equipment: the RTK hook and `~/.claude/RTK.md`, the output caps, ponytail and commit-commands (`arms/full.json`) |

Every run starts from a fresh copy of the case's fixture in a temp folder, with a clean environment (`env -i`): a session running the bench would otherwise pass its own `CLAUDE_CODE_PLUGIN_DIRS` on and load the mod in every arm. Built-in plugins load in all three arms alike.

## Run

```sh
python3 bench/run.py --runs 3 --max-cost 10           # every case, every arm
python3 bench/run.py --cases 'heavy-*' --arms pure,vancode --model sonnet
```

`--max-cost` stops launching runs past that total; `--run-budget` caps each run; `-j` runs in parallel (one rate limit for all). Results go to `bench/results/<time>/`: `runs.jsonl` (one line per run: cost, tokens, tool calls by name, turns, time, grade output) and `summary.md` (medians per case and arm). `results/` is not committed.

The `full` arm needs `rtk` on PATH and the ponytail and commit-commands plugins installed; the `heavy-read` case uses Indra and jq when the arm has them.

## Cases

Each folder in `cases/` holds:

- `setup.py <dir>`: builds the fixture (deterministic)
- `prompt.md`: the request, as a person would send it
- `hidden/` (optional): copied in only after Claude finishes, so it never sees them
- `grade.py <dir>`: exit 0 = passed

| Case | Measures |
|---|---|
| `bugfix-pagination` | A typical small fix: correctness and cost |
| `heavy-read` | Answers buried in a 0.9 MB lockfile, 1.8 MB of JSON and a 12-page PDF: what the read guards, jq and Indra save |

## Reading the numbers

- Use the medians across runs, never one run: the same arm varies run to run.
- `cost_usd` is Claude Code's `total_cost_usd`. Haiku calls the mod makes itself (Chong Li) may not be in it.
- On a small task the mod's own instructions and tools add input tokens; the bench shows whether the savings outweigh them.
