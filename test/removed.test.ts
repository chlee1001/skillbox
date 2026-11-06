import { test, expect, beforeEach, afterEach } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let workspace: string;
const cli = join(import.meta.dir, "../src/cli.ts");
const env = () => ({ ...process.env, HOME: root, XDG_CONFIG_HOME: root, SKILLBOX_WORKSPACE: workspace, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" });
async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { stdout: "pipe", stderr: "pipe", env: env() });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
}
async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", cli, ...args], { stdout: "pipe", stderr: "pipe", env: env() });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
}
async function repo(name = "external") {
  const dir = join(workspace, name);
  await mkdir(join(dir, "skills", "sample"), { recursive: true });
  await writeFile(join(dir, "skills", "sample", "SKILL.md"), "# sample\n");
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "initial");
  await git(dir, "remote", "add", "origin", "https://github.com/other/example.git");
  await git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  return dir;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skb-removed-"));
  workspace = join(root, "workspace");
  await mkdir(workspace);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("remove records, lists, hints and hides a re-added repo", async () => {
  const dir = await repo();
  await writeFile(join(workspace, ".skillboxcategory"), "external example\nother keep\n");
  const result = await run("remove", "external");
  expect(result.code).toBe(0);
  expect(result.out).toContain("removed external (1 skills) -> restore: skillbox add https://github.com/other/example.git");
  expect(await access(dir).then(() => true, () => false)).toBe(false);
  const manifest = await readFile(join(workspace, ".skillboxremoved"), "utf8");
  expect(manifest).toMatch(/^external\thttps:\/\/github.com\/other\/example.git\t\d{4}-\d{2}-\d{2}\t\d{4}-\d{2}-\d{2}\tsample\n$/);
  expect(await readFile(join(workspace, ".skillboxcategory"), "utf8")).not.toContain("external");
  const listing = await run("list", "--archived", "external");
  expect(listing.out).toContain("external  ·  removed external repo");
  expect(listing.out).toContain("skills   sample  [1]");
  expect(listing.out).toContain("restore  skillbox add https://github.com/other/example.git");
  expect((await run("list", "--archived", "missing")).out).toBe("archived\n  (none)\n");
  for (const args of [["path", "sample"], ["always", "sample"], ["install", join(root, "target"), "sample"], ["path", "external"]]) {
    const hint = await run(...args);
    expect(hint.code).toBe(2);
    expect(hint.err).toContain("was removed: external (removed ");
  }
  await repo();
  expect((await run("list", "--archived")).out).toBe("archived\n  (none)\n");
});

test("refuses dirty unless forced", async () => {
  const dir = await repo();
  await writeFile(join(dir, "dirty"), "change");
  expect((await run("remove", "external")).code).toBe(2);
  expect((await run("remove", "external", "--force")).code).toBe(0);
});

test("refuses unpushed commits, owned repos and unknown repos", async () => {
  const dir = await repo();
  await writeFile(join(dir, "new"), "change");
  await git(dir, "add", "new");
  await git(dir, "commit", "-q", "-m", "local");
  const ahead = await run("remove", "external");
  expect(ahead.code).toBe(2);
  expect(ahead.err).toContain("commits not on any remote");
  await writeFile(join(workspace, ".skillboxclass"), "external owned\n");
  const owned = await run("remove", "external", "--force");
  expect(owned.code).toBe(2);
  expect(owned.err).toContain("owned");
  expect((await run("remove", "missing")).code).toBe(2);
  expect(await access(dir).then(() => true, () => false)).toBe(true);
});

test("refuses always-on skills even with force", async () => {
  const dir = await repo();
  expect((await run("always", "sample")).code).toBe(0);
  const result = await run("remove", "external", "--force");
  expect(result.code).toBe(2);
  expect(result.err).toContain("skillbox always --off sample");
  expect(await access(dir).then(() => true, () => false)).toBe(true);
});

test("refuses non-git external directories without force", async () => {
  const dir = join(workspace, "external");
  await mkdir(join(dir, "sample"), { recursive: true });
  await writeFile(join(dir, "sample", "SKILL.md"), "# sample\n");
  await writeFile(join(workspace, ".skillboxclass"), "external external\n");
  expect((await run("remove", "external")).err).toContain("not a git repo");
  expect((await run("remove", "external", "--force")).code).toBe(0);
});

test("manifest write failure leaves the clone intact", async () => {
  const dir = await repo();
  await mkdir(join(workspace, ".skillboxremoved"));
  expect((await run("remove", "external")).code).not.toBe(0);
  expect(await access(dir).then(() => true, () => false)).toBe(true);
});
