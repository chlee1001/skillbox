import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { Dashboard, gitBadge, versionBadge, repoLine, type DashboardApi } from "../../src/ui/Dashboard.tsx";
import type { GitState, Repo } from "../../src/core/types.ts";
import type { VersionRow } from "../../src/core/versions.ts";

test("gitBadge renders each state compactly", () => {
  expect(gitBadge({ kind: "clean" })).toContain("up-to-date");
  expect(gitBadge({ kind: "behind", by: 3 })).toContain("3 behind");
  expect(gitBadge({ kind: "ahead", by: 1 })).toContain("1 ahead");
  expect(gitBadge({ kind: "dirty" })).toContain("uncommitted");
  expect(gitBadge({ kind: "not-git" })).toContain("not git");
});

const repo = (name: string, skills: number, isGit = true): Repo => ({
  name,
  path: `/ws/${name}`,
  isGit,
  skills: Array.from({ length: skills }, (_, i) => ({ name: `${name}-s${i}`, repo: name, src: `/ws/${name}/s${i}` })),
  git: { kind: "unknown" as const },
});

const api: DashboardApi = {
  gitStateFor: async () => ({ kind: "clean" as GitState["kind"] }) as GitState,
  pull: async () => ({ ok: true }),
  versionsOf: async () => [],
};

test("versionBadge renders every version status and unknown", () => {
  const row: VersionRow = { repo: "repo", remote: "origin", status: "CURRENT" };
  expect(versionBadge()).toBe("…");
  expect(versionBadge(row)).toBe("✓ current");
  expect(versionBadge({ ...row, status: "BEHIND", behind: 3 })).toBe("↓ 3 behind");
  expect(versionBadge({ ...row, status: "LOCAL" })).toBe("local");
  expect(versionBadge({ ...row, status: "NO-UPSTREAM" })).toBe("no upstream");
  expect(versionBadge({ ...row, status: "FETCH-FAILED" })).toBe("fetch failed");
});

test("repoLine includes classification, optional category and always count", () => {
  const owned = { ...repo("mine", 2), class: "owned" as const, category: "writing" };
  const external = { ...repo("other", 1), class: "external" as const };
  expect(repoLine(owned, 1, { kind: "clean" }, { repo: "mine", remote: "origin", status: "CURRENT" }))
    .toBe("mine  [owned]  writing  2 skills (1 always)  ✔ up-to-date  ✓ current");
  expect(repoLine(external, 0, { kind: "not-git" }))
    .toBe("other  [external]  1 skills (0 always)  (not git)  …");
});

test("dashboard lists each repo with its skill count", () => {
  const repos = [repo("slides-grab", 5), repo("render-watch", 1), repo("empty", 0)];
  const { lastFrame } = render(<Dashboard repos={repos} always={new Set([repos[0].skills[0].src])} api={api} onOpen={() => {}} />);
  const f = lastFrame() ?? "";
  expect(f).toContain("skillbox — repos");
  expect(f).toContain("slides-grab");
  expect(f).toContain("5 skills");
  expect(f).toContain("1 always");
  expect(f).toContain("f=fetch");
  expect(f).toContain("render-watch");
  expect(f).toContain("empty");
});
