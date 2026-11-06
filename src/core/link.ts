// Link management — the safety-critical core. Invariants, never violated:
//   1. We only ever REMOVE a symlink whose target resolves INSIDE the workspace.
//      Foreign links and real directories are reported and left untouched.
//   2. We never clobber a real directory on install unless --force (then we back it
//      up to <name>.bak-<timestamp> instead of deleting).
//   3. We never replace an in-workspace link that points at a DIFFERENT skill's src —
//      same-name skills from different repos cannot silently clobber each other.

import { lstat, mkdir, readlink, readdir, rename, rm, symlink, cp } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import type {
  CellState,
  InstallMatrix,
  InstalledLink,
  LinkHealth,
  MatrixCell,
  MatrixRow,
  Skill,
  Target,
  UnmappedLink,
} from "./types.ts";
import { pathExists, resolveReal } from "./util.ts";

export interface InstallResult {
  skill: string;
  action: "linked" | "copied" | "already-linked" | "refreshed" | "backed-up-and-linked" | "skipped";
  reason?: string;
}

export interface UninstallResult {
  skill: string;
  action: "unlinked" | "skipped";
  reason?: string;
}

// Both args already canonical (realpath'd). Lexical containment on canonical paths.
function isInsideCanon(wsReal: string, tgtReal: string): boolean {
  const rel = relative(wsReal, tgtReal);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Containment with symlinks resolved on BOTH sides — the workspace root and the link
// target may be reached via different spellings (/tmp vs /private/tmp, worktree links).
// Comparing lexically would misclassify our own links as foreign. See util.resolveReal.
async function insideWorkspace(workspace: string, tgt: string): Promise<boolean> {
  const [ws, t] = await Promise.all([resolveReal(workspace), resolveReal(tgt)]);
  return isInsideCanon(ws, t);
}

// Resolve a symlink's stored target to an absolute path (targets may be relative).
async function linkTargetAbs(linkPath: string): Promise<string> {
  const raw = await readlink(linkPath);
  return isAbsolute(raw) ? raw : resolve(join(linkPath, "..", raw));
}

async function ensureSkillsDir(target: Target): Promise<void> {
  await mkdir(target.skillsDir, { recursive: true });
}

// Timestamp passed in (never generated here) so callers stay deterministic/testable.
export async function installSkill(
  skill: Skill,
  target: Target,
  workspace: string,
  opts: { copy?: boolean; force?: boolean; stamp: string },
): Promise<InstallResult> {
  await ensureSkillsDir(target);
  const dst = join(target.skillsDir, skill.name);

  let existing: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    existing = await lstat(dst);
  } catch {
    existing = null;
  }

  if (existing?.isSymbolicLink()) {
    const tgt = await linkTargetAbs(dst).catch(() => "");
    if (!tgt || !(await insideWorkspace(workspace, tgt))) {
      return { skill: skill.name, action: "skipped", reason: `foreign link -> ${tgt}` };
    }
    // Guard: the slot is our link, but does it point at THIS skill? If it holds a
    // different in-workspace src (a same-name skill from another repo), refuse — never
    // silently clobber. Only refresh when it is the same source.
    const [tgtReal, srcReal] = await Promise.all([resolveReal(tgt), resolveReal(skill.src)]);
    if (tgtReal !== srcReal) {
      return { skill: skill.name, action: "skipped", reason: `occupied by ${tgtReal}` };
    }
    // Same source: leave it. Removing and recreating only opens a window where a failed
    // symlink (sandboxed agent, full disk) loses a link that was already correct.
    if (!opts.copy) return { skill: skill.name, action: "already-linked" };
    await rm(dst);
    return finishInstall(skill, dst, opts, "refreshed");
  }

  if (existing) {
    // A real file/dir occupies the slot.
    if (!opts.force) {
      return {
        skill: skill.name,
        action: "skipped",
        reason: "real dir exists — use --force to back up and replace",
      };
    }
    await rename(dst, `${dst}.bak-${opts.stamp}`);
    return finishInstall(skill, dst, opts, "backed-up-and-linked");
  }

  return finishInstall(skill, dst, opts, opts.copy ? "copied" : "linked");
}

