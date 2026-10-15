# T3-native contract

pstack upstream (`cursor/plugins`, path `pstack/`) is written for Cursor. This repo ships the same skills adapted to T3 Code, for Claude Code and Codex threads alike. This file is the translation contract. Every skill follows it, and every upstream sync applies it to the incoming change. When upstream text and this contract disagree, this contract wins.

Keep upstream wording wherever it is harness-neutral. Change only what names a Cursor mechanism, and replace it with the T3 mechanism below, not with vague "whatever the harness offers" prose. `node scripts/check-t3-native.mjs` enforces the mechanical part.

## What reaches an agent

`npx skills add mariusflorescu/pstack-t3 -g -a claude-code -a codex --skill '*' -y` copies each `skills/<name>/` directory into `~/.agents/skills/<name>/` (Codex reads it there) and symlinks `~/.claude/skills/<name>` to it (Claude Code reads it there). Nothing else in this repo reaches an agent: not this file, not `README.md`, not `scripts/`. A skill links only inside its own directory or to a sibling skill (`../<other-skill>/...`). Anything a skill needs at runtime lives under its own `references/`, `playbooks/` or `scripts/`.

## Harness facts

Probed in T3 Code on 2026-10-10. Re-probe before changing a rule that rests on one.

| Fact | Claude Code | Codex |
|---|---|---|
| User skills | `~/.claude/skills/` | `~/.agents/skills/` |
| Project skills | `<cwd>/.claude/skills/` | `.agents/skills/` in every directory from the project root to the cwd |
| Reads the other's folder | No | No |
| Follows a symlinked skill directory | Yes | Yes (user and repo scope) |
| Where a loaded skill's location shows | `Base directory for this skill: <dir>` at the top of the loaded skill | `<path><dir>/SKILL.md</path>` with the injected skill, and `(file: ...)` in the skills list |
| `disable-model-invocation: true` | Hidden from the model. The model cannot load it with its skill tool, and `/<name>` at the start of a `delegate_task` brief does not load it either | Ignored. Codex reads `agents/openai.yaml` instead |
| `agents/openai.yaml` `policy.allow_implicit_invocation: false` | Ignored | Hidden from the skills list. `$<name>` still loads it, path included |
| How the user runs a skill | `/<name>` | `$<name>` |
| The same skill name installed globally and in the project | Not probed | `$<name>` loads neither copy (probed 2026-10-10), so install globally or per project, never both |
| New project skills | Seen by a new session | Cached per workspace at the first scan in a running Codex: skills added later show up in a fresh workspace or after a restart |
| `paths:` frontmatter | The skill stays out of the skill list ("Unknown skill") until the agent works on a matching file | Ignored |

A `delegate_task` child runs in the parent thread's workspace and sees the same files. It gets only its brief, never the parent's conversation.

Tool scope, from the T3 tool contracts:

- `task_status` and `task_cancel` reach only tasks the calling thread created. Another thread's delegated work is found with `t3_thread_list` (`includeSubagents: true`) and read with `t3_thread_read`.
- A `delegate_task` child cannot call `watch_pull_request`: its parent thread owns the PR. A `t3_thread_launch` thread is top-level and can watch. `watch_pull_request` and `unwatch_pull_request` take an optional `threadId`, so a root can arm or clear a watch for an owner thread.
- A watch wakes the thread when a check fails, the required checks pass, someone else comments or reviews, or the branch starts to conflict. It ends when the PR merges or closes (a merge ends the watch without a wake), when its thread settles or is archived, or on `unwatch_pull_request`. A wake is news, not a merge decision.
- `link_pull_request` links to the calling thread.
- Schedules persist until deleted. `update_scheduled_task` with `enabled: false` pauses one.

## Skills, paths and briefs

