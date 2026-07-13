// Thin config: workspace path + friendly target aliases. This is convenience only
// (favorites for the UI), NOT install state — install state is always derived from
// symlinks on disk. Missing config is fine; sensible defaults apply.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Config, RawConfig, Target } from "./types.ts";
import { resolveReal } from "./util.ts";

function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "skillbox", "config.json");
}

// Default workspace = the folder this tool lives in one level up (…/claude-skills),
// overridable by env or config.
function defaultWorkspace(): string {
  if (process.env.SKILLBOX_WORKSPACE) return resolve(process.env.SKILLBOX_WORKSPACE);
  // src/core/config.ts -> skillbox/ -> claude-skills/
  return resolve(import.meta.dirname, "..", "..", "..");
}

// Read a `.skillboxignore` at the workspace root: one repo dir name per line, `#` comments.
async function readIgnoreFile(workspace: string): Promise<string[]> {
  try {
    const text = await readFile(join(workspace, ".skillboxignore"), "utf8");
    return text
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Read config.json verbatim (the persisted schema). No canonicalization, no merge — so
// what we later write back matches what the user typed.
async function loadRawConfig(): Promise<RawConfig> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    return {};
  }
}

export async function loadConfig(): Promise<Config> {
  // Canonicalize the workspace once (resolves /tmp->/private/tmp, worktree links) so
  // it matches the form scan walks and link containment checks compare against.
  const raw = await loadRawConfig();
  const workspace = await resolveReal(raw.workspace ? resolve(raw.workspace) : defaultWorkspace());
  const fileIgnore = await readIgnoreFile(workspace);
  const ignore = [...new Set([...(raw.ignore ?? []), ...fileIgnore])];
  return { workspace, targets: raw.targets ?? {}, ignore };
}

// Persist only the RAW schema — never the canonicalized workspace or file-merged ignore.
async function saveRawConfig(raw: RawConfig): Promise<void> {
  const p = configPath();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(raw, null, 2) + "\n");
}

// Register a target alias. Reads raw, mutates ONLY `targets`, writes raw back — so the
// user's typed `workspace` and their `.skillboxignore`-merged `ignore` are untouched.
export async function addTarget(alias: string, path: string): Promise<void> {
  if (alias === "user" || alias === "--user") {
    throw new Error(`"${alias}" is reserved for the user scope (~/.claude); pick another alias`);
  }
  const raw = await loadRawConfig();
  raw.targets = { ...(raw.targets ?? {}), [alias]: path };
  await saveRawConfig(raw);
}

export async function removeTarget(alias: string): Promise<boolean> {
  const raw = await loadRawConfig();
  if (!raw.targets || !(alias in raw.targets)) return false;
  const { [alias]: _drop, ...rest } = raw.targets;
  raw.targets = rest;
  await saveRawConfig(raw);
  return true;
}

// Registered target aliases as resolved Targets (default agent). Does NOT include the
// user scope (reach that via `--user`). The TUI consumes this, so TUI target-switching is
// claude-scope only today; per-agent targeting is CLI-only (--codex/--gajae).
export function listTargets(cfg: Config): Target[] {
  return Object.keys(cfg.targets)
    .sort()
    .map((alias) => resolveTarget(alias, cfg));
}

// Agent profiles: where each agent discovers skills. Only these paths differ per agent —
// scan/link/matrix are agent-agnostic. Add an agent by adding a row here.
//   projectSub  = skills dir relative to a project root
//   userSkills  = absolute user-scope skills dir
export interface AgentProfile {
  name: string;
  projectSub: string; // e.g. ".claude/skills"
  userSkills: string; // e.g. ~/.claude/skills
}

export const AGENTS: Record<string, AgentProfile> = {
  claude: { name: "claude", projectSub: join(".claude", "skills"), userSkills: join(homedir(), ".claude", "skills") },
  // Codex: user ~/.agents/skills, project <root>/.agents/skills — Codex walks cwd→repo
  // root scanning .agents/skills. Confirmed from openai codex "Build skills" docs.
  codex: { name: "codex", projectSub: join(".agents", "skills"), userSkills: join(homedir(), ".agents", "skills") },
  // gajae-code (gjc): project <root>/.gjc/skills (cwd→repo-root walk-up, enablePiProject),
  // user ~/.gjc/agent/skills (enablePiUser). Confirmed from gjc discovery/builtin.ts
  // loadSkills. NOTE: gjc skill scanning is OFF by default — enable it per README before
  // these links are seen: `gjc config set skills.enabled true` + enablePiProject/enablePiUser.
  gajae: { name: "gajae", projectSub: join(".gjc", "skills"), userSkills: join(homedir(), ".gjc", "agent", "skills") },
};

export const DEFAULT_AGENT = "claude";

// Resolve a target spec into a Target for a given agent. Spec is one of:
//   "--user" / "user"   -> the agent's user-scope skills dir
//   a config alias      -> that project root
//   a filesystem path   -> used directly as the project root
export function resolveTarget(spec: string, cfg: Config, agent: string = DEFAULT_AGENT): Target {
  // Object.hasOwn (not ??) so inherited names like "constructor"/"toString" fall back to
  // claude instead of returning a truthy prototype member with undefined paths.
  const profile = Object.hasOwn(AGENTS, agent) ? AGENTS[agent] : AGENTS[DEFAULT_AGENT];
  if (spec === "--user" || spec === "user") {
    return { alias: `${profile.name}:user`, root: homedir(), skillsDir: profile.userSkills };
  }
  const aliasRoot = cfg.targets[spec];
  if (aliasRoot) {
    const root = resolve(aliasRoot);
    return { alias: spec, root, skillsDir: join(root, profile.projectSub) };
  }
  const root = resolve(spec);
  return { root, skillsDir: join(root, profile.projectSub) };
}
