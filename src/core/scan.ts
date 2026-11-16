// Layout-agnostic skill discovery. A "skill" is any directory containing a SKILL.md.
// This one rule absorbs every layout we care about:
//   skills/<name>/SKILL.md            (slides-grab)
//   skills/<cat>/<name>/SKILL.md      (catalog style)
//   repo/repo/SKILL.md                (double-nested clone, e.g. korean-privacy-terms)

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import type { Repo, Skill } from "./types.ts";

// Never descend into these — they hold no first-class skills and would create noise
// or huge scans. `references` is excluded because a skill's own docs live there.
// `archive` holds retired skills kept for history, never installable.
const PRUNE_DIRS = new Set([
  ".git",
  "archive",
  "node_modules",
  "references",
  "templates",
  "dist",
  ".next",
  "assets",
]);

const MAX_DEPTH = 6; // safety bound against pathological trees

// Walk one repo and return the directories that directly contain a SKILL.md.
// Agent-tool dirs that some repos use as their ONLY skill location (e.g. ai-job-search keeps
// everything in `.agents/skills` and `.claude/skills`). Scanned only as a fallback.
const AGENT_DIRS = new Set([".agents", ".claude"]);

async function findSkillDirs(root: string, includeAgentDirs = false): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip
    }
    const hasSkill = entries.some((e) => e.isFile() && e.name === "SKILL.md");
    if (hasSkill) {
      found.push(dir);
      // A skill dir normally owns its whole subtree, so we stop — EXCEPT for a child
      // literally named `skills`, which by convention holds sub-skills of an umbrella
      // skill (e.g. korean-privacy-terms: root SKILL.md + skills/privacy-*). Descend
      // only there so the sub-skills aren't hidden by the umbrella.
      const skillsChild = entries.find((e) => e.isDirectory() && e.name === "skills");
      if (skillsChild) await walk(join(dir, "skills"), depth + 1);
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (PRUNE_DIRS.has(e.name)) continue;
      if (e.name.startsWith(".") && !(includeAgentDirs && AGENT_DIRS.has(e.name))) continue;
      await walk(join(dir, e.name), depth + 1);
    }
  }
  await walk(root, 0);
  return found;
}

// Pull `name:` / `description:` out of SKILL.md YAML frontmatter, best-effort. A real YAML
// parse handles folded/literal blocks (`description: >-`); frontmatter that is not valid
// YAML (an unquoted `: ` inside a value is common) falls back to single-line matching.
async function readFrontmatter(skillDir: string): Promise<{ name?: string; description?: string }> {
  let text: string;
  try {
    text = await readFile(join(skillDir, "SKILL.md"), "utf8");
  } catch {
    return {};
  }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const block = fm ? fm[1] : text.slice(0, 400);
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() || undefined : undefined);
  if (fm) {
    try {
      const data = Bun.YAML.parse(block) as Record<string, unknown> | null;
      if (data && typeof data === "object") return { name: clean(data.name), description: clean(data.description)?.slice(0, 200) };
    } catch {}
  }
  const field = (key: string) => {
    const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
  };
  return { name: field("name"), description: field("description")?.slice(0, 200) };
}

// Repos that keep one skill per tool in `<tool>/skill/SKILL.md` would otherwise all be
// named "skill" and collide, so a generic folder takes its frontmatter name instead.
const GENERIC_SKILL_DIRS = new Set(["skill"]);

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// Scan one repo dir into a Repo (git state left as "unknown"; fill via git.ts on demand).
export async function scanRepo(repoPath: string): Promise<Repo> {
  const name = basename(repoPath);
  let dirs = await findSkillDirs(repoPath);
  if (dirs.length === 0) dirs = await findSkillDirs(repoPath, true);
  const skills: Skill[] = [];
  for (const d of dirs) {
    // Skill name = the SKILL.md parent dir's basename, unless that IS the repo root
    // (double-nested root SKILL.md) — then use the repo name.
    const fm = await readFrontmatter(d);
    const base = basename(d);
    const sName = d === repoPath ? name : GENERIC_SKILL_DIRS.has(base) ? (fm.name ?? basename(dirname(d))) : base;
    // Container (umbrella) = another discovered skill lives under this one.
    const isContainer = dirs.some((o) => o !== d && o.startsWith(d + sep));
    skills.push({
      name: sName,
      src: d,
      repo: name,
      description: fm.description,
      ...(isContainer ? { isContainer: true } : {}),
    });
  }
  // Repos that ship one copy of a skill per agent tool (career-ops: cursor-directory,
  // openai-directory, ...) would report the same name N times. Keep the shortest path
  // among same-name skills whose SKILL.md is byte-identical.
  const keep = new Map<string, Skill>();
  const uniq: Skill[] = [];
  for (const sk of skills.sort((a, b) => a.src.length - b.src.length)) {
    const body = await readFile(join(sk.src, "SKILL.md"), "utf8").catch(() => "");
    const key = `${sk.name}\0${createHash("sha1").update(body).digest("hex")}`;
    if (keep.has(key)) continue;
    keep.set(key, sk);
    uniq.push(sk);
  }
  skills.length = 0;
  skills.push(...uniq);
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return {
    name,
    path: repoPath,
    isGit: await isDir(join(repoPath, ".git")),
    skills,
    git: { kind: "unknown" },
  };
}

// Scan the whole workspace. Immediate subdirectories are candidate repos; any that
// contains at least one SKILL.md is included (others are skipped as non-skill folders).
export async function scanWorkspace(
  workspace: string,
  opts: { includeEmpty?: boolean; ignore?: string[] } = {},
): Promise<Repo[]> {
  let entries;
  try {
    entries = await readdir(workspace, { withFileTypes: true });
  } catch {
    return [];
  }
  const ignore = new Set(opts.ignore ?? []);
  const repos: Repo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    if (PRUNE_DIRS.has(e.name)) continue;
    if (ignore.has(e.name)) continue; // user-excluded repo (e.g. claude-overlay)
    const repo = await scanRepo(join(workspace, e.name));
    if (repo.skills.length > 0 || opts.includeEmpty) repos.push(repo);
  }
  repos.sort((a, b) => a.name.localeCompare(b.name));
  return repos;
}

// Flatten all skills across the workspace, tagging duplicates by repo for disambiguation.
export function flattenSkills(repos: Repo[]): Skill[] {
  return repos.flatMap((r) => r.skills);
}