- **A skill named in bold or in backticks, or run as `/<name>`, in agent-facing text** (`the **how** skill`, `**unslop**`, "Use `why` step 2", "Run `/deslop`") is the file `../<name>/SKILL.md`, resolved from the naming skill's base directory. A principle named without its prefix (`the **prove-it-works** principle skill`) is `../principle-<name>/SKILL.md`. Keep upstream's short form in the text. Read the file. Do not expect the harness's skill tool to load it: almost every pstack skill is user-only.
- **Standalone skills.** Any skill can run without poteto-mode, so a skill that names another skill carries this sentence right after its title: "A skill named in bold or in backticks, or run as `/<name>`, is the file `../<name>/SKILL.md` beside this skill's directory, and a principle named without its prefix is `../principle-<name>/SKILL.md`. Read the file and follow it. Most pstack skills are user-only, so your skill tool cannot load them." A skill that delegates adds "Every `delegate_task` call follows the defaults in the Subagents section of `../poteto-mode/SKILL.md`." The checker enforces both. Principles and poteto-mode are exempt.
- **Base directory.** Take it from the harness (see Harness facts). If the harness gave none, the global install puts skills in `~/.claude/skills/<name>/` on Claude Code and `~/.agents/skills/<name>/` on Codex.
- **Scripts** run from the skill's base directory (`<poteto-mode dir>/scripts/watch-pr/watch-pr`). Upstream's repo-relative `pstack/skills/...` paths become base-directory paths.
- **A brief that needs a child to follow a pstack skill** gives the absolute path of that `SKILL.md` and says to read it in full before any work. Never start a brief with `/<name>` or `$<name>`: the Claude Code probe showed it does not load a user-only skill. Give script paths as absolute paths too, since a child that never loaded the skill has no base directory.
- **Skill text that tells the user to run a skill** keeps upstream's `/<name>`. The README says once that Codex threads type `$<name>`.
- **User-only skills.** Keep `disable-model-invocation: true` in `SKILL.md` exactly where upstream has it. Each such skill also ships `agents/openai.yaml` with `policy.allow_implicit_invocation: false`, so Codex hides it the same way. The checker fails when the two disagree.
- **`paths:` skills.** Keep `paths:` as upstream wrote it, but a `paths` skill drops `disable-model-invocation`, so the model can load it when it touches a matching file (`typescript-best-practices`).
- **Frontmatter.** `name` equals the directory name. Drop Cursor UI fields (`mode`, `icon`, `color`, `reminder`).

## Skill locations

A skill that creates or finds skills covers both harnesses, because a T3 project can run Claude Code and Codex threads side by side.

- **Create** the real directory at `.agents/skills/<name>/`, then the relative symlink `.claude/skills/<name> -> ../../.agents/skills/<name>`. Commit both.
- **Find** in `.agents/skills/`, `.claude/skills/`, `~/.agents/skills/` and `~/.claude/skills/`. Entries that resolve to the same real path are one skill.
- Any line that names `.agents/skills` also names `.claude/skills`, and the reverse.

## Delegation

A subagent is a `delegate_task` child. These defaults replace upstream's `Task` defaults.

- **Spawn.** `delegate_task` with `mode: "async"`, a `title` that names the role and the slice, a `clientRequestId` that is stable across retries of one round and distinct per round, and `target` set from the role (see Model roles). Keep `runtimeMode` inherited. A read-only child gets "read-only: inspect only, no writes, no git commands" in its brief, not a weaker mode, so its MCP tools stay available.
- **Briefs stand alone.** The child gets only the brief: the goal, absolute file pointers rather than inlined context, constraints, the report format, and whether it may delegate further ("Do not delegate" otherwise).
- **Wait.** An async child's completion wakes the parent with a notification. End the turn instead of polling. Use `task_status <taskId>` only when the result is needed mid-turn, and `task_cancel` to stop a child.
- **Fresh by default.** A fix round, follow-up, retry or next queue item is a new `delegate_task` with consolidated scope: the original brief, every later directive, the prior report and branch. A `delegate_task` child is never resumed. Work that must keep state (a local checkout, uncommitted changes, a dev server, a simulator) runs in a `t3_thread_launch` thread instead. Follow up with `t3_thread_send`, wait with `t3_thread_wait`, read with `t3_thread_read`.
- **Worktrees.** `delegate_task` children share the parent's checkout, so parallel writers there own disjoint files and run no git commands. A writer that needs its own tree is a `t3_thread_launch` thread with `workspaceStrategy: {"type":"worktree","baseRef":"<commit or branch>","branch":"<new branch>","startFromOrigin":false}`, the brief in `message`, and the role's model as `modelSelection: {"instanceId": "<providerInstanceId>", "model": "<model>", "options": {...}}` (note `instanceId`, not `providerInstanceId`). Commit first: uncommitted edits are not copied into a new worktree. One writer per worktree or branch.

## Model roles

`/setup-pstack` writes `~/.config/pstack/pstack-models.md`. Skills name that exact path whenever they mention the file. Nothing loads it up front. A skill reads it when it delegates.

```
# budget: large (xhigh)
feature, refactoring: <providerInstanceId>/<model> (<effort>)
interrogate reviewers: <entry>, <entry>, <entry>
```

