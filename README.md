# pstack for T3 Code

pstack is an engineering skill library for coding agents. Lauren Tan ([poteto](https://x.com/poteto)) wrote it for Cursor: one mode skill that routes every task to a playbook, principles that ground each decision, and verification strict enough to parallelize with confidence. This repo ships it to [T3 Code](https://github.com/pingdotgg/t3code) as 52 skills that work in Claude Code and Codex threads alike, with every delegation running as a T3 child on the model you picked for that role.

## Install

```bash
npx skills add mariusflorescu/pstack-t3 -g -a claude-code -a codex --skill '*' -y
```

The skills name each other, so install them all. This puts one copy of each skill in `~/.agents/skills/` (Codex reads it there) and a symlink in `~/.claude/skills/` (Claude Code reads it there). Update with `npx skills update -g`. Drop `-g` to install into a single project instead, but install one way or the other, not both: when a skill name exists in both `~/.agents/skills` and a project's `.agents/skills`, Codex resolves neither on `$<name>`.

You also need `gh` (the only forge pstack uses) and [Bun](https://bun.sh) for the `orch` and `watch-pr` scripts.

## Get started

1. Run `/setup-pstack`. It reads the providers and models T3 offers (`orchestrator_capabilities`), asks for a reasoning budget, and writes `~/.config/pstack/pstack-models.md`: one `role: provider/model (effort)` line per pstack role.
2. Use `/poteto-mode` for anything that needs rigor. It picks one of 23 playbooks and runs the other skills as the steps need them.
3. Stuck, or unsure which skill fits? Ask `/poteto-help`.

Codex threads run every skill as `$<name>` where this README and the skills write `/<name>`.

## How it works on T3

- **Delegation.** A subagent is a `delegate_task` child with the provider, model and effort of its role. Panel roles spawn one child per entry, so `/interrogate` can put Claude and GPT reviewers on the same diff. Children get only their brief, and their completions wake the parent.
- **Worktrees.** A writer that needs its own tree is a `t3_thread_launch` thread with a worktree, one writer per worktree.
- **PRs.** `gh` opens them, `link_pull_request` registers every layer, and `watch_pull_request` wakes the thread when checks finish, someone comments, or the branch conflicts. `watch-pr` turns each wake into a merge verdict.
- **Cadence.** Hourly audits and other recurring work run through `schedule_task`.
- **Both harnesses.** Almost every skill is user-only: `disable-model-invocation` hides it on Claude Code and `agents/openai.yaml` hides it on Codex. Skills reach each other by reading `../<name>/SKILL.md` from their own directory, and a brief hands a child the absolute path of any skill it must follow. Skills that create skills write to `.agents/skills/` and symlink `.claude/skills/`.

[T3-NATIVE.md](./T3-NATIVE.md) is the contract that maps every Cursor mechanism upstream uses to its T3 equivalent, with the harness facts it rests on. `node scripts/check-t3-native.mjs` enforces it.

## Skills

`/poteto-mode` runs most of these for you when a step needs them. The table is for when you want one directly.

| Skill | Use it when |
|---|---|
| `/poteto-mode` | Default entry point for any non-trivial task. |
| `/poteto-help` | You're new to pstack, or unsure which skill, playbook, or principle fits. |
| `/setup-pstack` | You want to pick which models pstack uses per role. |
| `/in-your-own-words` | You want the agent to play back your goal and the problem before it starts. |
| `/sharpen` | You want a task aimed higher before work starts: more expert, more outcome-focused, not overspecified. |
| `/how` | You want a walkthrough of how a subsystem works. |
| `/why` | You want to know why something was built this way, from every evidence source your MCP tools reach. |
| `/recall` | You're starting or resuming work and want your recent context rebuilt from your own threads. |
| `/ketchup` | You want what changed in this chat since your last message, in a few plain sentences and small visuals, with just enough context on each action item to make the call. |
| `/blast-radius` | A small-looking change might break something else, and you want the safety fact proven by running code. |
| `/architect` | You're about to write code that crosses a function boundary and want its shape settled first. |
| `/arena` | You want N parallel attempts at the same thing, then the best parts of each. |
| `/swarm` | You want N parallel workers across slices or races, then one report. |
| `/interrogate` | You have a diff and want different models to try to break it. |
| `/automate-me` | You want your own `-mode` skill, drafted from how you've actually worked. |
| `/make-bot-ui` | You want a page whose buttons wake a T3 thread over a webhook. |
| `/reflect` | A long task landed and you want the recipe captured as a skill edit. |
| `/correct` | You keep correcting agents for the same mistakes and want each fixed at the highest level that works. |
| `/teach` | You want to actually understand a change or subsystem. |
| `/tdd` | You're fixing a bug and there's a cheap local test path. |
| `/benchmark-checklist` | You measured a speedup or regression and need to vet the number. |
| `/no-comments` | Strip comments before review. Spawns Comment Sicko. |
| `/deslop` | Remove AI code slop from the branch before you commit. |
| `/typescript-best-practices` | You're reading or editing TypeScript. Loads on its own for `.ts` and `.tsx` files. |
| `/figure-it-out` | No bundled playbook fits. Designs a rigorous playbook for the task. |
| `/show-me-your-work` | You want a reviewable decision trail. |
| `/create-verification-skill` | Your project has no scripted way to prove app behavior. |
| `/maintain-verification-skill` | Your verify skill's feature map has drifted from the app. |
| `/unslop` | You're cleaning up writing. |
| `/bro` | You want the last message restated in plain language. |
| `/technical-writing` | Docs, RFCs, readmes, PR descriptions, commit messages. |

The 24 `principle-*` skills are indexed inside `poteto-mode` and read by the other skills by name.

## Differences from upstream

- Every Cursor mechanism is swapped for its T3 equivalent per [T3-NATIVE.md](./T3-NATIVE.md). Everything else keeps upstream's wording.
- The model config is a plain file at `~/.config/pstack/pstack-models.md` instead of a Cursor rule.
- `watch-pr` gives a one-shot verdict. T3's PR watch does the waiting.
- `orch` reads stack order from T3 instead of Graphite.
- `deslop` is bundled from `cursor-team-kit`. The `poteto-agent` and Comment Sicko briefs live in the skills that use them.
- Not ported: the benny Slack automations, the Cursor guide in `docs/`, and the Cursor plugin manifest.

## Staying current with upstream

`UPSTREAM` pins the upstream commit this port matches. To sync, diff `pstack/` in [cursor/plugins](https://github.com/cursor/plugins) from that commit to the new one, apply each hunk through T3-NATIVE.md, run `node scripts/check-t3-native.mjs` and the script tests (`bun test` in `skills/poteto-mode/scripts`), then bump the pin. [AGENTS.md](./AGENTS.md) holds the rules for agents doing this.

## Credit

Adapted from [cursor/plugins pstack](https://github.com/cursor/plugins/tree/main/pstack) by [Lauren Tan](https://x.com/poteto). `skills/deslop` comes from cursor/plugins `cursor-team-kit`. This port is not affiliated with Cursor or with the pstack author.

## License

MIT. [LICENSE](./LICENSE) keeps the upstream copyright notices. Each skill folder carries a copy as `LICENSE.txt`.
