// Domain model. The whole tool is stateless: "what is installed" is derived from
// symlink targets on disk, never from a database. These types describe what a scan
// produces and what link operations consume.

export type GitState =
  | { kind: "clean" }
  | { kind: "dirty" } // uncommitted local changes
  | { kind: "ahead"; by: number }
  | { kind: "behind"; by: number }
  | { kind: "diverged"; ahead: number; behind: number }
  | { kind: "not-git" }
  | { kind: "unknown" }; // e.g. fetch not run yet

// Repo classification. `external` = a clone of someone else's upstream (we pull, never
// author). `owned` = ours (we author, must be backed up to a remote). "Unbacked" is NOT
// a third class — it is the derived state `class === "owned" && !remote`, surfaced by
// doctor. Kept binary so list/update filters stay stable when a remote is added later.
export type RepoClass = "external" | "owned";

export interface Skill {
  name: string; // basename of the SKILL.md parent dir
  src: string; // absolute path to that dir (the symlink target)
  repo: string; // owning repo name (basename of repo dir)
  description?: string; // parsed from SKILL.md frontmatter, for display
  // Umbrella skill: its own dir also contains sub-skills (a `skills/` child), so linking
  // it pulls the subs in too. `--all` skips these; install by explicit name only.
  isContainer?: boolean;
}

export interface Repo {
  name: string; // basename of the repo dir under the workspace
  path: string; // absolute path
  isGit: boolean;
  skills: Skill[];
  git: GitState;
  // Filled by classify.ts (a post-scan pass — scan itself stays fs-only/git-free).
  class?: RepoClass;
  remote?: string; // origin URL when one exists; owned && !remote = unbacked
  category?: string;
}

// A link found in a target project's .claude/skills/ dir.
export type LinkHealth =
  | { kind: "ok"; skill: string; target: string } // symlink into workspace, resolves
  | { kind: "broken"; target: string } // symlink into workspace, source gone
  | { kind: "foreign-link"; target: string } // symlink pointing outside workspace — untouchable
  | { kind: "real-dir" }; // a real directory, not a link — untouchable

export interface InstalledLink {
  name: string; // entry name in .claude/skills/
  path: string; // absolute path of the entry
  health: LinkHealth;
}

export interface Target {
  alias?: string; // friendly name from config, e.g. "work-plus-all"
  root: string; // project root (or ~/.claude for user scope)
  skillsDir: string; // <root>/.claude/skills  (or ~/.claude/skills)
}

// Persisted config schema — exactly what lives in config.json. Kept separate from the
// loaded `Config` view so we never write back derived values (canonicalized workspace,
// file-merged ignore).
export interface RawConfig {
  workspace?: string;
  targets?: Record<string, string>;
  ignore?: string[];
  ownedOwners?: string[]; // git remote owners considered "mine" for repo classification
}

// Loaded, resolved view used at runtime.
export interface Config {
  workspace: string; // realpath-canonicalized root folder holding the cloned skill repos
  targets: Record<string, string>; // alias -> project root
  ignore: string[]; // repo dir names to skip (config + .skillboxignore merged)
  ownedOwners: string[]; // config value or DEFAULT_OWNED_OWNERS
}

// The install matrix: per skill, its state across every target (Screen B's grid).
//   linked   — a symlink at this name resolves to THIS skill's src
//   broken   — such a symlink exists but its source is gone
//   conflict — the name slot is occupied by something else (real dir, or a link to a
//              different in-workspace src) — cannot link without resolving it
//   foreign  — the name slot holds a symlink pointing outside the workspace
//   covered  — no own link, but an umbrella whose subtree contains this skill IS linked
//              here (reachable via the umbrella; direct toggle blocked to avoid dup)
//   absent   — nothing here; free to link
export type CellState = "linked" | "broken" | "conflict" | "foreign" | "covered" | "absent";

export interface MatrixCell {
  targetKey: string; // target alias or root
  state: CellState;
  linkPath?: string; // the entry path in the target, when one exists
}

export interface MatrixRow {
  skill: Skill;
  cells: MatrixCell[]; // one per target, in the given target order
}

// In-workspace links that don't map to any discovered skill (ignored repo, mid-tree) —
// surfaced (Screen C) rather than silently dropped, so the matrix stays a faithful view.
export interface UnmappedLink {
  targetKey: string;
  name: string;
  path: string;
  target: string; // canonical resolved target
}

export interface InstallMatrix {
  rows: MatrixRow[];
  unmapped: UnmappedLink[];
}
