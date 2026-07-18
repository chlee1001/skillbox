import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRepos } from "../src/core/classify.ts";
import { collectDrift } from "../src/core/drift.ts";
import { scanWorkspace } from "../src/core/scan.ts";

let ws: string;

async function run(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(
    ["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

async function skill(dir: string, name: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
}

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "skb-drift-"));
});

afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

test("drift: CURRENT when pin == external HEAD, STALE after upstream moves, UNKNOWN for bad pins", async () => {
  // external repo with one commit
  const ext = join(ws, "vendor");
  await skill(join(ext, "skills", "v"), "v");
  await run(ws, "init", "-q", "-b", "main", "vendor");
  await run(ext, "add", "-A");
  await run(ext, "commit", "-q", "-m", "c1");
  await run(ext, "remote", "add", "origin", "https://github.com/other/vendor.git");
  const head = await run(ext, "rev-parse", "--short", "HEAD");

  // owned repo pinning vendor at HEAD (+ one garbage pin for the UNKNOWN path)
  const mine = join(ws, "orchestrator");
  await skill(mine, "orchestrator");
  await run(ws, "init", "-q", "-b", "main", "orchestrator");
  await run(mine, "remote", "add", "origin", "git@github.com:chlee1001/orchestrator.git");
  const upstreams = {
    schema: 1,
    id: "orchestrator",
    upstreams: [
      { id: "vendor", local_path: "claude-skills/vendor", pinned: { commit: head } },
      { id: "vendor", pinned: { commit: "deadbeef" } },
      { id: "not-cloned", pinned: { commit: "abc1234" } },
    ],
  };
  await writeFile(join(mine, "upstreams.json"), JSON.stringify(upstreams));

  const repos = await scanWorkspace(ws, { includeEmpty: true });
  await classifyRepos(repos, ws, ["chlee1001"]);

  // pin == HEAD -> CURRENT; garbage pin / missing repo -> UNKNOWN with reasons
  let rows = await collectDrift(repos);
  expect(rows.map((r) => r.status)).toEqual(["CURRENT", "UNKNOWN", "UNKNOWN"]);
  expect(rows[1]!.note).toContain("pin not found");
  expect(rows[2]!.note).toContain("not in workspace");

  // upstream moves two commits past the pin -> STALE +2
  await writeFile(join(ext, "a.md"), "1");
  await run(ext, "add", "-A");
  await run(ext, "commit", "-q", "-m", "c2");
  await writeFile(join(ext, "b.md"), "2");
  await run(ext, "add", "-A");
  await run(ext, "commit", "-q", "-m", "c3");

  rows = await collectDrift(repos);
  expect(rows[0]).toMatchObject({ owner: "orchestrator", upstream: "vendor", status: "STALE", behind: 2 });
});

test("drift: external repos and owned repos without upstreams.json contribute nothing", async () => {
  await skill(join(ws, "plain", "skills", "p"), "p");
  const repos = await scanWorkspace(ws, { includeEmpty: true });
  await classifyRepos(repos, ws, ["chlee1001"]);
  expect(await collectDrift(repos)).toEqual([]);
});
