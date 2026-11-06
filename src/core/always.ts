// Always-on state comes from existing workspace links, not a separate registry.

import { homedir } from "node:os";
import { AGENTS, type AgentProfile } from "./config.ts";
import { statusOfTarget } from "./link.ts";
import type { Target } from "./types.ts";
import { resolveReal } from "./util.ts";

// Codex and GJC (via customDirectories) read ~/.agents/skills; Claude reads
// ~/.claude/skills. Exclude ~/.gjc/agent/skills to avoid duplicate GJC skills.
export async function alwaysTargets(profiles: AgentProfile[] = [AGENTS.claude, AGENTS.codex]): Promise<Target[]> {
  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const p of profiles) {
    const real = await resolveReal(p.userSkills);
    if (seen.has(real)) continue;
    seen.add(real);
    targets.push({ alias: `${p.name}:user`, root: homedir(), skillsDir: p.userSkills });
  }
  return targets;
}

export async function alwaysSrcs(targets: Target[], workspace: string): Promise<Set<string>> {
  const srcs = new Set<string>();
  for (const target of targets) {
    for (const link of await statusOfTarget(target, workspace)) {
      if (link.health.kind === "ok") srcs.add(await resolveReal(link.health.target));
    }
  }
  return srcs;
}

export function gjcMissingDir(configText: string | undefined, dir: string): boolean {
  return configText !== undefined && !configText.includes(dir);
}
