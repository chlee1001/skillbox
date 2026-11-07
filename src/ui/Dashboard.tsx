// Screen A — the dashboard: repos with skill counts and git state. git state is filled
// asynchronously (no `git fetch` — ahead/behind is best-effort vs the local ref; P3).
// Keys come from keymap(); disk/git work goes through the injected api.

import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { GitState, Repo } from "../core/types.ts";
import type { VersionRow } from "../core/versions.ts";
import { keymap, type Key } from "./keymap.ts";

export interface DashboardApi {
  gitStateFor(repo: Repo): Promise<GitState>;
  pull(repo: Repo): Promise<{ ok: boolean }>;
  versionsOf(repos: Repo[], fetch: boolean): Promise<VersionRow[]>;
}

export function versionBadge(row?: VersionRow): string {
  if (!row) return "…";
  switch (row.status) {
    case "CURRENT": return "✓ current";
    case "BEHIND": return `↓ ${row.behind ?? 0} behind`;
    case "LOCAL": return "local";
    case "NO-UPSTREAM": return "no upstream";
    case "FETCH-FAILED": return "fetch failed";
  }
}

export function repoLine(repo: Repo, alwaysCount: number, gitState: GitState, versionRow?: VersionRow): string {
  const category = repo.category ? `  ${repo.category}` : "";
  return `${repo.name}  [${repo.class ?? "?"}]${category}  ${repo.skills.length} skills (${alwaysCount} always)  ${gitBadge(gitState)}  ${versionBadge(versionRow)}`;
}

// Pure: a compact one-line badge for a git state (also the unit-test surface).
export function gitBadge(g: GitState): string {
  switch (g.kind) {
    case "clean":
      return "✔ up-to-date";
    case "behind":
      return `↓ ${g.by} behind`;
    case "ahead":
      return `↑ ${g.by} ahead`;
    case "diverged":
      return `↕ ${g.ahead}/${g.behind}`;
    case "dirty":
      return "● uncommitted";
    case "not-git":
      return "(not git)";
    case "unknown":
      return "…";
  }
}

export function Dashboard({
  repos,
  always,
  api,
  onOpen,
  onHealth,
}: {
  repos: Repo[];
  always: Set<string>;
  api: DashboardApi;
  onOpen: (repo: Repo) => void;
  onHealth?: () => void;
}) {
  const [focus, setFocus] = useState(0);
  const [states, setStates] = useState<Record<string, GitState>>({});
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [versionError, setVersionError] = useState(false);
  const request = useRef(0);

  // Fill git state per repo asynchronously; no blocking, no fetch.
  useEffect(() => {
    let live = true;
    (async () => {
      for (const r of repos) {
        const g = await api.gitStateFor(r);
        if (!live) return;
        setStates((prev) => ({ ...prev, [r.path]: g }));
      }
    })();
    return () => {
      live = false;
    };
  }, [repos, api]);

  useEffect(() => {
    const id = ++request.current;
    setVersions(null);
    setFetching(false);
    setVersionError(false);
    void api.versionsOf(repos, false).then((rows) => {
      if (request.current === id) setVersions(rows);
    }).catch(() => {
      if (request.current === id) setVersionError(true);
    });
    return () => { request.current++; };
  }, [repos, api]);

  async function fetchVersions() {
    if (fetching) return;
    const id = ++request.current;
    setFetching(true);
    setVersionError(false);
    try {
      const rows = await api.versionsOf(repos, true);
      if (request.current === id) setVersions(rows);
    } catch {
      if (request.current === id) setVersionError(true);
    } finally {
      if (request.current === id) setFetching(false);
    }
  }

  useInput((input, key) => {
    const intent = keymap({ screen: "dashboard" }, input, key as Key);
    switch (intent.type) {
      case "focusUp":
        setFocus((f) => Math.max(0, f - 1));
        break;
      case "focusDown":
        setFocus((f) => Math.min(repos.length - 1, f + 1));
        break;
      case "openRepo": {
        const r = repos[focus];
        if (r && r.skills.length > 0) onOpen(r);
        break;
      }
      case "pull":
        if (!repos[focus]) break;
        void api.pull(repos[focus]).then(async () => {
          const g = await api.gitStateFor(repos[focus]);
          setStates((prev) => ({ ...prev, [repos[focus].path]: g }));
        });
        break;
      case "fetch":
        void fetchVersions();
        break;
      case "openHealth":
        onHealth?.();
        break;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        skillbox — repos
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {repos.map((r, i) => {
          const g = states[r.path] ?? { kind: "unknown" as const };
          const empty = r.skills.length === 0;
          const version = versions?.find((v) => v.repo === r.name) ??
            (versions ? { repo: r.name, remote: "", status: "NO-UPSTREAM" as const } : undefined);
          return (
            <Text key={r.path} inverse={i === focus} dimColor={empty}>
              {repoLine(r, r.skills.filter((s) => always.has(s.src)).length, g, version)}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter=open u=pull f=fetch r=refresh h=health ↑↓=move q=quit{fetching ? "  fetching…" : versionError ? "  version check failed" : ""}</Text>
      </Box>
    </Box>
  );
}
