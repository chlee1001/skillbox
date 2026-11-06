import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectVersions } from "../src/core/versions.ts";
import type { Repo } from "../src/core/types.ts";

let root: string;
async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (await proc.exited) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "skb-versions-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("versions track fetched commits, local changes, missing upstream and fetch failure", async () => {
  const bare = join(root, "upstream.git");
  const clone = join(root, "clone");
  const other = join(root, "other");
  await git(root, "init", "--bare", "-q", "-b", "main", bare);
  await git(root, "clone", "-q", bare, clone);
  await writeFile(join(clone, "base"), "base");
  await git(clone, "add", "base");
  await git(clone, "commit", "-q", "-m", "base");
  await git(clone, "push", "-q", "-u", "origin", "main");
  const repo: Repo = { name: "clone", path: clone, isGit: true, skills: [], git: { kind: "unknown" }, class: "external", remote: bare };
  const row = async (fetch: boolean) => (await collectVersions([repo], { fetch }))[0]!;
  const fresh = await row(false);
  expect(fresh.status).toBe("CURRENT");
  expect(fresh.head).toHaveLength(7);
  expect(fresh.head).toBe(fresh.latest);

  await git(root, "clone", "-q", bare, other);
  await writeFile(join(other, "remote"), "remote");
  await git(other, "add", "remote");
  await git(other, "commit", "-q", "-m", "remote");
  await git(other, "push", "-q");
  expect((await row(false)).status).toBe("CURRENT");
  const behind = await row(true);
  expect(behind.status).toBe("BEHIND");
  expect(behind.behind).toBe(1);
  expect(behind.latest).not.toBe(behind.head);

  await writeFile(join(clone, "local"), "local");
  expect(await row(false)).toMatchObject({ status: "LOCAL", note: "uncommitted edits" });
  await git(clone, "add", "local");
  await git(clone, "commit", "-q", "-m", "local");
  expect(await row(false)).toMatchObject({ status: "LOCAL", note: "local commits", ahead: 1, behind: 1 });
  await git(clone, "checkout", "-q", "-b", "untracked");
  expect((await row(false)).status).toBe("NO-UPSTREAM");
  await git(clone, "remote", "set-url", "origin", join(root, "missing.git"));
  const failed = await row(true);
  expect(failed.status).toBe("FETCH-FAILED");
  expect(failed.note).toBeTruthy();
  expect(failed.head).toHaveLength(7);
  expect(await collectVersions([{ ...repo, remote: undefined }, { ...repo, isGit: false }], { fetch: false })).toEqual([]);
});
