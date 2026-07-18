// Pin drift — the lightweight cousin of claude-overlay's reabsorb: DETECT AND REPORT
// ONLY, never auto-update anything. Owned repos may declare `upstreams.json` at their
// root (schema 1, the design-orchestrator pattern: pinned.commit + break_if contract).
// We aggregate every such pin and compare it against the CURRENT LOCAL HEAD of the
// pinned external clone in the workspace:
//   CURRENT  pin == HEAD (or pin is ahead — nothing new since the pin)
//   STALE    external HEAD has moved N commits past the pin — run the owner's
//            drift-check procedure (e.g. references/drift-check.md) and re-pin
//   UNKNOWN  pin/entry/upstream repo can't be resolved — says why in `note`

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Repo } from "./types.ts";
import { countCommits, revParse } from "./git.ts";

export interface DriftRow {
  owner: string; // owned repo declaring the pin
  upstream: string; // upstream id from upstreams.json
  pin: string; // pinned.commit as written
  status: "CURRENT" | "STALE" | "UNKNOWN";
  behind?: number; // STALE: commits on upstream HEAD since the pin
  note?: string; // UNKNOWN: why it could not be judged
}

interface UpstreamEntry {
  id?: unknown;
  local_path?: unknown;
  pinned?: { commit?: unknown };
}

// `repos` must already be classified. Owned repos without an upstreams.json simply
// contribute no rows — declaring pins is opt-in per repo.
export async function collectDrift(repos: Repo[]): Promise<DriftRow[]> {
  const rows: DriftRow[] = [];
  const byName = new Map(repos.map((r) => [r.name, r]));

  for (const owned of repos) {
    if (owned.class !== "owned") continue;
    let doc: { schema?: unknown; upstreams?: unknown };
    try {
      doc = JSON.parse(await readFile(join(owned.path, "upstreams.json"), "utf8"));
    } catch {
      continue; // no file (or unreadable JSON) — nothing declared
    }
    if (doc.schema !== 1 || !Array.isArray(doc.upstreams)) {
      rows.push({ owner: owned.name, upstream: "*", pin: "?", status: "UNKNOWN", note: `unsupported upstreams.json (schema ${String(doc.schema)})` });
      continue;
    }

    for (const u of doc.upstreams as UpstreamEntry[]) {
      const id = typeof u.id === "string" ? u.id : undefined;
      const pin = typeof u.pinned?.commit === "string" ? u.pinned.commit : undefined;
      const row = (r: Omit<DriftRow, "owner" | "upstream" | "pin">) =>
        rows.push({ owner: owned.name, upstream: id ?? "?", pin: pin ?? "?", ...r });
      if (!id || !pin) {
        row({ status: "UNKNOWN", note: "entry missing id or pinned.commit" });
        continue;
      }
      // Resolve the external clone: id == repo dir name, else basename(local_path)
      // (local_path in the wild is "<workspace-basename>/<repo>", not workspace-relative).
      const target =
        byName.get(id) ??
        (typeof u.local_path === "string" ? byName.get(basename(u.local_path)) : undefined);
      if (!target?.isGit) {
        row({ status: "UNKNOWN", note: "pinned upstream repo not in workspace" });
        continue;
      }
      const pinFull = await revParse(target.path, pin);
      if (!pinFull) {
        row({ status: "UNKNOWN", note: `pin not found in ${target.name} history` });
        continue;
      }
      const behind = await countCommits(target.path, pinFull, "HEAD");
      if (behind === undefined) {
        row({ status: "UNKNOWN", note: "rev-list failed" });
        continue;
      }
      if (behind > 0) row({ status: "STALE", behind });
      else row({ status: "CURRENT" });
    }
  }
  return rows;
}