async function finishInstall(
  skill: Skill,
  dst: string,
  opts: { copy?: boolean },
  action: InstallResult["action"],
): Promise<InstallResult> {
  if (opts.copy) {
    await cp(skill.src, dst, { recursive: true });
    // A copy is a real dir, so `uninstall` (which only removes symlinks) will NOT
    // remove it and git pull will NOT propagate to it. Say so at install time.
    return {
      skill: skill.name,
      action: "copied",
      reason: "real dir — uninstall won't remove it, git pull won't update it",
    };
  }
  await symlink(skill.src, dst);
  return { skill: skill.name, action };
}

// `expectSrc`: when the caller knows which skill's link it means to remove (Screen B
// holds the Skill), pass its src so we refuse to remove a same-named link belonging to
// a different skill.
export async function uninstallSkill(
  name: string,
  target: Target,
  workspace: string,
  opts: { expectSrc?: string } = {},
): Promise<UninstallResult> {
  const dst = join(target.skillsDir, name);
  let st;
  try {
    st = await lstat(dst);
  } catch {
    return { skill: name, action: "skipped", reason: "not present" };
  }
  if (!st.isSymbolicLink()) {
    return { skill: name, action: "skipped", reason: "real dir — not a link, left untouched" };
  }
  const tgt = await linkTargetAbs(dst).catch(() => "");
  if (!tgt || !(await insideWorkspace(workspace, tgt))) {
    return { skill: name, action: "skipped", reason: `link points outside workspace -> ${tgt}` };
  }
  if (opts.expectSrc) {
    const [tgtReal, expReal] = await Promise.all([resolveReal(tgt), resolveReal(opts.expectSrc)]);
    if (tgtReal !== expReal) {
      return { skill: name, action: "skipped", reason: `slot holds a different skill -> ${tgtReal}` };
    }
  }
  await rm(dst);
  return { skill: name, action: "unlinked" };
}

// One entry of a target's skills dir, with the link target already canonicalized.
interface RawEntry {
  name: string;
  path: string;
  health: LinkHealth;
  canonTarget?: string; // set for symlinks (resolveReal of the stored target)
}

