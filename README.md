<img width="1334" height="502" alt="Jean-Claude Van Code: a pixel-art fighter flying-kicks Clawd, Claude Code's mascot" src="https://github.com/user-attachments/assets/d54be0a3-0f5a-4886-a5ec-bb542eae703d" />

# Jean-Claude Van Code

**Production discipline for Claude Code: proof before "done", no silenced failures, nothing that passes on a laptop and breaks the deploy.**

Claude Code writes code that passes where it was written: the test it chose to run, on the data it had. What breaks later is what nobody checked. A migration that locks a big table during the deploy, a protobuf field removed while another team's consumer still reads it, an `as any` that turned a failing check green, a dependency nobody asked for. Van Code sits in Claude Code's hooks and catches those moments as they happen. It holds "done" until a test that reaches the change ran, hands back the type error right after the edit, and flags the change that is fine locally and wrong in production. It does this mostly with deterministic checks in hooks (two cheap Haiku reviews aside), not a longer prompt, and every behavior can be turned off.

It is built for engineers who review what ships to real users, not for one-prompt prototypes.

**Status:** early and moving fast. 0.4.x, started in November 2026 and used daily by its author. Behavior and settings may still change between minor versions. macOS and Linux.

## Install

From a shell:

```sh
claude plugin install van-code --marketplace lagemanngui/van-code
```

Or at the prompt of a Claude Code session, `/plugin install van-code --marketplace lagemanngui/van-code`. Answer `y` to add the marketplace and press Enter for the user scope. In the desktop app, where `/plugin` does not run: **+** next to the prompt box, **Plugins**, **Add marketplace** with `lagemanngui/van-code`, then **Add plugin**.

Then run this once in a session:

```
/van-code:setup
```

