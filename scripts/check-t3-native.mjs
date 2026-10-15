#!/usr/bin/env node
// Gate for the T3-native contract (T3-NATIVE.md). Run from anywhere:
//   node scripts/check-t3-native.mjs            all skills
//   node scripts/check-t3-native.mjs how why    only these skill dirs
// Exits 1 when any skill has a finding.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");

// Cursor mechanisms that must not survive in shipped skill text. Each row is
// one line of the T3-NATIVE.md translation table.
const RULES = [
  { id: "cursor-name", re: /(?<!`)\bcursor\b(?!`|\/plugins)/i, hint: "name the T3 mechanism instead of Cursor (the `cursor` pagination parameter in backticks is fine)" },
  { id: "cursor-path", re: /~?\/?\.cursor\//, hint: "no .cursor paths; see T3-NATIVE.md" },
  { id: "task-tool", re: /\bsubagent_type\b|`Task`|\bTask (call|tool)s?\b|\bTask\(|run_in_background|is_background|generalPurpose/, hint: "a subagent is a delegate_task child" },
  { id: "readonly-flag", re: /readonly:\s*true|readonly strips/, hint: "say read-only in the child's brief" },
  { id: "ask-question", re: /\bAskQuestion\b/, hint: "ask plainly in the thread" },
  { id: "model-slug", re: /\bgrok-\d|\bclaude-(opus|sonnet|haiku|fable)-\d|\bgpt-\d|\bcomposer-\d/i, hint: "name the role, not a model slug" },
  { id: "team-kit", re: /cursor-team-kit|\bcontrol-(ui|cli)\b|\bcreate-skill\b/, hint: "project verification skill, preview_*/device_*, skill-creator" },
  { id: "transcripts", re: /agent-transcripts/, hint: "use t3_thread_search / t3_thread_read" },
  { id: "origin-forge", re: /\bOrigin\b|`origin pr|origin pr (create|view|merge|edit|ready|checks|thread)|command -v origin/, hint: "gh is the only forge" },
  { id: "pr-tool", re: /\bPR tool\b|\bdraft: false\b/, hint: "gh pr create, then link_pull_request" },
  { id: "loop-cmd", re: /(^|[\s`(])\/loop\b/, hint: "watch_pull_request or schedule_task" },
  { id: "cloud-agent", re: /cloud[- ](agent|VM|root|sleeper|work)|environment: "cloud"|cloud_base_branch|background agent/i, hint: "a delegate_task child or a t3_thread_launch worktree thread" },
  { id: "cursor-rules", re: /\.mdc\b|alwaysApply|always-applied rule/, hint: "~/.config/pstack/pstack-models.md, AGENTS.md or CLAUDE.md" },
  { id: "cursor-ui", re: /\bcomposer\b|\bagent mode\b|option\+enter/i, hint: "name the T3 surface (thread, delegated child, launched thread)" },
  { id: "persona-dir", re: /(^|[^a-z])agents\/(poteto-agent|comment-sicko)/, hint: "briefs live in the owning skill's references/" },
  { id: "trunk-read", re: /origin\/main:pstack\//, hint: "read the installed copy from the skills dir" },
  { id: "graphite", re: /(^|[\s`("])gt (log|submit|sync|restack|info|create|modify|get|checkout)\b|\bGraphite\b|execFileSync\(\s*"gt"/, hint: "no gt; stack order comes from list_thread_pull_requests" },
  { id: "models-path", re: /pstack-models/, unless: /~\/\.config\/pstack\/pstack-models\.md/, hint: "name the models file as ~/.config/pstack/pstack-models.md" },
  { id: "brief-invoke", re: /\bbriefs?\b[^.]{0,60}\b(start|open|begin)s?\b[^.]{0,30}(`\/[a-z]|`\$[a-z])/i, hint: "a brief gives the absolute SKILL.md path, never /<name> or $<name>" },
];

const TEXT = new Set([".md", ".sh", ".mjs", ".ts", ".json", ".txt", ".yaml", ""]);
// Code may say "cursor" (GraphQL pagination, the Bugbot author), and set a
// `draft: false` property. Those are code, not instructions.
const CODE_EXEMPT = new Set(["cursor-name", "origin-forge", "task-tool", "pr-tool", "brief-invoke"]);

// A bold name is a skill reference when it carries a principle- prefix or the
// text calls it a skill ("the **how** skill", "**a** and **b** principle skills").
const BOLD_NAME = /\*\*([a-z][a-z0-9-]*)\*\*/g;
const CALLED_A_SKILL = /^\*\*[a-z][a-z0-9-]*\*\*((,|,? and|,? or) \*\*[a-z][a-z0-9-]*\*\*)* (principle )?skills?\b/;
// Skills outside this repo that pstack text may name.
const EXTERNAL_SKILLS = new Set(["skill-creator"]);

const resolvesToSkill = (name) =>
  EXTERNAL_SKILLS.has(name) || [name, `principle-${name}`].some((dir) => existsSync(join(SKILLS, dir, "SKILL.md")));

function skillNameFindings(line) {
  const findings = [];
  for (const m of line.matchAll(BOLD_NAME)) {
    const name = m[1];
    const isReference = /^principle-/.test(name) || CALLED_A_SKILL.test(line.slice(m.index));
    if (isReference && !resolvesToSkill(name)) findings.push(`[skill-name] **${name}** has no skills/${name}/ or skills/principle-${name}/`);
  }
  return findings;
}

// A line about where skills live names both harness folders.
function locationFindings(line) {
  const agents = /\.agents\/skills/.test(line);
  const claude = /\.claude\/skills/.test(line);
  return agents !== claude ? ["[skill-location] name both .agents/skills and .claude/skills (T3-NATIVE.md Skill locations)"] : [];
}

// A standalone skill that names another skill, or delegates, carries the
// standard paragraph (T3-NATIVE.md "Skills, paths and briefs"). Principles and
// poteto-mode (which owns the full Skill files and Subagents sections) are exempt.
const STANDARD_FILES = ["is the file `../<name>/SKILL.md` beside this skill's directory", "Read the file and follow it."];
const STANDARD_DELEGATION = "Subagents section of `../poteto-mode/SKILL.md`";
const NO_DELEGATION = new Set(["setup-pstack", "poteto-help"]);

function namesAnotherSkill(name, line) {
  for (const m of line.matchAll(BOLD_NAME)) {
    if (m[1] === name) continue;
    if (/^principle-/.test(m[1]) || CALLED_A_SKILL.test(line.slice(m.index))) return true;
  }
  // `/<name>` runs and bare `<name>` mentions of a sibling skill in backticks.
  for (const m of line.matchAll(/`\/?([a-z][a-z0-9-]*)`|`\/([a-z][a-z0-9-]*)/g)) {
    const ref = m[1] ?? m[2];
    if (ref !== name && existsSync(join(SKILLS, ref, "SKILL.md"))) return true;
  }
  return false;
}

function standardFindings(name, markdown, skillText) {
  if (name === "poteto-mode" || name.startsWith("principle-")) return [];
  const findings = [];
  const lines = markdown.join("\n").split("\n");
  if (lines.some((line) => namesAnotherSkill(name, line)) && !STANDARD_FILES.every((t) => skillText.includes(t))) {
    findings.push(`${name}/SKILL.md [skill-files] add the standard skill-files sentence (T3-NATIVE.md Skills, paths and briefs)`);
  }
  if (!NO_DELEGATION.has(name) && markdown.some((t) => t.includes("delegate_task")) && !skillText.includes(STANDARD_DELEGATION)) {
    findings.push(`${name}/SKILL.md [delegation-defaults] add "Every \`delegate_task\` call follows the defaults in the Subagents section of \`../poteto-mode/SKILL.md\`."`);
  }
  return findings;
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    // LICENSE.txt is the root license copied verbatim. Its notices name Cursor.
    if (entry === "node_modules" || entry === "bun.lock" || entry === "LICENSE.txt") return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function frontmatter(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return null;
  const fields = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

function frontmatterFindings(name, text) {
  const fm = frontmatter(text);
  if (!fm) return [`${name}/SKILL.md [frontmatter] missing YAML frontmatter`];
  const findings = [];
  if (fm.name !== name) findings.push(`${name}/SKILL.md [name] frontmatter name "${fm.name}" must equal the directory name`);
  for (const key of ["mode", "icon", "color", "reminder"]) {
    if (key in fm) findings.push(`${name}/SKILL.md [cursor-field] drop the Cursor UI field "${key}"`);
  }
  const userOnly = fm["disable-model-invocation"] === "true";
  const hasPaths = "paths" in fm && fm.paths !== "" && fm.paths !== "[]";
  const policy = join(SKILLS, name, "agents", "openai.yaml");
  const hiddenFromCodex = existsSync(policy) && /allow_implicit_invocation:\s*false\b/.test(readFileSync(policy, "utf8"));
  if (userOnly !== hiddenFromCodex) {
    findings.push(`${name}/agents/openai.yaml [codex-policy] set policy.allow_implicit_invocation: false exactly when SKILL.md sets disable-model-invocation: true`);
  }
  if (userOnly && hasPaths) {
    findings.push(`${name}/SKILL.md [paths-user-only] a paths skill drops disable-model-invocation so the model can load it (T3-NATIVE.md)`);
  }
  return findings;
}

function relativeTargets(text) {
  const targets = [];
  for (const m of text.matchAll(/\]\(([^)\s#]+)(#[^)]*)?\)/g)) targets.push(m[1]);
  for (const m of text.matchAll(/`((?:\.\.\/|\.\/)[^`\s]+)`/g)) targets.push(m[1]);
  return targets.filter((t) => /[./]/.test(t) && !/^[a-z]+:/i.test(t) && !t.includes("<") && !t.startsWith("/"));
}

function checkSkill(name) {
  const dir = join(SKILLS, name);
  const skillMd = join(dir, "SKILL.md");
  if (!existsSync(skillMd)) return [`${name}: missing SKILL.md`];
  const skillText = readFileSync(skillMd, "utf8");
  const findings = frontmatterFindings(name, skillText);
  const markdown = [];

  for (const file of walk(dir)) {
    if (!TEXT.has(extname(file))) continue;
    const rel = relative(SKILLS, file);
    const isMarkdown = extname(file) === ".md";
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (!isMarkdown && CODE_EXEMPT.has(rule.id)) continue;
        if (rule.re.test(line) && !rule.unless?.test(line)) findings.push(`${rel}:${i + 1} [${rule.id}] ${rule.hint}: ${line.trim().slice(0, 140)}`);
      }
      if (!isMarkdown) return;
      for (const finding of [...skillNameFindings(line), ...locationFindings(line)]) findings.push(`${rel}:${i + 1} ${finding}`);
    });
    if (!isMarkdown) continue;
    markdown.push(lines.join("\n"));
    for (const target of relativeTargets(lines.join("\n"))) {
      const abs = resolve(dirname(file), target.replace(/[.,;:]+$/, ""));
      if (!abs.startsWith(SKILLS + "/")) findings.push(`${rel} [link-escape] ${target} points outside skills/ (not installed)`);
      else if (!existsSync(abs)) findings.push(`${rel} [link-missing] ${target} does not exist`);
    }
  }
  findings.push(...standardFindings(name, markdown, skillText));
  return findings;
}

const allDirs = readdirSync(SKILLS).filter((d) => !d.startsWith(".") && statSync(join(SKILLS, d)).isDirectory()).sort();
const selected = process.argv.slice(2);
const targets = selected.length ? selected : allDirs;
const findings = targets.flatMap(checkSkill);

for (const f of findings) console.log(f);
const dirty = new Set(findings.map((f) => f.split(/[/:\s]/)[0]));
console.log(`\n${targets.length - [...dirty].filter((d) => targets.includes(d)).length}/${targets.length} skills clean, ${findings.length} findings`);
process.exit(findings.length ? 1 : 0);
