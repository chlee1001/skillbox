// Repo classification: external (someone else's upstream we clone) vs owned (ours).
// This exists because the two must be treated differently everywhere:
//   update  — pull external only (never risk local commits in owned repos)
//   doctor  — owned without a remote = UNBACKED (self-authored work with zero backup)
//   drift   — owned repos pin external contracts; compare pins against external HEADs
//
// Judgment order (first hit wins):
//   1. `.skillboxclass` manifest at the workspace root — explicit override.
//   2. git remote origin owner: owner in `ownedOwners` -> owned, anyone else -> external.
//   3. no remote at all -> owned (assumed self-authored, not yet backed up).
//
// Classification is a POST-SCAN pass (mutates Repo.class/.remote in place) so scan.ts
// stays fs-only and paths that don't need class never pay the git subprocess cost.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repo, RepoClass } from "./types.ts";
import { getRemoteUrl } from "./git.ts";

// `.skillboxclass` — same shape as `.skillboxignore`: one entry per line, `#` comments.
// Entry: `<repo-dir-name> <external|owned>` (an optional `:` after the name is tolerated).
// Lines that don't parse to a valid class are ignored rather than fatal: a typo in a
// convenience file must never break scanning.
export async function readClassManifest(workspace: string): Promise<Map<string, RepoClass>> {
  const map = new Map<string, RepoClass>();
  let text: string;
  try {
    text = await readFile(join(workspace, ".skillboxclass"), "utf8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) continue;
    const [name, cls] = clean.split(/[\s:]+/);
    if (name && (cls === "external" || cls === "owned")) map.set(name, cls);
  }
  return map;
}

// Owner (user/org) from a git remote URL. Handles the forms actually present in the
// fleet: https://host/owner/repo(.git), git@host:owner/repo.git, ssh://git@host/owner/repo.
export function parseRemoteOwner(url: string): string | undefined {
  // scp-like: git@github.com:owner/repo.git
  const scp = url.match(/^[^@\s/]+@[^:\s]+:\/?([^/\s]+)\/[^/\s]+/);
  if (scp) return scp[1];
  // scheme://[user@]host/owner/repo
  const scheme = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]+@)?[^/\s]+\/([^/\s]+)\/[^/\s]+/i);
  if (scheme) return scheme[1];
  return undefined;
}

// Fill class+remote on every repo. Remote is recorded even when the manifest overrides
// the class, because doctor's "owned but unbacked" check reads `remote` independently.
export async function classifyRepos(
  repos: Repo[],
  workspace: string,
  ownedOwners: string[],
): Promise<Repo[]> {
  const manifest = await readClassManifest(workspace);
  const owners = new Set(ownedOwners.map((o) => o.toLowerCase()));
  for (const repo of repos) {
    repo.remote = repo.isGit ? await getRemoteUrl(repo.path) : undefined;
    const forced = manifest.get(repo.name);
    if (forced) {
      repo.class = forced;
      continue;
    }
    if (repo.remote) {
      const owner = parseRemoteOwner(repo.remote)?.toLowerCase();
      repo.class = owner && owners.has(owner) ? "owned" : "external";
      continue;
    }
    repo.class = "owned"; // no remote: self-authored and unbacked
  }
  return repos;
}
