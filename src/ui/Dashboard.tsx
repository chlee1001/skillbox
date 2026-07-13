// Screen A — the dashboard: repos with skill counts and git state. git state is filled
// asynchronously (no `git fetch` — ahead/behind is best-effort vs the local ref; P3).
// Keys come from keymap(); disk/git work goes through the injected api.

import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { GitState, Repo } from "../core/types.ts";
import { keymap, type Key } from "./keymap.ts";

export interface DashboardApi {
  gitStateFor(repo: Repo): Promise<GitState>;
  pull(repo: Repo): Promise<{ ok: boolean }>;
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
  api,
  onOpen,
  onHealth,
}: {
  repos: Repo[];
  api: DashboardApi;
  onOpen: (repo: Repo) => void;
  onHealth?: () => void;
}) {
  const [focus, setFocus] = useState(0);
  const [states, setStates] = useState<Record<string, GitState>>({});

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
        void api.pull(repos[focus]).then(async () => {
          const g = await api.gitStateFor(repos[focus]);
          setStates((prev) => ({ ...prev, [repos[focus].path]: g }));
        });
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
          return (
            <Text key={r.path} inverse={i === focus} dimColor={empty}>
              {r.name.padEnd(24)} {String(r.skills.length).padStart(2)} skills   {gitBadge(g)}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter=open u=pull r=refresh h=health ↑↓=move q=quit</Text>
      </Box>
    </Box>
  );
}
