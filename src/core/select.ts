// Pure selection logic: turn (workspace skills, names, --repo, --all) into a concrete
// set to act on, plus the problems that should make the caller refuse. Kept UI-free and
// side-effect-free so it is unit-testable and shared by the CLI and the TUI.

import type { Skill } from "./types.ts";

export interface Selection {
  chosen: Skill[];
  misses: string[]; // names that matched nothing (typos)
  ambiguous: { name: string; repos: string[] }[]; // bare name in >1 repo
  collisions: { name: string; repos: string[] }[]; // chosen set maps 2 repos to one dest
}

//   --all (or --repo with no names): bulk = leaf skills only; umbrella containers are
//     skipped (install them by explicit name) so subs aren't double-registered.
//   named: "repo:skill" is exact; a bare name matching >1 repo is ambiguous (refused).
export function selectSkills(
  all: Skill[],
  names: string[],
  repo?: string,
  wantAll?: boolean,
): Selection {
  const pool = repo ? all.filter((s) => s.repo === repo) : all;
  const misses: string[] = [];
  const ambiguous: { name: string; repos: string[] }[] = [];
  let chosen: Skill[] = [];

  if (wantAll || (repo && names.length === 0)) {
    chosen = pool.filter((s) => !s.isContainer);
  } else if (names.length > 0) {
    for (const n of names) {
      if (n.includes(":")) {
        const [r, s] = n.split(":");
        const m = pool.find((x) => x.repo === r && x.name === s);
        if (m) chosen.push(m);
        else misses.push(n);
      } else {
        const matches = pool.filter((x) => x.name === n);
        if (matches.length === 0) misses.push(n);
        else if (matches.length > 1) ambiguous.push({ name: n, repos: matches.map((m) => m.repo) });
        else chosen.push(matches[0]);
      }
    }
  }

  const byName = new Map<string, Set<string>>();
  for (const s of chosen) {
    if (!byName.has(s.name)) byName.set(s.name, new Set());
    byName.get(s.name)!.add(s.repo);
  }
  const collisions = [...byName]
    .filter(([, repos]) => repos.size > 1)
    .map(([name, repos]) => ({ name, repos: [...repos] }));

  return { chosen, misses, ambiguous, collisions };
}

// Flatten a Selection's problems into human-readable lines (empty = clean).
export function selectionProblems(sel: Selection): string[] {
  return [
    ...sel.misses.map((m) => `not found: ${m}`),
    ...sel.ambiguous.map((a) => `ambiguous "${a.name}" in [${a.repos.join(", ")}] — use repo:skill`),
    ...sel.collisions.map((c) => `name collision "${c.name}" across [${c.repos.join(", ")}] — pick one or use --repo`),
  ];
}