// Read + classify a target's skills dir. Workspace is canonicalized ONCE by the caller
// (hoisted out of the per-entry loop).
async function scanTargetEntries(target: Target, wsReal: string): Promise<RawEntry[]> {
  let entries;
  try {
    entries = await readdir(target.skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: RawEntry[] = [];
  for (const e of entries) {
    const p = join(target.skillsDir, e.name);
    if (e.isSymbolicLink()) {
      const tgt = await linkTargetAbs(p).catch(() => "");
      const canon = tgt ? await resolveReal(tgt) : "";
      if (tgt && isInsideCanon(wsReal, canon)) {
        const health: LinkHealth = (await pathExists(tgt))
          ? { kind: "ok", skill: e.name, target: tgt }
          : { kind: "broken", target: tgt };
        out.push({ name: e.name, path: p, health, canonTarget: canon });
      } else {
        out.push({ name: e.name, path: p, health: { kind: "foreign-link", target: tgt }, canonTarget: canon });
      }
    } else {
      out.push({ name: e.name, path: p, health: { kind: "real-dir" } });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Inspect every entry in a target's skills dir and classify it.
export async function statusOfTarget(target: Target, workspace: string): Promise<InstalledLink[]> {
  const wsReal = await resolveReal(workspace);
  const raw = await scanTargetEntries(target, wsReal);
  return raw.map((r) => ({ name: r.name, path: r.path, health: r.health }));
}

// Pure classifier for ONE target column. Shared by installMatrix (all columns) and
// columnStates (the UI's per-toggle reconcile) so classification lives in exactly one
// place. srcReals is aligned to `skills`; containerReals are the canonical srcs of
// umbrella skills; srcSet is every skill src (for unmapped detection).
function classifyColumn(
  skills: Skill[],
  srcReals: string[],
  containerReals: string[],
  srcSet: Set<string>,
  entries: RawEntry[],
): { cells: { state: CellState; linkPath?: string }[]; unmapped: { name: string; path: string; target: string }[] } {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const okSrc = new Set(entries.filter((e) => e.health.kind === "ok").map((e) => e.canonTarget!));

  const unmapped = entries
    .filter((e) => (e.health.kind === "ok" || e.health.kind === "broken") && e.canonTarget && !srcSet.has(e.canonTarget))
    .map((e) => ({ name: e.name, path: e.path, target: e.canonTarget! }));

  const cells = skills.map((s, i) => {
    const srcReal = srcReals[i];
    const entry = byName.get(s.name);
    let state: CellState;
    if (entry) {
      const h = entry.health;
      if (h.kind === "ok" && entry.canonTarget === srcReal) state = "linked";
      else if (h.kind === "broken" && entry.canonTarget === srcReal) state = "broken";
      else if (h.kind === "foreign-link") state = "foreign";
      else state = "conflict"; // real dir, or a symlink to a different src
    } else {
      const covered = containerReals.some((c) => c !== srcReal && okSrc.has(c) && srcReal.startsWith(c + sep));
      state = covered ? "covered" : "absent";
    }
    return { state, linkPath: entry?.path };
  });

  return { cells, unmapped };
}

async function canonSrcs(skills: Skill[]): Promise<{ srcReals: string[]; containerReals: string[]; srcSet: Set<string> }> {
  const srcReals = await Promise.all(skills.map((s) => resolveReal(s.src)));
  const srcSet = new Set(srcReals);
  const containerReals = skills.map((s, i) => (s.isContainer ? srcReals[i] : "")).filter(Boolean);
  return { srcReals, containerReals, srcSet };
}

// Build the skill × target matrix (Screen B). Canonicalized hash-join: each skill.src
// and each link target is realpath'd once, joined in memory.
export async function installMatrix(
  skills: Skill[],
  targets: Target[],
  workspace: string,
): Promise<InstallMatrix> {
  const wsReal = await resolveReal(workspace);
  const { srcReals, containerReals, srcSet } = await canonSrcs(skills);

  const rows: MatrixRow[] = skills.map((s) => ({ skill: s, cells: [] }));
  const unmapped: UnmappedLink[] = [];

  for (const target of targets) {
    const key = target.alias ?? target.root;
    const entries = await scanTargetEntries(target, wsReal);
    const col = classifyColumn(skills, srcReals, containerReals, srcSet, entries);
    col.cells.forEach((c, i) => rows[i].cells.push({ targetKey: key, ...c }));
    for (const u of col.unmapped) unmapped.push({ targetKey: key, ...u });
  }
  return { rows, unmapped };
}

// Re-stat ONE target column (the UI's cheap reconcile after a toggle — no repo discovery,
// just readdir + lstat). Returns cells aligned to `skills`. Note: `unmapped` is NOT
// returned here — it is only meaningful against the FULL skill set (installMatrix), and
// Screen B calls this with a repo-filtered subset. `cells`/`covered` are correct under a
// subset because a container and its subs are always same-repo and `okSrc` derives from
// all on-disk entries, so a per-column reconcile matches a full rebuild for that column.
export async function columnStates(
  skills: Skill[],
  target: Target,
  workspace: string,
): Promise<{ cells: MatrixCell[] }> {
  const wsReal = await resolveReal(workspace);
  const { srcReals, containerReals, srcSet } = await canonSrcs(skills);
  const key = target.alias ?? target.root;
  const entries = await scanTargetEntries(target, wsReal);
  const col = classifyColumn(skills, srcReals, containerReals, srcSet, entries);
  return { cells: col.cells.map((c) => ({ targetKey: key, ...c })) };
}

// Remove only our own BROKEN links (target inside workspace but source gone).
export async function pruneTarget(target: Target, workspace: string): Promise<string[]> {
  const links = await statusOfTarget(target, workspace);
  const pruned: string[] = [];
  for (const l of links) {
    if (l.health.kind === "broken") {
      await rm(l.path);
      pruned.push(l.name);
    }
  }
  return pruned;
}
