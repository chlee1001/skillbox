// Machine-readable shapes for `--json`. Pure: callers resolve links and git state first,
// so the shapes are testable without a workspace. Field names are a contract with
// consumers such as the Herdr skills panel; change them together.

import { relative } from "node:path";
import type { Repo, Skill } from "./types.ts";
import type { InstallResult, UninstallResult } from "./link.ts";

export interface SkillEntry {
  name: string;
  // Selector that `skillbox always|install|path` resolve to exactly this skill:
  // `repo:name`, or `repo:<dir in repo>` when the repo ships the name more than once.
  ref: string;
  path: string; // the skill dir (the symlink target)
  description?: string;
  umbrella: boolean;
  always: boolean;
}

export interface RepoEntry {
  name: string;
  path: string;
  class?: Repo["class"];
  remote?: string;
  unbacked: boolean;
  category?: string;
  skills: SkillEntry[];
}

export function skillRef(skill: Skill, repo: Repo): string {
  const twins = repo.skills.filter((s) => s.name === skill.name).length;
  if (twins === 1) return `${repo.name}:${skill.name}`;
  // selectSkills matches by path only when the selector holds a "/"; a top-level dir
  // gets a trailing one so it is not read back as the ambiguous bare name.
  const dir = relative(repo.path, skill.src);
  return `${repo.name}:${dir.includes("/") ? dir : `${dir}/`}`;
}

// `isAlways(skill)` answers whether a user-scope link points at that skill's src.
export function repoEntries(repos: Repo[], isAlways: (skill: Skill) => boolean): RepoEntry[] {
  return repos.map((repo) => ({
    name: repo.name,
    path: repo.path,
    class: repo.class,
    remote: repo.remote,
    unbacked: repo.class === "owned" && !repo.remote,
    category: repo.category,
    skills: repo.skills.map((skill) => ({
      name: skill.name,
      ref: skillRef(skill, repo),
      path: skill.src,
      description: skill.description,
      umbrella: Boolean(skill.isContainer),
      always: isAlways(skill),
    })),
  }));
}

export interface AlwaysChange {
  target: string; // the skills dir written to
  skill: string;
  ref: string;
  action: InstallResult["action"] | UninstallResult["action"];
  reason?: string;
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
