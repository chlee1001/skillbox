#!/usr/bin/env bun
// Non-interactive CLI. Calls the same headless core as the Ink TUI. Scriptable and testable.
//
//   skillbox list [repo]
//   skillbox install <target> [skill...] [--all] [--copy] [--force] [--repo R]
//   skillbox uninstall <target> [skill...] [--all]
//   skillbox status <target>
//   skillbox prune <target>
//   skillbox update [repo|--all]
//   skillbox add <git-url>
//   skillbox target add|list|rm ...
//   skillbox ui                      (Ink TUI)

import { loadConfig, resolveTarget, addTarget, removeTarget, listTargets } from "./core/config.ts";
import { scanWorkspace, flattenSkills } from "./core/scan.ts";
import { installSkill, uninstallSkill, statusOfTarget, pruneTarget } from "./core/link.ts";
import { gitPull, gitClone } from "./core/git.ts";
import { selectSkills, selectionProblems } from "./core/select.ts";
import { classifyRepos, reposToPull } from "./core/classify.ts";
import { basename, join } from "node:path";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseFlags(args: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") {
      opts.repo = args[++i];
    } else if (a === "--user") {
      positional.push(a); // a target keyword, not a flag — resolveTarget handles "--user"
    } else if (a.startsWith("--")) {
      flags.add(a.slice(2));
    } else {
      positional.push(a);
    }
  }
  return { flags, opts, positional };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = await loadConfig();
  const { flags, opts, positional } = parseFlags(rest);
  // Which agent's skills dir to target: --codex (.agents/skills) or --gajae (.gjc)
  // else the default claude (.claude/skills).
  const agent = flags.has("codex") ? "codex" : flags.has("gajae") ? "gajae" : "claude";

  switch (cmd) {
    case "list": {
      const repos = await scanWorkspace(cfg.workspace, { ignore: cfg.ignore });
      await classifyRepos(repos, cfg.workspace, cfg.ownedOwners);
      const classFilter = flags.has("owned") ? "owned" : flags.has("external") ? "external" : undefined;
      const filter = positional[0];
      for (const r of repos) {
        if (filter && r.name !== filter) continue;
        if (classFilter && r.class !== classFilter) continue;
        const unbacked = r.class === "owned" && !r.remote ? " UNBACKED" : "";
        console.log(`\n${r.name}  [${r.class}${unbacked}]  (${r.skills.length} skills)`);
        for (const s of r.skills) {
          const tag = s.isContainer ? " [umbrella]" : "";
          const d = s.description ? `  — ${s.description.slice(0, 70)}` : "";
          console.log(`  ${s.name}${tag}${d}`);
        }
      }
      break;
    }

    case "install": {
      const [targetSpec, ...names] = positional;
      if (!targetSpec) return fail("install needs a <target>");
      const target = resolveTarget(targetSpec, cfg, agent);
      const all = flattenSkills(await scanWorkspace(cfg.workspace, { ignore: cfg.ignore }));
      const sel = selectSkills(all, names, opts.repo, flags.has("all"));

      // Refuse fast on any ambiguity rather than installing the wrong thing.
      const problems = selectionProblems(sel);
      if (problems.length) {
        for (const p of problems) console.error(`  ${p}`);
        return fail("refused — resolve the above and retry");
      }
      const chosen = sel.chosen;
      if (chosen.length === 0) return fail("no skills selected (give names, --repo R, or --all)");
      const s = stamp();
      for (const sk of chosen) {
        const r = await installSkill(sk, target, cfg.workspace, {
          copy: flags.has("copy"),
          force: flags.has("force"),
          stamp: s,
        });
        console.log(`  ${r.action.padEnd(22)} ${sk.name}${r.reason ? `  (${r.reason})` : ""}`);
      }
      console.log(`Done -> ${target.skillsDir}`);
      break;
    }

    case "uninstall": {
      const [targetSpec, ...names] = positional;
      if (!targetSpec) return fail("uninstall needs a <target>");
      const target = resolveTarget(targetSpec, cfg, agent);
      let toRemove = names;
      if (flags.has("all")) {
        // remove every one of OUR links currently in the target
        const links = await statusOfTarget(target, cfg.workspace);
        toRemove = links.filter((l) => l.health.kind === "ok" || l.health.kind === "broken").map((l) => l.name);
      }
      if (toRemove.length === 0) return fail("no skills to remove (give names or --all)");
      for (const n of toRemove) {
        if (n.includes("/") || n === "..") {
          console.log(`  skipped    ${n}  (invalid skill name)`);
          continue;
        }
        const r = await uninstallSkill(n, target, cfg.workspace);
        console.log(`  ${r.action.padEnd(10)} ${n}${r.reason ? `  (${r.reason})` : ""}`);
      }
      break;
    }

    case "status": {
      const [targetSpec] = positional;
      if (!targetSpec) return fail("status needs a <target>");
      const target = resolveTarget(targetSpec, cfg, agent);
      const links = await statusOfTarget(target, cfg.workspace);
      if (links.length === 0) {
        console.log("(no skills dir or empty)");
        break;
      }
      for (const l of links) {
        const h = l.health;
        const mark =
          h.kind === "ok" ? "ok    " :
          h.kind === "broken" ? "BROKEN" :
          h.kind === "foreign-link" ? "extern" : "dir   ";
        const tgt = "target" in h ? `-> ${h.target}` : "(real dir, untouched)";
        console.log(`  ${mark}  ${l.name.padEnd(24)} ${tgt}`);
      }
      break;
    }

    case "prune": {
      const [targetSpec] = positional;
      if (!targetSpec) return fail("prune needs a <target>");
      const target = resolveTarget(targetSpec, cfg, agent);
      const pruned = await pruneTarget(target, cfg.workspace);
      console.log(pruned.length ? `pruned: ${pruned.join(", ")}` : "nothing to prune");
      break;
    }

    case "update": {
      const repos = await scanWorkspace(cfg.workspace, { includeEmpty: true, ignore: cfg.ignore });
      await classifyRepos(repos, cfg.workspace, cfg.ownedOwners);
      // Bulk (bare / --all / --external) pulls external clones only; an explicit repo
      // name is a deliberate act and pulls regardless of class.
      const name = flags.has("all") || flags.has("external") ? undefined : positional[0];
      const { pull, skipped } = reposToPull(repos, name);
      if (name && pull.length === 0) return fail(`no git repo named ${name}`);
      for (const r of skipped) {
        console.log(`  skipped  ${r.name}  (owned — pull explicitly: skillbox update ${r.name})`);
      }
      for (const r of pull) {
        const res = await gitPull(r.path);
        console.log(`  ${res.ok ? "pulled " : "FAILED "} ${r.name}  ${res.out.split("\n")[0] ?? ""}`);
      }
      break;
    }

    case "add": {
      const url = positional[0];
      if (!url) return fail("add needs a <git-url>");
      const name = basename(url).replace(/\.git$/, "");
      const dest = join(cfg.workspace, name);
      const res = await gitClone(url, dest);
      console.log(res.ok ? `cloned ${name} -> ${dest}` : `FAILED: ${res.out}`);
      break;
    }

    case "target": {
      const [sub, alias, path] = positional;
      if (sub === "add") {
        if (!alias || !path) return fail("target add <alias> <path>");
        try {
          await addTarget(alias, path);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
        console.log(`registered ${alias} -> ${path}`);
      } else if (sub === "rm") {
        if (!alias) return fail("target rm <alias>");
        console.log((await removeTarget(alias)) ? `removed ${alias}` : `no such target: ${alias}`);
      } else {
        // list (default)
        const fresh = await loadConfig();
        const ts = listTargets(fresh);
        if (ts.length === 0) console.log("(no registered targets — `target add <alias> <path>`)");
        for (const t of ts) console.log(`  ${t.alias}  -> ${t.root}`);
      }
      break;
    }

    case "ui": {
      // Lazy import so the headless commands never evaluate React at runtime.
      const { runUI } = await import("./ui/App.tsx");
      await runUI();
      break;
    }

    default:
      console.log(
        `skillbox — manage cloned skill repos + project symlinks\n\n` +
          `  list [repo]                        discovered skills\n` +
          `  install <target> [skill...] [--all|--repo R] [--copy] [--force]\n` +
          `  uninstall <target> [skill...] [--all]\n` +
          `  status <target>                    what is linked (health)\n` +
          `  prune <target>                     remove our broken links\n` +
          `  update [repo|--all]                git pull\n` +
          `  add <git-url>                      clone into workspace\n` +
          `  target add|list|rm <alias> [path]  manage target aliases\n` +
          `  ui                                 interactive TUI\n\n` +
          `  <target> = path | config alias | --user\n` +
          `  --codex  target Codex skills dir (.agents/skills)   [default: claude .claude/skills]\n` +
          `  --gajae  target gajae-code skills dir (.gjc/skills, ~/.gjc/agent/skills)\n` +
          `           gjc scanning is OFF by default — enable: gjc config set skills.enabled true\n` +
          `  workspace: ${cfg.workspace}`,
      );
  }
}

function fail(msg: string) {
  console.error(`skillbox: ${msg}`);
  process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
