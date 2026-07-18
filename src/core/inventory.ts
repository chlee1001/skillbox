// Fleet inventory — the claude-overlay INVENTORY.md pattern: one always-current table
// derived entirely from disk truth (scan + classify + installMatrix), never hand-written.
// Per skill: owning repo, class, remote, where it is linked, and the repo's drift state.
// Offline: drift is the LOCAL view (last-known remote refs); doctor --fetch is the live
// counterpart, matching overlay's inventory(recorded pin) vs reabsorb(live) split.

import type { Repo, RepoClass, Target } from "./types.ts";
import { flattenSkills } from "./scan.ts";
import { installMatrix } from "./link.ts";
import { gitState } from "./git.ts";

export interface InventoryRow {
  skill: string;
  repo: string;
  class?: RepoClass;
  remote?: string;
  targets: string[]; // target keys where present; "key~" = covered via a linked umbrella
  drift: string; // external repos: "behind 3" / "dirty" / "ahead 1" / "diverged +a/-b" / ""
}

// `repos` must already be classified.
export async function buildInventory(
  repos: Repo[],
  targets: Target[],
  workspace: string,
): Promise<InventoryRow[]> {
  const skills = flattenSkills(repos);
  const matrix = await installMatrix(skills, targets, workspace);

  const driftByRepo = new Map<string, string>();
  for (const r of repos) {
    if (r.class !== "external" || !r.isGit) continue;
    const st = await gitState(r.path);
    const drift =
      st.kind === "behind" ? `behind ${st.by}` :
      st.kind === "dirty" ? "dirty" :
      st.kind === "ahead" ? `ahead ${st.by}` :
      st.kind === "diverged" ? `diverged +${st.ahead}/-${st.behind}` : "";
    driftByRepo.set(r.name, drift);
  }

  const byName = new Map(repos.map((r) => [r.name, r]));
  return matrix.rows.map((row) => {
    const repo = byName.get(row.skill.repo);
    const where = row.cells
      .filter((c) => c.state === "linked" || c.state === "covered")
      .map((c) => (c.state === "covered" ? `${c.targetKey}~` : c.targetKey));
    return {
      skill: row.skill.name,
      repo: row.skill.repo,
      class: repo?.class,
      remote: repo?.remote,
      targets: where,
      drift: driftByRepo.get(row.skill.repo) ?? "",
    };
  });
}

export function renderInventory(rows: InventoryRow[], meta: { date: string; workspace: string }): string {
  const cell = (r: InventoryRow) => {
    const cls = (r.class ?? "?") + (r.class === "owned" && !r.remote ? " UNBACKED" : "");
    return `| ${r.skill} | ${r.repo} | ${cls} | ${r.remote ?? "—"} | ${r.targets.join(", ") || "—"} | ${r.drift || "—"} |`;
  };
  return [
    "# skillbox inventory",
    "",
    `generated: ${meta.date} · workspace: ${meta.workspace}`,
    "targets: `alias` = linked · `alias~` = covered via a linked umbrella · drift is the local (offline) view",
    "",
    "| skill | repo | class | remote | targets | drift |",
    "|---|---|---|---|---|---|",
    ...rows.map(cell),
    "",
  ].join("\n");
}
