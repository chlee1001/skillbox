// Root Ink component + the `runUI` entry the CLI lazy-imports. P2 scaffold: a title bar,
// workspace path, and quit. Screens B/A/C mount here in later stories.

import { useState, useEffect } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import type { CellState, Config, InstallMatrix, InstalledLink, Repo, Target } from "../core/types.ts";
import { enterAltScreen } from "./altScreen.ts";
import * as actions from "./actions.ts";
import { SkillBrowser, browserApi } from "./SkillBrowser.tsx";
import { Dashboard } from "./Dashboard.tsx";
import { Health, crossScopeDuplicates } from "./Health.tsx";

type View = { kind: "dashboard" } | { kind: "browser"; repo: string } | { kind: "health"; entries: InstalledLink[] };

// Canonical srcs linked (cell state "linked") in any target OTHER than the given key.
// Keyed by src (not name) so a same-name skill from a different repo isn't falsely flagged.
function linkedSrcsElsewhere(matrix: InstallMatrix, exceptKey: string): Set<string> {
  const srcs = new Set<string>();
  for (const row of matrix.rows) {
    for (const c of row.cells) {
      if (c.targetKey !== exceptKey && (c.state as CellState) === "linked") srcs.add(row.skill.src);
    }
  }
  return srcs;
}

function App({ cfg }: { cfg: Config }) {
  const { exit } = useApp();
  const [matrix, setMatrix] = useState<InstallMatrix | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [targets] = useState<Target[]>(() => actions.targetsOf(cfg));
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1); // re-project the grid from disk

  // Global keys — run alongside each screen's own handling. `r` re-syncs the top-level
  // matrix so the grid stays a projection of disk (plan B′) after cross-screen edits.
  useInput((input) => {
    if (input === "q") exit();
    if (input === "r") reload();
  });

  useEffect(() => {
    void actions.loadMatrix(cfg, targets).then(setMatrix);
    void actions.repos(cfg).then(setRepos);
  }, [cfg, targets, reloadKey]);

  if (!matrix || !repos) {
    return (
      <Box paddingX={1}>
        <Text dimColor>scanning {cfg.workspace} …</Text>
      </Box>
    );
  }

  if (view.kind === "browser") {
    if (targets.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color="yellow">No registered targets.</Text>
          <Text dimColor>Run `skillbox target add &lt;alias&gt; &lt;path&gt;` then reopen. q to quit.</Text>
        </Box>
      );
    }
    const rows = matrix.rows.filter((r) => r.skill.repo === view.repo);
    // Reload the matrix on exit so re-entry projects fresh disk state, not a stale cache.
    const back = () => {
      reload();
      setView({ kind: "dashboard" });
    };
    return <SkillBrowser rows={rows} targets={targets} api={browserApi(cfg)} onBack={back} />;
  }

  if (view.kind === "health") {
    const target = targets[0]; // 'h' opens health for the first registered target
    const key = target.alias ?? target.root;
    const dups = crossScopeDuplicates(view.entries, linkedSrcsElsewhere(matrix, key));
    return (
      <Health
        targetKey={key}
        entries={view.entries}
        unmapped={matrix.unmapped.filter((u) => u.targetKey === key)}
        duplicates={dups}
        api={{ prune: () => actions.prune(cfg, target) }}
        onBack={() => setView({ kind: "dashboard" })}
      />
    );
  }

  return (
    <Dashboard
      repos={repos}
      api={{ gitStateFor: actions.gitStateFor, pull: actions.pull }}
      onOpen={(r) => setView({ kind: "browser", repo: r.name })}
      onHealth={() => {
        if (targets.length === 0) return;
        void actions.healthOf(cfg, targets[0]).then((entries) => setView({ kind: "health", entries }));
      }}
    />
  );
}

export async function runUI(): Promise<void> {
  const cfg = await actions.loadCtx();
  const leave = enterAltScreen();
  const app = render(<App cfg={cfg} />);
  await app.waitUntilExit();
  leave();
}