- An entry is `<providerInstanceId>/<model>` with an optional `(<effort>)`, validated against `orchestrator_capabilities`. A model with no effort option takes no `(<effort>)`. `inherit-parent` (or `auto`) runs the role on the parent thread's model: omit `target`.
- Pass an entry as `target: {"providerInstanceId": ..., "model": ..., "options": {"<effort option id>": "<effort>"}}`. The effort option id is the one `orchestrator_capabilities` lists for that model (`effort` on Claude, `reasoningEffort` on Codex).
- The effort ladder is `max` > `xhigh` > `high` > `medium` > `low`. Options outside it (`ultra`, `ultracode`, `ultrathink`) are never chosen by a budget.
- A role with no line keeps the skill's default. With no file at all, single roles run `inherit-parent`, and a panel role takes the parent model plus the strongest model of each other provider that `orchestrator_capabilities` reports with `canRunChildTask`, up to three entries. Say so in the reply and suggest `/setup-pstack`.
- Role names stay exactly as upstream: `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `judgment and prose`, `hardest tasks`, `how explorer`, `how explainer`, `why investigators`, `why synthesizer`, `reflect tooling`, `reflect judgment, divergent, synthesizer`, `arena runners`, `arena cross-judge pool`, `swarm workers`, `architect runners`, `interrogate reviewers`.

## Translation table

| Cursor / upstream | T3 |
|---|---|
| `Task` tool, "spawn a subagent", `subagent_type`, `run_in_background: true` | `delegate_task` per Delegation. |
| `subagent_type: "poteto-agent"`, `agents/poteto-agent.md` | The brief opens with the text of `poteto-mode/references/poteto-agent.md`, its `<poteto-mode SKILL.md>` placeholder replaced by the absolute path. Routed skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) keep the briefs they prescribe. |
| `agents/comment-sicko.md` | `no-comments/references/comment-sicko.md`, pasted verbatim at the top of the child's brief. |
| `readonly: true`, "readonly strips MCP" | "read-only" in the brief. Mode stays inherited. |
| Model slugs (`grok-*`, `claude-*-xhigh`, `gpt-*`), "default model X" | The role name ("your `bug-fix` model"), resolved per Model roles. |
| `/setup-pstack` rule, `~/.cursor/rules/pstack-models.mdc`, `alwaysApply` | `~/.config/pstack/pstack-models.md`, read on demand. |
| Resume, message or queue a follow-up on a subagent | A fresh `delegate_task` round. `t3_thread_send` only to a `t3_thread_launch` thread that holds needed state. |
| Cloud agent, `environment: "cloud"`, cloud VM, background agent | A `delegate_task` child, or a `t3_thread_launch` thread with a worktree `workspaceStrategy` when it needs its own tree or branch. Everything runs on this machine. |
| "each worker gets its own worktree" | `t3_thread_launch` with `workspaceStrategy` (`worktree`, `existing_worktree` with `worktreePath`, or `root`). |
| `/loop`, polling loops, wake-ups | `watch_pull_request` for PR events (checks finish, comments, conflicts), `schedule_task` for a time cadence (`{"type":"interval","everyMs":...}` or `{"type":"fixed_time","timeOfDay":"09:00","weekdays":[1,2,3,4,5]}`), `run_scheduled_task_now` for an immediate tick. Child completions arrive as notifications. Arm it and end the turn. |
| `scripts/watch-pr/watch-pr` as a blocking poller | `watch_pull_request` does the waiting. On each wake, `watch-pr` runs once and gives the verdict. |
| `gt` (Graphite) stack bookkeeping | `list_thread_pull_requests` (any `threadId`) for stack order and branches. `orch frontier set --chain <file>` adds head SHAs, the generation and the pin check. `gh` is the forge. |
| A run's built-in PR tool, `draft: false` | `gh pr create` (ready unless the playbook says draft), then `link_pull_request` with the URL at once, for every layer. `link_pull_request` links to the calling thread, so a child that opens a PR links it and reports the URL, and the parent links it too. `unwatch_pull_request` before handing a PR back to the user. |
| Origin forge (`origin pr ...`, `command -v origin`) | `gh` only. |
| `agent-transcripts/*.jsonl`, `~/.cursor/projects/...` | `t3_thread_search` to find threads (a bounded hint, not an index), `t3_thread_list` (with `includeSubagents`, paged by `cursor`) to enumerate, `t3_thread_read` for a timeline: `view: "activity"` includes tool calls, follow `nextPosition` until `hasMore` is false, and recover a truncated item with `itemId` plus `textOffset`. `t3_thread_list` has no worktree field; `t3_thread_read` returns `thread.worktreePath`. |
| Cursor restart, "local agents are dead" | Threads, delegated tasks, schedules and PR watches persist across T3 restarts. Reattach with `t3_thread_list`, `task_status` and `list_thread_pull_requests`. |
| `AskQuestion` | Ask plainly in the thread. Questions pending in other threads: `t3_pending_request_list`, `t3_pending_request_read`, `t3_pending_request_respond`. |
| Cursor's todo list ("open a todolist") | The harness's task list (Claude Code's task tools, Codex's plan tool). Without one, a checklist file at `~/.local/state/pstack/checklists/<repo>-<branch>.md`. |
| `control-ui`, `control-cli` (`cursor-team-kit`) | The project's own verification skill if it has one (see `create-verification-skill`). Otherwise `preview_*` for web UIs (`preview_recording_start` / `preview_recording_stop` for video), `device_*` for iOS and Android simulators, and the shell for CLIs and TUIs. |
| `deslop` from `cursor-team-kit` | The bundled `deslop` skill (`skills/deslop/`). |
| `create-skill` (Cursor built-in) | The `skill-creator` skill when installed, otherwise the Authoring-a-skill playbook. |
| Cursor's built-in `babysit` skill | Drop the reference. The Babysit playbook stands alone. |
| Cursor hooks, `.cursor/` rules, Cursor settings | `AGENTS.md` / `CLAUDE.md` (project or user), project skills per Skill locations, `~/.config/pstack/pstack-models.md`. |
| Cursor custom modes ("press option+enter", mode toggles), `mode: true`, `reminder:` | Skills run by name (`/poteto-mode`, `$poteto-mode` on Codex). No toggles. |
| `git show origin/main:pstack/skills/<path>` (re-read a skill from trunk) | Read `<skills dir>/<path>` from the installed copy (`<poteto-mode dir>/../<path>`). `npx skills update -g` refreshes it. |
| Secrets typed into chat | `request_secret`, then pass the `secretRef` to the tool that needs it. |
| A webhook-triggered automation, a Cursor routine, a secret-request card | `schedule_task` with `{"type":"webhook"}`; the run sees the request only through `{{body.path}}` placeholders in the task prompt. Report its `webhookUrl` (T3 Connect remote access when it is missing). A signing secret comes from `request_secret` and goes to `signature.secretRef`. |
| Screenshots or video for the human | `preview_*` and `device_*` captures. `html_preview` then `html_render` to show a built page in the thread. |
| Bugbot | Keep the name. It is a GitHub review bot, and the same triage applies to any review bot on the PR. |
| "Never require Graphite (`gt`)" | "Never require `gt`." |
| Transcript scope (`~/.cursor/projects/<workspace>/`) | `t3_thread_list` and `t3_thread_search` default to the calling thread's project. Pass another `projectId` only when the user asks: other projects hold unrelated private chats. |

## Scripts

- `watch-pr`: the one-shot GitHub merge verdict. No poll loop. `watch_pull_request` waits. A run reads GitHub once and prints the verdict last; `WAITING` (nothing to do until the next wake) exits 5.
- `orch`: coordinator bookkeeping. The store lives at `~/.local/state/pstack/orchestrate/<project-slug>/` (`ORCH_STORE`), outside any worktree, so threads in different worktrees share it. `inbox push` records a `delegate_task` completion by taskId. `frontier set --chain` reads a `list_thread_pull_requests` dump. No `gt`.
- `worktree-audit.sh`: `--activity <tsv>` supplies the last T3 activity per worktree, built from `t3_thread_list` plus `t3_thread_read` (`worktreePath`, latest run). T3 worktrees live in `~/.t3/worktrees/<project>/`.
- `check-plan.mjs`: its required markers follow the ported `multi-phase-plan.md`.
- `bootstrap.ts`, `package.json`, `bun.lock`: unchanged. Bun installs `commander` beside the scripts on first run.

`bun test` and `bun run typecheck` in `skills/poteto-mode/scripts` stay green.

## Writing rules

- Thin over complete. Keep the shortest text that still changes behavior.
- pstack's voice: terse, declarative, no filler. No long-dash character in text you write. Verbatim upstream sentences keep theirs.
- Use T3 tool names exactly as T3 exposes them.
- Never mention a Cursor tool, even as a fallback.

## Definition of done

`node scripts/check-t3-native.mjs` exits 0 (pass skill names to check a subset). It fails on Cursor mechanisms in skill text, a bold skill name that resolves to no directory, a broken or escaping relative link, a frontmatter `name` that differs from its directory, a `disable-model-invocation` skill without the matching `agents/openai.yaml` (or the reverse), a `paths` skill that is also user-only, a models-file mention without its full path, and a skill-location line that names only one harness's folder.
