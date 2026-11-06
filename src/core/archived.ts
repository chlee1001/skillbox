import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./git.ts";
import { scanRepo } from "./scan.ts";
import type { Repo } from "./types.ts";
import { resolveReal } from "./util.ts";

export type ArchivedEntry = {
  repo: string;
  entry: string;
  path: string;
  skills: string[];
  added: string | null;
  archived: string | null;
  uncommitted: boolean;
};

async function firstDate(repo: string, path: string, firstParent = false): Promise<string | null> {
  const result = await git(repo, ["log", ...(firstParent ? ["--first-parent"] : []), "--format=%as", "--reverse", "--", path]);
  return result.ok && result.out ? result.out.split("\n")[0] : null;
}

export async function findArchived(repos: Repo[]): Promise<ArchivedEntry[]> {
  const found: ArchivedEntry[] = [];
  for (const repo of repos) {
    const archive = join(repo.path, "archive");
    const entries = await readdir(archive, { withFileTypes: true }).catch(() => []);
    if (!entries.some((entry) => entry.isDirectory() && !entry.name.startsWith("."))) continue;
    const top = await git(repo.path, ["rev-parse", "--show-toplevel"]);
    const isGitRepo = top.ok && await resolveReal(top.out) === await resolveReal(repo.path);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const path = join(archive, entry.name);
      const relative = `archive/${entry.name}`;
      const [scanned, added, archived, status] = await Promise.all([
        scanRepo(path),
        isGitRepo ? firstDate(repo.path, relative) : null,
        isGitRepo ? firstDate(repo.path, relative, true) : null,
        isGitRepo ? git(repo.path, ["status", "--porcelain", "--", relative]) : { ok: false, out: "" },
      ]);
      found.push({
        repo: repo.name,
        entry: entry.name,
        path,
        skills: [...new Set(scanned.skills.map((skill) => skill.name))].sort((a, b) => a.localeCompare(b)),
        added,
        archived,
        uncommitted: !added || !archived || !status.ok || !!status.out,
      });
    }
  }
  return found;
}

export function archivedMatches(entries: ArchivedEntry[], name: string): ArchivedEntry[] {
  return entries.filter((entry) => entry.entry === name || entry.skills.includes(name));
}
