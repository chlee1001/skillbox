// The ONLY bridge between the Ink UI and the headless core. Every screen calls the core
// through this module — so `ui/*.tsx` never imports node:fs / node:path / ../core/* and
// holds no link logic. Keeps §2.2 (core UI-free, UI logic-free) mechanical.

import type { Config, InstallMatrix, Repo, Skill, Target } from "../core/types.ts";
import { scanWorkspace, flattenSkills } from "../core/scan.ts";
import {
  installMatrix,
  columnStates,
  installSkill,
  uninstallSkill,
  statusOfTarget,
  pruneTarget,
  type InstallResult,
  type UninstallResult,
} from "../core/link.ts";
import type { InstalledLink } from "../core/types.ts";
import { gitState, gitPull } from "../core/git.ts";
import { listTargets, loadConfig } from "../core/config.ts";
import { classifyRepos } from "../core/classify.ts";
import { applyCategories } from "../core/category.ts";
import { alwaysTargets, alwaysSrcs } from "../core/always.ts";
import { collectVersions, type VersionRow } from "../core/versions.ts";

export async function loadCtx(): Promise<Config> {
  return loadConfig();
}

// Deterministic-enough timestamp for --force backups (UI is interactive, not replayed).
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function targetsOf(cfg: Config): Target[] {
  return listTargets(cfg);
}

export async function repos(cfg: Config): Promise<Repo[]> {
  const found = await scanWorkspace(cfg.workspace, { ignore: cfg.ignore, includeEmpty: true });
  await classifyRepos(found, cfg.workspace, cfg.ownedOwners);
  await applyCategories(found, cfg.workspace);
  return found;
}

export async function alwaysSrcsOf(cfg: Config): Promise<Set<string>> {
  return alwaysSrcs(await alwaysTargets(), cfg.workspace);
}

export async function versionsOf(repos: Repo[], fetch: boolean): Promise<VersionRow[]> {
  return collectVersions(repos, { fetch });
}

export async function loadMatrix(cfg: Config, targets: Target[]): Promise<InstallMatrix> {
  const skills = flattenSkills(await scanWorkspace(cfg.workspace, { ignore: cfg.ignore }));
  return installMatrix(skills, targets, cfg.workspace);
}

// Toggle a skill's link on a target. `currentlyLinked` decides direction; unlink passes
// expectSrc so a same-name link from another skill is never removed by accident.
export async function toggleLink(
  cfg: Config,
  skill: Skill,
  target: Target,
  opts: { currentlyLinked: boolean; copy?: boolean },
): Promise<InstallResult | UninstallResult> {
  if (opts.currentlyLinked) {
    return uninstallSkill(skill.name, target, cfg.workspace, { expectSrc: skill.src });
  }
  return installSkill(skill, target, cfg.workspace, { copy: opts.copy, stamp: stamp() });
}

// Re-stat one target column (cheap: readdir + per-entry lstat, no repo discovery) — the
// reconcile primitive. Cells are aligned to `skills`.
export async function restatColumn(cfg: Config, skills: Skill[], target: Target) {
  return columnStates(skills, target, cfg.workspace);
}

export async function gitStateFor(repo: Repo) {
  return gitState(repo.path);
}

export async function pull(repo: Repo) {
  return gitPull(repo.path);
}

export async function healthOf(cfg: Config, target: Target): Promise<InstalledLink[]> {
  return statusOfTarget(target, cfg.workspace);
}

export async function prune(cfg: Config, target: Target): Promise<string[]> {
  return pruneTarget(target, cfg.workspace);
}
