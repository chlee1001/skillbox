import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, writeFile, symlink, rm, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanWorkspace, flattenSkills } from "../src/core/scan.ts";
import { installSkill, uninstallSkill, statusOfTarget, pruneTarget } from "../src/core/link.ts";
import type { Target } from "../src/core/types.ts";

let ws: string; // workspace of clones
let proj: string; // target project root
let target: Target;

async function skill(dir: string, name: string, desc = "d") {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n`);
}

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "skb-ws-"));
  proj = await mkdtemp(join(tmpdir(), "skb-proj-"));
  target = { root: proj, skillsDir: join(proj, ".claude", "skills") };

  // repo A: flat skills/<name>/SKILL.md
  await skill(join(ws, "repoA", "skills", "alpha"), "alpha");
  await skill(join(ws, "repoA", "skills", "beta"), "beta");
  // repo A also has references/ with a stray md that must NOT be a skill
  await mkdir(join(ws, "repoA", "skills", "alpha", "references"), { recursive: true });
  await writeFile(join(ws, "repoA", "skills", "alpha", "references", "notes.md"), "x");
  // repo A also keeps a retired skill under archive/ — must NOT be a skill
  await skill(join(ws, "repoA", "archive", "old", "skills", "gamma"), "gamma");
  // repo B: double-nested root SKILL.md  (repoB/repoB/SKILL.md)
  await skill(join(ws, "repoB", "repoB"), "repoB");
  // repo C: umbrella root SKILL.md + skills/<name> sub-skills (korean-privacy-terms shape)
  await skill(join(ws, "repoC", "repoC"), "repoC");
  await skill(join(ws, "repoC", "repoC", "skills", "sub1"), "sub1");
  await skill(join(ws, "repoC", "repoC", "skills", "sub2"), "sub2");
  // a non-skill folder with no SKILL.md — must be skipped
  await mkdir(join(ws, "justdocs"), { recursive: true });
});

afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true });
});

test("scan discovers heterogeneous layouts and skips noise", async () => {
  const repos = await scanWorkspace(ws);
  const names = repos.map((r) => r.name).sort();
  expect(names).toEqual(["repoA", "repoB", "repoC"]); // justdocs skipped (no SKILL.md)

  const skills = flattenSkills(repos).map((s) => s.name).sort();
  // alpha, beta from flat; repoB from nested root; repoC umbrella + its sub1/sub2.
  // references/notes.md and archive/**/gamma are NOT skills.
  expect(skills).toEqual(["alpha", "beta", "repoB", "repoC", "sub1", "sub2"]);

  // repoC is an umbrella (contains sub-skills); its subs and the flat skills are not.
  const flat = flattenSkills(repos);
  expect(flat.find((s) => s.name === "repoC")!.isContainer).toBe(true);
  expect(flat.find((s) => s.name === "sub1")!.isContainer).toBeUndefined();
  expect(flat.find((s) => s.name === "alpha")!.isContainer).toBeUndefined();
});

test("a generic skill/ folder is named by its frontmatter, else its parent dir", async () => {
  await skill(join(ws, "repoD", "git-workflow", "skill"), "git-workflow");
  await mkdir(join(ws, "repoD", "voice", "skill"), { recursive: true });
  await writeFile(join(ws, "repoD", "voice", "skill", "SKILL.md"), "# no frontmatter\n");
  const names = flattenSkills(await scanWorkspace(ws, { ignore: ["repoA", "repoB", "repoC"] }))
    .map((s) => s.name)
    .sort();
  expect(names).toEqual(["git-workflow", "voice"]);
});

test("scanWorkspace honors the ignore list", async () => {
  const repos = await scanWorkspace(ws, { ignore: ["repoB"] });
  expect(repos.map((r) => r.name).sort()).toEqual(["repoA", "repoC"]);
});

test("uninstall works when workspace is reached via a symlinked ancestor (realpath)", async () => {
  // Simulate /tmp->/private/tmp: link to the workspace and drive everything through it.
  const wsLink = join(proj, "ws-link");
  await symlink(ws, wsLink);
  const skills = flattenSkills(await scanWorkspace(wsLink));
  const alpha = skills.find((s) => s.name === "alpha")!;
  // Link target now spelled via wsLink, workspace arg via the real ws — different prefixes.
  await installSkill(alpha, target, wsLink, { stamp: "T" });
  const u = await uninstallSkill("alpha", target, ws); // note: real ws, not wsLink
  expect(u.action).toBe("unlinked"); // realpath makes containment hold despite the mismatch
});

test("install symlinks, uninstall removes only our links", async () => {
  const skills = flattenSkills(await scanWorkspace(ws));
  const alpha = skills.find((s) => s.name === "alpha")!;
  const r = await installSkill(alpha, target, ws, { stamp: "T" });
  expect(r.action).toBe("linked");

  const st = await lstat(join(target.skillsDir, "alpha"));
  expect(st.isSymbolicLink()).toBe(true);

  const again = await installSkill(alpha, target, ws, { stamp: "T" });
  expect(again.action).toBe("already-linked");
  expect((await lstat(join(target.skillsDir, "alpha"))).ino).toBe(st.ino); // not recreated

  const u = await uninstallSkill("alpha", target, ws);
  expect(u.action).toBe("unlinked");
  await expect(lstat(join(target.skillsDir, "alpha"))).rejects.toThrow();
});

test("foreign link is never touched by uninstall", async () => {
  await mkdir(target.skillsDir, { recursive: true });
  await symlink("/etc/hosts", join(target.skillsDir, "alpha")); // points outside workspace
  const u = await uninstallSkill("alpha", target, ws);
  expect(u.action).toBe("skipped");
  // still there
  expect(await readlink(join(target.skillsDir, "alpha"))).toBe("/etc/hosts");
});

test("real dir not clobbered without force; backed up with force", async () => {
  const skills = flattenSkills(await scanWorkspace(ws));
  const alpha = skills.find((s) => s.name === "alpha")!;
  await mkdir(join(target.skillsDir, "alpha"), { recursive: true });
  await writeFile(join(target.skillsDir, "alpha", "keep.txt"), "mine");

  const noForce = await installSkill(alpha, target, ws, { stamp: "T" });
  expect(noForce.action).toBe("skipped");

  const forced = await installSkill(alpha, target, ws, { stamp: "T", force: true });
  expect(forced.action).toBe("backed-up-and-linked");
  // backup preserved
  const bak = await lstat(join(target.skillsDir, "alpha.bak-T"));
  expect(bak.isDirectory()).toBe(true);
  // new one is a link
  expect((await lstat(join(target.skillsDir, "alpha"))).isSymbolicLink()).toBe(true);
});

test("install refuses to clobber a same-name link from a different skill (src-mismatch guard)", async () => {
  const skills = flattenSkills(await scanWorkspace(ws));
  const alpha = skills.find((s) => s.name === "alpha")!;
  // A second "alpha" from a different source (reuse repoB's dir as a stand-in src).
  const otherAlpha = { name: "alpha", repo: "repoB", src: join(ws, "repoB", "repoB") };

  const first = await installSkill(alpha, target, ws, { stamp: "T" });
  expect(first.action).toBe("linked");

  const second = await installSkill(otherAlpha, target, ws, { stamp: "T" });
  expect(second.action).toBe("skipped");
  expect(second.reason).toContain("occupied");

  // original link untouched → still points at repoA's alpha
  expect(await readlink(join(target.skillsDir, "alpha"))).toBe(alpha.src);
});

test("uninstall with expectSrc refuses to remove a different skill's same-name link", async () => {
  const skills = flattenSkills(await scanWorkspace(ws));
  const alpha = skills.find((s) => s.name === "alpha")!;
  await installSkill(alpha, target, ws, { stamp: "T" });

  // Try to remove "alpha" but claim it should be repoB's dir — mismatch → skip.
  const wrong = await uninstallSkill("alpha", target, ws, { expectSrc: join(ws, "repoB", "repoB") });
  expect(wrong.action).toBe("skipped");
  expect(await readlink(join(target.skillsDir, "alpha"))).toBe(alpha.src);

  // Correct expectSrc → removes it.
  const right = await uninstallSkill("alpha", target, ws, { expectSrc: alpha.src });
  expect(right.action).toBe("unlinked");
});

test("status classifies, prune removes only our broken links", async () => {
  const skills = flattenSkills(await scanWorkspace(ws));
  const alpha = skills.find((s) => s.name === "alpha")!;
  const beta = skills.find((s) => s.name === "beta")!;
  await installSkill(alpha, target, ws, { stamp: "T" });
  await installSkill(beta, target, ws, { stamp: "T" });
  // break beta's source
  await rm(join(ws, "repoA", "skills", "beta"), { recursive: true });
  // add a foreign link
  await symlink("/etc/hosts", join(target.skillsDir, "ext"));

  const st = await statusOfTarget(target, ws);
  const byName = Object.fromEntries(st.map((l) => [l.name, l.health.kind]));
  expect(byName.alpha).toBe("ok");
  expect(byName.beta).toBe("broken");
  expect(byName.ext).toBe("foreign-link");

  const pruned = await pruneTarget(target, ws);
  expect(pruned).toEqual(["beta"]); // only our broken link; ext untouched
  expect(await readlink(join(target.skillsDir, "ext"))).toBe("/etc/hosts");
});
