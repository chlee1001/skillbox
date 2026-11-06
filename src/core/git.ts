// Git driver for repo management (P3, but the status helper is used by `status`/UI).
// Uses `git` via Bun's subprocess. Offline-safe: without a fetch we report ahead/behind
// against the already-known upstream; callers can fetch first for accuracy.

import type { GitState } from "./types.ts";

export async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { ok: code === 0, out: (code === 0 ? stdout : stderr || stdout).trim() };
}

export async function gitState(repoPath: string): Promise<GitState> {
  const isRepo = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (!isRepo.ok) return { kind: "not-git" };

  const dirty = await git(repoPath, ["status", "--porcelain"]);
  if (dirty.ok && dirty.out.length > 0) return { kind: "dirty" };

  // ahead/behind vs upstream, if an upstream is configured.
  const counts = await git(repoPath, [
    "rev-list",
    "--left-right",
    "--count",
    "@{upstream}...HEAD",
  ]);
  if (!counts.ok) return { kind: "clean" }; // no upstream configured
  const [behindStr, aheadStr] = counts.out.split(/\s+/);
  const behind = Number(behindStr) || 0;
  const ahead = Number(aheadStr) || 0;
  if (ahead > 0 && behind > 0) return { kind: "diverged", ahead, behind };
  if (ahead > 0) return { kind: "ahead", by: ahead };
  if (behind > 0) return { kind: "behind", by: behind };
  return { kind: "clean" };
}

export async function gitPull(repoPath: string): Promise<{ ok: boolean; out: string }> {
  return git(repoPath, ["pull", "--ff-only"]);
}

// Origin URL, or undefined when no remote named `origin` exists (or not a git repo).
// Classification treats "no origin" as an unbacked owned repo — see core/classify.ts.
export async function getRemoteUrl(repoPath: string): Promise<string | undefined> {
  const r = await git(repoPath, ["remote", "get-url", "origin"]);
  return r.ok && r.out ? r.out : undefined;
}

// Refresh remote-tracking refs so gitState's ahead/behind is accurate. Network I/O —
// callers must treat this as optional (doctor's --fetch), never required.
export async function gitFetch(repoPath: string): Promise<{ ok: boolean; out: string }> {
  return git(repoPath, ["fetch", "--quiet"]);
}

// Expand a (possibly short) rev to a full commit hash; undefined when unknown here.
export async function revParse(repoPath: string, rev: string): Promise<string | undefined> {
  const r = await git(repoPath, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  return r.ok && r.out ? r.out : undefined;
}

// Commits reachable from `to` but not from `from` — how far `from` lags behind `to`.
export async function countCommits(
  repoPath: string,
  from: string,
  to: string,
): Promise<number | undefined> {
  const r = await git(repoPath, ["rev-list", "--count", `${from}..${to}`]);
  if (!r.ok) return undefined;
  const n = Number(r.out);
  return Number.isFinite(n) ? n : undefined;
}

export async function gitClone(url: string, dest: string): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(["git", "clone", url, dest], { stdout: "pipe", stderr: "pipe" });
  const out =
    (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  const code = await proc.exited;
  return { ok: code === 0, out: out.trim() };
}
