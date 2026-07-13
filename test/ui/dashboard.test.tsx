import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { Dashboard, gitBadge, type DashboardApi } from "../../src/ui/Dashboard.tsx";
import type { GitState, Repo } from "../../src/core/types.ts";

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
};

test("dashboard lists each repo with its skill count", () => {
  const repos = [repo("slides-grab", 5), repo("render-watch", 1), repo("empty", 0)];
  const { lastFrame } = render(<Dashboard repos={repos} api={api} onOpen={() => {}} />);
  const f = lastFrame() ?? "";
  expect(f).toContain("skillbox — repos");
  expect(f).toContain("slides-grab");
  expect(f).toContain("5 skills");
  expect(f).toContain("render-watch");
  expect(f).toContain("empty");
});
