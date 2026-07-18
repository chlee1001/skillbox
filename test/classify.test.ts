import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRemoteOwner, readClassManifest, classifyRepos } from "../src/core/classify.ts";
import type { Repo } from "../src/core/types.ts";

let ws: string;

function repo(name: string, isGit: boolean): Repo {
  return { name, path: join(ws, name), isGit, skills: [], git: { kind: "unknown" } };
}

async function gitRepo(name: string, remote?: string): Promise<Repo> {
  const p = join(ws, name);
  await mkdir(p, { recursive: true });
  const run = async (...args: string[]) => {
    const proc = Bun.spawn(["git", "-C", p, ...args], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
  };
  await run("init", "-q");
  if (remote) await run("remote", "add", "origin", remote);
  return repo(name, true);
}

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "skb-cls-"));
});

afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

test("parseRemoteOwner handles https / scp / ssh forms", () => {
  expect(parseRemoteOwner("https://github.com/fivetaku/insane-design.git")).toBe("fivetaku");
  expect(parseRemoteOwner("https://github.com/chlee1001/render-watch")).toBe("chlee1001");
  expect(parseRemoteOwner("git@github.com:phuryn/pm-skills.git")).toBe("phuryn");
  expect(parseRemoteOwner("ssh://git@github.com/chlee1001/skillbox.git")).toBe("chlee1001");
  expect(parseRemoteOwner("not a url")).toBeUndefined();
});

test("remote owner inference: mine -> owned, other -> external (case-insensitive)", async () => {
  const mine = await gitRepo("mine", "git@github.com:ChLee1001/mine.git");
  const theirs = await gitRepo("theirs", "https://github.com/someoneelse/theirs.git");
  await classifyRepos([mine, theirs], ws, ["chlee1001"]);
  expect(mine.class).toBe("owned");
  expect(mine.remote).toBe("git@github.com:ChLee1001/mine.git");
  expect(theirs.class).toBe("external");
});

test("no remote -> owned with remote undefined (the unbacked state)", async () => {
  const bare = await gitRepo("fresh"); // git init, no remote
  const plain = repo("notgit", false); // not even a git repo
  await mkdir(plain.path, { recursive: true });
  await classifyRepos([bare, plain], ws, ["chlee1001"]);
  expect(bare.class).toBe("owned");
  expect(bare.remote).toBeUndefined();
  expect(plain.class).toBe("owned");
  expect(plain.remote).toBeUndefined();
});

test(".skillboxclass manifest overrides remote inference, remote still recorded", async () => {
  await writeFile(
    join(ws, ".skillboxclass"),
    "# comment\n\nforced-ext external   # even though remote is mine\nforced-owned: owned\nbadline whatever\n",
  );
  const manifest = await readClassManifest(ws);
  expect(manifest.get("forced-ext")).toBe("external");
  expect(manifest.get("forced-owned")).toBe("owned");
  expect(manifest.has("badline")).toBe(false); // invalid class ignored, not fatal

  const r = await gitRepo("forced-ext", "https://github.com/chlee1001/forced-ext.git");
  await classifyRepos([r], ws, ["chlee1001"]);
  expect(r.class).toBe("external"); // manifest wins over owned remote
  expect(r.remote).toBe("https://github.com/chlee1001/forced-ext.git");
});
