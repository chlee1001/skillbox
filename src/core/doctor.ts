// Fleet health check — read-only by construction (the claude-overlay doctor.sh rule:
// a check you run habitually must never mutate anything). Three checks:
//   unbacked        owned repo without a git remote — self-authored work with ZERO
//                   backup; losing the folder loses everything. The killer check.
//   external-drift  external clone not cleanly tracking upstream: behind (stale),
//                   dirty/ahead/diverged (local edits in someone else's repo — they
//                   collide with pulls and risk republishing another author's work).
//   broken-link     our symlink in a target whose workspace source is gone (orphan
//                   deployment) — `skillbox prune <target>` fixes.
//
// Offline-safe default: without opts.fetch, behind/ahead reflect the last-known
// remote refs. Pass fetch:true (CLI --fetch) for live accuracy.

import type { Repo, Target } from "./types.ts";
import { gitFetch, gitState } from "./git.ts";
import { statusOfTarget } from "./link.ts";

export interface Finding {
  check: "unbacked" | "external-drift" | "broken-link";
  subject: string; // repo name, or target alias/root for link findings
  detail: string;
}

export interface DoctorReport {
  findings: Finding[];
  verdict: "HEALTHY" | "WARN";
}

// `repos` must already be classified (classify.ts). `targets` = every place we may
// have planted links (registered aliases + agent user scopes).
export async function runDoctor(
  repos: Repo[],
  targets: Target[],
  workspace: string,
  opts: { fetch?: boolean } = {},
): Promise<DoctorReport> {
  const findings: Finding[] = [];

  for (const r of repos) {
    // 1. owned + no remote = unbacked
    if (r.class === "owned" && !r.remote) {
      findings.push({
        check: "unbacked",
        subject: r.name,
        detail: "owned repo has no git remote — folder loss loses everything; push it somewhere",
      });
    }

    // 2. external clone drift
    if (r.class === "external" && r.isGit) {
      if (opts.fetch) await gitFetch(r.path);
      const st = await gitState(r.path);
      if (st.kind === "behind") {
        findings.push({
          check: "external-drift",
          subject: r.name,
          detail: `behind upstream by ${st.by} — skillbox update${opts.fetch ? "" : " (local view; --fetch for live accuracy)"}`,
        });
      } else if (st.kind === "dirty") {
        findings.push({
          check: "external-drift",
          subject: r.name,
          detail: "has uncommitted local edits — external clones must stay pristine (edits collide with pull)",
        });
      } else if (st.kind === "ahead" || st.kind === "diverged") {
        findings.push({
          check: "external-drift",
          subject: r.name,
          detail: `has local commits (${st.kind}) — someone else's repo; move the work or reclassify via .skillboxclass`,
        });
      }
    }
  }

  // 3. broken links = orphan deployments (source deleted after linking)
  for (const t of targets) {
    const links = await statusOfTarget(t, workspace);
    for (const l of links) {
      if (l.health.kind !== "broken") continue;
      findings.push({
        check: "broken-link",
        subject: t.alias ?? t.root,
        detail: `${l.name} -> ${l.health.target} (source gone — skillbox prune)`,
      });
    }
  }

  return { findings, verdict: findings.length ? "WARN" : "HEALTHY" };
}
