// Compare local commits to tracking refs; fetching is optional for offline use.

import type { Repo, RepoClass } from "./types.ts";
import { countCommits, gitFetch, gitState, revParse } from "./git.ts";

export interface VersionRow {
  repo: string;
  class?: RepoClass;
  remote: string;
  head?: string;
  latest?: string;
  status: "CURRENT" | "BEHIND" | "LOCAL" | "NO-UPSTREAM" | "FETCH-FAILED";
  behind?: number;
  ahead?: number;
  note?: string;
}

export async function collectVersions(repos: Repo[], opts: { fetch: boolean }): Promise<VersionRow[]> {
  const rows: VersionRow[] = [];
  for (const repo of repos) {
    if (!repo.isGit || !repo.remote) continue;
    const fetch = opts.fetch ? await gitFetch(repo.path) : undefined;
    const head = await revParse(repo.path, "HEAD");
    const latest = await revParse(repo.path, "@{upstream}");
    const row: VersionRow = {
      repo: repo.name, class: repo.class, remote: repo.remote,
      head: head?.slice(0, 7), latest: latest?.slice(0, 7), status: "CURRENT",
    };
    if (fetch && !fetch.ok) {
      row.status = "FETCH-FAILED";
      row.note = fetch.out.split("\n")[0];
    } else if (!latest || !head) {
      row.status = "NO-UPSTREAM";
    } else {
      row.behind = await countCommits(repo.path, head, latest);
      row.ahead = await countCommits(repo.path, latest, head);
      if (row.ahead && row.ahead > 0) {
        row.status = "LOCAL";
        row.note = "local commits";
      } else if ((await gitState(repo.path)).kind === "dirty") {
        row.status = "LOCAL";
        row.note = "uncommitted edits";
      } else if (row.behind && row.behind > 0) {
        row.status = "BEHIND";
      }
    }
    rows.push(row);
  }
  return rows;
}
