<img width="1334" height="502" alt="Jean-Claude Van Code: a pixel-art fighter flying-kicks Clawd, Claude Code's mascot" src="https://github.com/user-attachments/assets/d54be0a3-0f5a-4886-a5ec-bb542eae703d" />

# Jean-Claude Van Code

**A Claude Code plugin that guards what Claude reads, checks every edit, and makes it prove the work before saying done.**

Claude Code is quick to read a whole lockfile, retry the same failing command, and say "all green" without running a test. Van Code sits in its hooks and catches those moments as they happen: it refuses the wasteful read, hands back the type error right after the edit, and holds "done" until a test or build actually ran. It does this with hooks, not a longer prompt, and every behavior has its own off switch.

**Status:** early and moving fast. 0.4.x, started in November 2026 and used daily by its author. Behavior and settings may still change between minor versions. macOS and Linux.

## Install

From a shell:

```sh
claude plugin install van-code --marketplace lagemanngui/van-code
```

Or at the prompt of a Claude Code session, `/plugin install van-code --marketplace lagemanngui/van-code`. Answer `y` to add the marketplace and press Enter for the user scope. In the desktop app, where `/plugin` does not run: **+** next to the prompt box, **Plugins**, **Add marketplace** with `lagemanngui/van-code`, then **Add plugin**.

Then run this once in a session:

```
/van-code-setup
```

It installs the recommended tools: [`rtk`](https://github.com/rtk-ai/rtk) for leaner command output, language servers, and a few official plugins. The full list is in [Factory equipment](docs/features.md#factory-equipment). You'll know it worked when the flying-kick intro plays on the next start.

## Why use it

- **No wasted reads.** Whole reads of lockfiles, `node_modules`, build output and minified files are blocked, and Claude is pointed to Grep. A file that has not changed is not re-read. A 2 MB JSON goes to `jq`, a 12-page PDF to local OCR.
- **Errors caught at the edit.** `tsc`, `ruff`, `go vet`, `bash -n`, `terraform validate` and `helm lint` run on each edited file, and their errors go straight back to Claude. A clean check costs zero tokens.
- **"Done" has to be earned.** If code changed and nothing ran, Claude is asked to verify, and gets the exact tests that reach the change (`affected_tests` follows the imports). A UI change gets walked in a browser with Playwright.
- **A second opinion, cheaply.** Big or risky diffs (auth, money, migrations, SQL, parsing) get an adversarial review by Haiku, which must name one concrete failing case or stay quiet.
- **Safety rails for live infra.** `terraform apply`, `kubectl`/`helm` changes and cloud deletes are held until a plan, diff or dry run has run.
- **Your session, visible.** A band above the prompt shows the model, the 5h/7d rate limits, context, and how many minutes the prompt cache has left. `/van-code-stats` shows what the mod saved and what it spent.

Also included: receipts that check the final answer's test counts and commit hashes against the tool output, assumption and target ledgers for multi-repo work, compaction that keeps your constraints, a guard against AI attribution in commits, and the [i-have-adhd](https://github.com/ayghri/i-have-adhd) output style. The [feature reference](docs/features.md) covers each one.

## When not to use it

- **You want the cheapest possible session.** The mod adds about 2k tokens of instructions to each request (prompt-cached) and some Haiku calls. It buys care, not a lower bill: see [Cost](#cost).
- **You don't want Claude Code's behavior changed.** The guards refuse reads and hold commands by design. Each one can be turned off in `/config`, but if you'd turn most of them off, a lighter setup will suit you better.
- **Windows without WSL.** The setup relies on Homebrew or Linux installers, and that combination is untested.

## Commands

| Command | What it does |
|---|---|
| `/van-code-setup [items]` | Installs the missing recommended tools; with names, optional ones too (`/van-code-setup playwright`) |
| `/van-code-stats` | Session scoreboard: what was saved and blocked, last request's cost and cache hit rate, average cost per request |
| `/van-code-scan` | Finds official AI resources (plugins, skills, `llms.txt`) for your project's dependencies. See [Stack scan](docs/features.md#stack-scan) |
| `/chong-li` | Adversarial review of the latest changes: one concrete way they break, or nothing |
| `/van-code-guard` | Turns the heavy-file guard off or on for this session |
| `/van-code:i-have-adhd` | Turns the ADHD-friendly output style back on after a "stop adhd mode" |
| `/van-code` | Replays the intro and re-checks the equipment. Hi-yah! |

Every automatic behavior has a switch in `/config`, all on by default: the [full settings list](docs/features.md#settings).

## Cost

Most of the mod is local code in hooks and spends no tokens. What does spend them:

- Its instructions in the system prompt, about 2k tokens per request. They stay fixed for the whole conversation, so after the first request they are read from the prompt cache.
- Haiku calls: Chong Li (only on big or risky changes) and reply suggestions (only when Claude Code shows none). Both show in `/van-code-stats`.

The [`bench/`](bench/README.md) folder runs the same tasks with and without the mod. On its five small cases the pass rate was the same with and without it, and the median cost went from 11% cheaper to 33% more expensive. Where it should pay off is a big repo: a whole read of a 0.9 MB lockfile is about 200k tokens, a hundred times the instructions. The bench does not measure that case yet.

## Development

```sh
claude plugin test .          # the test suite
npm install && npm run typecheck
```

To run a working copy, add its folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, and do not install the marketplace copy at the same time.

| File | Contents |
|---|---|
| `hooks/register.tsx` | The hooks: guards, checks, reviews, suggestions and the band above the prompt |
| `hooks/factory.ts` | Factory equipment: checks and installs |
| `hooks/checks.ts` | Post-edit checkers and the affected-tests search |
| `hooks/usage.ts` | The usage header and the cache countdown |
| `hooks/intro.ts` | The pixel-art intro |
| `bench/` | Cost and correctness benchmark against plain Claude Code |

## License

MIT. `skills/i-have-adhd` is copied unchanged from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) at `1ecea19`, MIT, © 2026 Ayoub Ghriss. Its `LICENSE` sits beside it.