It installs the recommended tools: [`rtk`](https://github.com/rtk-ai/rtk) for leaner command output, language servers, and a few official plugins. The full list is in [Factory equipment](docs/features.md#factory-equipment). You'll know it worked when the flying-kick intro plays on the next start.

## Why use it

> **31 automatic behaviors, switched in `/config` or for one session with `/van-code off <feature>`.** The highlights are below; every one is explained in the **[full feature reference →](docs/features.md)**.

- **"Done" has to be earned.** If code changed and nothing ran, Claude is asked to verify and handed the exact tests that reach the change (`affected_tests` follows the imports). Tests that don't touch the edited code don't count.
- **No cheating to get green.** After a failing check or test, an edit that silences it instead of fixing it (`as any`, `@ts-ignore`, a skipped test, `|| true`, a removed assertion) is flagged on the spot.
- **Errors caught at the edit.** `tsc`, `ruff`, `go vet`, `bash -n`, `terraform validate` and `helm lint` run on each edited file, and the errors go straight back to Claude. A clean check costs zero tokens.
- **Reads that don't waste.** Lockfiles, build output and big logs are blocked whole; a 1,500-line file comes back first as its outline with line ranges; a file read before and changed since comes back as its diff.
- **Kept to what you asked.** A dependency or config file your request never named is flagged where it was added, and after a big turn Haiku lists what was done unasked, or left out.
- **Code with a history is respected.** An edit that removes lines a past fix put there gets that fix's commit (`git blame` finds it), so Claude checks the bug doesn't come back.
- **Safe to deploy.** A migration that would lock a big table or break the running code (`DROP COLUMN`, `NOT NULL` without a default, an index without `CONCURRENTLY`) gets the expand-and-contract form instead, and a `.proto` or Avro change that breaks consumers is caught against the last commit.
- **A colleague's PR, triaged before you read it.** `/van-code:review` runs the same checks over a branch or a PR, from any folder (`org/repo#123`), and hands back the files in risk order with numbered comment drafts. No tokens; `--claude` has Claude prove or drop each blocker.
- **Safety rails for infra and git.** `terraform apply`, `kubectl`/`helm` changes and cloud deletes wait for a plan or dry run; `reset --hard` over uncommitted work and force pushes are held once.

Also in the box: an adversarial Haiku review of risky diffs (Chong Li), an end-of-turn clean-room check (debug leftovers, raw payloads or secrets in logs, a query per loop item, unbounded `Promise.all`, `localhost` URLs, undocumented env vars, imports that only work on macOS), receipts that check the final answer against the tool output, compaction that keeps your constraints, and a band showing rate limits and the prompt cache countdown.

**→ [See all features, settings and the tools `/van-code:setup` installs](docs/features.md)**

## When not to use it

- **You are prototyping and want Claude unconstrained.** For a throwaway demo, the checks that protect a production codebase are friction.
- **You want the cheapest possible session.** The mod adds about 2k tokens of instructions to each request (prompt-cached) and some Haiku calls. It buys care, not a lower bill: see [Cost](#cost). The `minimal` profile drops both and keeps only the safety rails and read savings.
- **You don't want Claude Code's behavior changed.** The guards refuse reads and hold commands by design. Each one can be turned off in `/config` (or a group at once with a profile), but if you'd turn most of them off, a lighter setup will suit you better.
- **Windows without WSL.** The setup relies on Homebrew or Linux installers, and that combination is untested.

## Commands

| Command | What it does |
|---|---|
| `/van-code:setup [items]` | Installs the missing recommended tools; with names, optional ones too (`/van-code:setup playwright`) |
| `/van-code` | Every switch by group, on or off and how often it fired. `off <feature>` / `on <feature>` for this session, `profile full\|light\|minimal`, `reset`, `intro` (the flying kick, Hi-yah!) |
| `/van-code:log` | The last 20 times the mod stepped in: when, which behavior, on what |
| `/van-code:stats` | Session scoreboard: what was saved and blocked, last request's cost and cache hit rate, average cost per request, and the last 30 days |
| `/van-code:scan` | Finds official AI resources (plugins, skills, `llms.txt`) for your project's dependencies. See [Stack scan](docs/features.md#stack-scan) |
| `/van-code:review [branch\|#123\|org/repo#123\|PR URL] [--claude]` | Triages a colleague's branch or PR before you read it: files in risk order, the mod's checks over the diff, numbered comment drafts. No tokens; `--claude` has Claude check the blockers. See [Reviewing a colleague's change](docs/features.md#reviewing-a-colleagues-change) |
| `/van-code:chong-li` | Adversarial review of the latest changes: one concrete way they break, or nothing |
| `/van-code:guard` | Turns the heavy-file guard off or on for this session (same as `/van-code off guard`) |
| `/van-code:i-have-adhd` | Turns the ADHD-friendly output style back on after a "stop adhd mode" |

Every automatic behavior has a switch in `/config`, all on by default, and a **Profile** picker (`full`, `light`, `minimal`) turns groups off at once: the [full settings list](docs/features.md#settings). Findings show as one toast per turn; [Seeing and steering it](docs/features.md#seeing-and-steering-it) has the details.

## Cost

Most of the mod is local code in hooks and spends no tokens. What does spend them:

- Its instructions in the system prompt, about 2k tokens per request (most of it the ADHD output style). They stay fixed for the whole conversation, so after the first request they are read from the prompt cache. The `minimal` profile, or turning off `rules` and `adhd`, removes them.
- Haiku calls: Chong Li (only on big or risky changes), the intent diff (only on turns of 30 or more changed lines) and reply suggestions (only when Claude Code shows none). All show in `/van-code:stats`.

The [`bench/`](bench/README.md) folder runs the same tasks with and without the mod. On its five small cases the pass rate was the same with and without it, and the median cost went from 11% cheaper to 33% more expensive. Where it should pay off is a big repo: a whole read of a 0.9 MB lockfile is about 200k tokens, a hundred times the instructions. The bench does not measure that case yet.

## Development

```sh
claude plugin test .          # the test suite
npm install && npm run typecheck
```

To run a working copy, add its folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, and do not install the marketplace copy at the same time.

| File | Contents |
|---|---|
| `hooks/register.tsx` | The hooks: guards, checks, reviews, suggestions, the commands and the band above the prompt |
| `hooks/checks.ts` | Post-edit checkers and the affected-tests search |
| `hooks/cheats.ts`, `cleanroom.ts`, `migrations.ts`, `schemas.ts`, `archaeology.ts`, `intent.ts` | The production checks, as pure functions over text (shared by the hooks and `/van-code:review`) |
| `hooks/review.ts` | `/van-code:review`: risk tiers, findings per file, the report |
| `hooks/switches.ts` | Switch groups, profiles, the 30-day history and the turn's toast |
| `hooks/infra.ts`, `git.ts`, `attribution.ts`, `reads.ts`, `outline.ts`, `receipts.ts`, `loops.ts`, `card.ts` | The guards' and checks' parsers |
| `hooks/factory.ts`, `kitty.ts`, `stack.ts`, `scan.ts`, `official.ts`, `community.ts` | Factory equipment and the stack scan |
| `hooks/usage.ts`, `intro.ts` | The usage header, the cache countdown and the pixel-art intro |
| `commands/` | The `/van-code:<name>` commands (each answered by a hook in `register.tsx`) |
| `bench/` | Cost and correctness benchmark against plain Claude Code |

## License

MIT. `skills/i-have-adhd` is copied unchanged from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) at `1ecea19`, MIT, © 2026 Ayoub Ghriss. Its `LICENSE` sits beside it.
