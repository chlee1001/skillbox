// Layout-agnostic skill discovery. A "skill" is any directory containing a SKILL.md.
// This one rule absorbs every layout we care about:
//   skills/<name>/SKILL.md            (slides-grab)
//   skills/<cat>/<name>/SKILL.md      (catalog style)
//   repo/repo/SKILL.md                (double-nested clone, e.g. korean-privacy-terms)

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import type { Repo, Skill } from "./types.ts";

// Never descend into these — they hold no first-class skills and would create noise
// or huge scans. `references` is excluded because a skill's own docs live there.
const PRUNE_DIRS = new Set([
  ".git",
  "node_modules",
  "references",
  "templates",
  "dist",
  ".next",
  "assets",
]);

const MAX_DEPTH = 6; // safety bound against pathological trees

// Walk one repo and return the directories that directly contain a SKILL.md.
async function findSkillDirs(root: string): Promise<string[]> {
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
      if (e.name.startsWith(".")) continue;
      await walk(join(dir, e.name), depth + 1);
    }
  }
  await walk(root, 0);
  return found;
}

// Pull the `description:` line out of SKILL.md YAML frontmatter, best-effort.
async function readDescription(skillDir: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(skillDir, "SKILL.md"), "utf8");
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    const block = fm ? fm[1] : text.slice(0, 400);
    const m = block.match(/^description:\s*(.+)$/m);
    if (!m) return undefined;
    return m[1].trim().replace(/^["']|["']$/g, "").slice(0, 200);
  } catch {
    return undefined;
  }
}

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
  const dirs = await findSkillDirs(repoPath);
  const skills: Skill[] = [];
  for (const d of dirs) {
    // Skill name = the SKILL.md parent dir's basename, unless that IS the repo root
    // (double-nested root SKILL.md) — then use the repo name.
    const sName = d === repoPath ? name : basename(d);
    // Container (umbrella) = another discovered skill lives under this one.
    const isContainer = dirs.some((o) => o !== d && o.startsWith(d + sep));
    skills.push({
      name: sName,
      src: d,
      repo: name,
      description: await readDescription(d),
      ...(isContainer ? { isContainer: true } : {}),
    });
  }
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
