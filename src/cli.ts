#!/usr/bin/env bun
// Non-interactive CLI. Calls the same headless core as the Ink TUI. Scriptable and testable.
//
//   skillbox list [repo] [--archived|--owned|--external] [--category <name>] [--json]
//   skillbox category [<name> [repo...]] | --off <repo...>
//   skillbox path <skill|repo:skill>        (print the SKILL.md path; for user-invoked loading)
//   skillbox always [--off] [skill...] [--json]  (manage user-scope links)
//   skillbox outdated [--offline] [--json]       (compare commits with upstream)
//   skillbox install <target> [skill...] [--all] [--copy] [--force] [--repo R]
//   skillbox uninstall <target> [skill...] [--all]
//   skillbox status <target>
//   skillbox prune <target>
//   skillbox update [repo|--all|--external]   (bulk pulls external clones only)
//   skillbox doctor [--fetch] [--json]        (fleet health; exit 0 HEALTHY / 1 WARN)
//   skillbox inventory [--write]              (fleet table; --write emits INVENTORY.md)
//   skillbox drift                            (owned pins vs external HEADs; report only)
//   skillbox add <git-url>
//   skillbox remove <repo> [--force]
//   skillbox target add|list|rm ...
//   skillbox ui                      (Ink TUI)

import { loadConfig, resolveTarget, addTarget, removeTarget, listTargets, AGENTS } from "./core/config.ts";
import { scanWorkspace, flattenSkills } from "./core/scan.ts";
import { archivedMatches, findArchived } from "./core/archived.ts";
import { appendRemoved, readRemoved } from "./core/removed.ts";
import { installSkill, uninstallSkill, statusOfTarget, pruneTarget } from "./core/link.ts";
import { git, gitPull, gitClone, revParse } from "./core/git.ts";
import { alwaysTargets, alwaysSrcs, gjcMissingDir } from "./core/always.ts";
import { collectVersions } from "./core/versions.ts";
import { resolveReal } from "./core/util.ts";
import { selectSkills, selectionProblems } from "./core/select.ts";
import { classifyRepos, reposToPull } from "./core/classify.ts";
import { applyCategories, readCategories, writeCategories } from "./core/category.ts";
import { runDoctor } from "./core/doctor.ts";
import { buildInventory, renderInventory } from "./core/inventory.ts";
import { collectDrift } from "./core/drift.ts";
import { printJson, repoEntries, skillRef, type AlwaysChange } from "./core/report.ts";
import type { Repo, Skill } from "./core/types.ts";
import { basename, join } from "node:path";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

async function gjcWarning(): Promise<string | undefined> {
  const config = join(homedir(), ".gjc", "agent", "config.yml");
  const dir = join(homedir(), ".agents", "skills");
  const text = await readFile(config, "utf8").catch(() => undefined);
  return gjcMissingDir(text, dir) ? `add ${dir} to skills.customDirectories in ${config}` : undefined;
}

// Realpath'd srcs of the skills a user-scope link points at, as a sync predicate.
async function alwaysPredicate(repos: Repo[], workspace: string): Promise<(skill: Skill) => boolean> {
  const srcs = await alwaysSrcs(await alwaysTargets(), workspace);
  const on = new Set<string>();
  for (const skill of flattenSkills(repos)) if (srcs.has(await resolveReal(skill.src))) on.add(skill.src);
  return (skill) => on.has(skill.src);
}

const JSON_COMMANDS = new Set(["list", "always", "outdated", "doctor"]);

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseFlags(args: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo" || a === "--category") {
      opts[a.slice(2)] = args[++i];
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

async function hintArchived(workspace: string, ignore: string[], misses: string[], repo?: string) {
  if (!misses.length) return;
  const repos = await scanWorkspace(workspace, { ignore, includeEmpty: true });
  const entries = await findArchived(repos);
  const live = new Set((await scanWorkspace(workspace, { includeEmpty: true })).map((r) => r.name));
  const removed = (await readRemoved(workspace)).filter((entry) => !live.has(entry.name));
  for (const name of misses) {
    const parts = name.split(":");
    const wantedRepo = parts.length > 1 ? parts[0] : repo;
    const wantedName = parts.length > 1 ? parts[1] : name;
    for (const entry of archivedMatches(entries, wantedName)) {
      if (wantedRepo && entry.repo !== wantedRepo) continue;
      console.error(`  "${name}" is archived: ${entry.repo}/archive/${entry.entry} (archived ${entry.archived ?? "—"}) — restore it first`);
    }
    for (const entry of removed) {
      if (wantedRepo && entry.name !== wantedRepo) continue;
      if (entry.name === wantedName || entry.skills.includes(wantedName)) {
        console.error(`  "${name}" was removed: ${entry.name} (removed ${entry.removed}) — restore with: skillbox add ${entry.url}`);
      }
    }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = await loadConfig();
  const { flags, opts, positional } = parseFlags(rest);
  if (rest.includes("--category") && !opts.category) return fail("--category needs a name");
  const json = flags.has("json");
  if (json && !JSON_COMMANDS.has(cmd)) return fail(`--json is supported by ${[...JSON_COMMANDS].join(", ")}`);
  if (json && flags.has("archived")) return fail("--json does not support --archived");
  // Which agent's skills dir to target: --codex (.agents/skills) or --gajae (.gjc)
  // else the default claude (.claude/skills).
  const agent = flags.has("codex") ? "codex" : flags.has("gajae") ? "gajae" : "claude";

  switch (cmd) {
    case "category":
    case "list": {
      const archived = cmd === "list" && flags.has("archived");
      const repos = await scanWorkspace(cfg.workspace, { ignore: cfg.ignore, includeEmpty: archived });
      if (archived) {
        const entries = await findArchived(repos.filter((repo) => !positional[0] || repo.name === positional[0]));
        const live = new Set((await scanWorkspace(cfg.workspace, { includeEmpty: true })).map((repo) => repo.name));
        const removed = (await readRemoved(cfg.workspace)).filter((entry) => !live.has(entry.name) && (!positional[0] || entry.name === positional[0]));
        const combined = [
          ...entries.map((entry) => ({ date: entry.archived ?? "9999", entry, kind: "archived" as const })),
          ...removed.map((entry) => ({ date: entry.removed, entry, kind: "removed" as const })),
        ].sort((a, b) => b.date.localeCompare(a.date));
        if (!combined.length) {
          console.log("archived\n  (none)");
          break;
        }
        console.log(`archived (${combined.length}, newest first)`);
        const wrap = (names: string[], indent: string, width = 100) => {
          const lines: string[] = [];
          let line = "";
          for (const n of names) {
            const next = line ? `${line}, ${n}` : n;
            if (line && indent.length + next.length > width) {
              lines.push(line + ",");
              line = n;
            } else line = next;
          }
          if (line) lines.push(line);
          return lines.join(`\n${indent}`);
        };
        const pad = "             ";
        for (const item of combined) {
          if (item.kind === "archived") {
            const e = item.entry;
            console.log(`\n  ${e.entry}  ·  archived in ${e.repo}/archive/`);
            console.log(`    dates    ${e.added ?? "—"} → ${e.archived ?? "—"}${e.uncommitted ? "  (uncommitted)" : ""}`);
            console.log(`    skills   ${wrap(e.skills, pad)}  [${e.skills.length}]`);
            console.log(`    restore  git mv archive/${e.entry} ${e.entry}   (inside ${e.repo})`);
          } else {
            const e = item.entry;
            console.log(`\n  ${e.name}  ·  removed external repo`);
            console.log(`    dates    ${e.added} → ${e.removed}`);
            console.log(`    skills   ${wrap(e.skills, pad)}  [${e.skills.length}]`);
            console.log(`    restore  skillbox add ${e.url}`);
          }
        }
        break;
      }
      if (cmd === "category" && (flags.has("off") || positional.length !== 1)) {
        const categories = await readCategories(cfg.workspace);
        const names = new Set(repos.map((r) => r.name));
        if (flags.has("off")) {
          if (!positional.length) return fail("category --off needs at least one repo");
          let changed = false;
          const messages: string[] = [];
          for (const name of positional) {
            if (names.has(name) && categories.delete(name)) {
              changed = true;
              messages.push(`  ${name} -> (no category)`);
            } else messages.push(`  ${name} (no category)`);
          }
          if (changed) await writeCategories(cfg.workspace, categories);
          for (const message of messages) console.log(message);
        } else if (positional.length > 1) {
          const [rawCategory, ...repoNames] = positional;
          const category = rawCategory.trim();
          if (!category || /[#\r\n]/.test(category)) return fail("category name must be non-empty and cannot contain # or a newline");
          const unknown = repoNames.filter((name) => !names.has(name));
          if (unknown.length) {
            const swapped = names.has(category) ? ` — the category comes first: skillbox category <name> <repo...>` : "";
            return fail(`unknown repos: ${unknown.join(", ")}${swapped}`);
          }
          if (repoNames.some((name) => /[\s#]/.test(name))) return fail("repo names cannot contain whitespace or # in the category manifest");
          for (const name of repoNames) categories.set(name, category);
          await writeCategories(cfg.workspace, categories);
          for (const name of repoNames) console.log(`  ${name} -> ${category}`);
        } else {
          const groups = new Map<string, typeof repos>();
          for (const repo of repos) {
            const category = categories.get(repo.name);
            if (category) groups.set(category, [...(groups.get(category) ?? []), repo]);
          }
          for (const [category, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
            console.log(category);
            for (const repo of group) console.log(`  ${repo.name}  (${repo.skills.length} skills)`);
          }
          console.log("(no category)");
          for (const repo of repos.filter((r) => !categories.has(r.name))) {
            console.log(`  ${repo.name}  (${repo.skills.length} skills)`);
          }
          for (const name of categories.keys()) {
            if (!names.has(name)) console.log(`  WARN category entry for unknown repo: ${name}`);
          }
        }
        break;
      }
      await classifyRepos(repos, cfg.workspace, cfg.ownedOwners);
      await applyCategories(repos, cfg.workspace);
      const isAlways = await alwaysPredicate(repos, cfg.workspace);
      const classFilter = flags.has("owned") ? "owned" : flags.has("external") ? "external" : undefined;
      const filter = cmd === "list" ? positional[0] : undefined;
      const categoryFilter = cmd === "category" ? positional[0] : opts.category;
      const shown = repos.filter((r) =>
        (!filter || r.name === filter) &&
        (!classFilter || r.class === classFilter) &&
        (categoryFilter === undefined || r.category === categoryFilter));
      if (json) {
        printJson({ workspace: cfg.workspace, repos: repoEntries(shown, isAlways) });
        break;
      }
      for (const r of shown) {
        const unbacked = r.class === "owned" && !r.remote ? " UNBACKED" : "";
        console.log(`\n${r.name}  [${r.class}${unbacked}${r.remote ? " " + r.remote : ""}]${r.category ? ` {${r.category}}` : ""}  (${r.skills.length} skills)`);
        for (const s of r.skills) {
          const tag = s.isContainer ? " [umbrella]" : "";
          const d = s.description ? `  — ${s.description.slice(0, 70)}` : "";
          console.log(`  ${s.name}${tag}${isAlways(s) ? " [always]" : ""}${d}`);
        }
      }
      break;
    }

    case "path": {
      const names = positional;
      if (names.length !== 1) return fail("path needs exactly one <skill|repo:skill>");
      const all = flattenSkills(await scanWorkspace(cfg.workspace, { ignore: cfg.ignore }));
      const inRepo = all.filter((s) => s.repo === names[0]);
      if (inRepo.length === 1 && !all.some((s) => s.name === names[0])) {
        console.error(`  repo "${names[0]}" has one skill: ${inRepo[0].name}`);
        console.log(join(inRepo[0].src, "SKILL.md"));
        break;
      }
      if (inRepo.length > 1 && !all.some((s) => s.name === names[0])) {
        console.error(`  "${names[0]}" is a repo — pick the skill that fits the request:`);
        for (const s of inRepo) {
          const rel = s.src.slice(s.src.lastIndexOf(`/${s.repo}/`) + s.repo.length + 2);
          console.error(`  ${s.repo}:${rel}  — ${s.description ?? ""}`.slice(0, 160));
        }
        return fail("refused — rerun with one of the above");
      }
      const sel = selectSkills(all, names);
      const problems = selectionProblems(sel);
      if (problems.length) {
        await hintArchived(cfg.workspace, cfg.ignore, sel.misses);
        for (const p of problems) console.error(`  ${p}`);
        return fail("refused — resolve the above and retry");
      }
      console.log(join(sel.chosen[0].src, "SKILL.md"));
      break;
    }

    case "always": {
      const targets = await alwaysTargets();
      const repos = await scanWorkspace(cfg.workspace, { ignore: cfg.ignore });
      const all = flattenSkills(repos);
      const refOf = (sk: Skill) => skillRef(sk, repos.find((r) => r.name === sk.repo)!);
      if (positional.length === 0) {
        if (flags.has("off")) return fail("always --off needs at least one skill");
        if (json) {
          const out = [];
          for (const target of targets) {
            const srcs = await alwaysSrcs([target], cfg.workspace);
            const skills = [];
            for (const sk of all) if (srcs.has(await resolveReal(sk.src))) skills.push({ name: sk.name, repo: sk.repo, ref: refOf(sk) });
            out.push({ target: target.skillsDir, skills });
          }
          printJson({ targets: out, warning: (await gjcWarning()) ?? null });
          break;
        }
        for (const target of targets) {
          console.log(target.skillsDir);
          const srcs = await alwaysSrcs([target], cfg.workspace);
          for (const sk of all) {
            if (srcs.has(await resolveReal(sk.src))) console.log(`  ${sk.name}  (${sk.repo})`);
          }
        }
      } else {
        const sel = selectSkills(all, positional);
        const problems = selectionProblems(sel);
        if (problems.length) {
          await hintArchived(cfg.workspace, cfg.ignore, sel.misses);
          for (const p of problems) console.error(`  ${p}`);
          return fail("refused — resolve the above and retry");
        }
        if (sel.chosen.length === 0) return fail("no skills selected");
        const s = stamp();
        const changes: AlwaysChange[] = [];
        for (const target of targets) {
          if (!json) console.log(target.skillsDir);
          for (const sk of sel.chosen) {
            const r = flags.has("off")
              ? await uninstallSkill(sk.name, target, cfg.workspace, { expectSrc: sk.src })
              : await installSkill(sk, target, cfg.workspace, { force: flags.has("force"), stamp: s });
            changes.push({ target: target.skillsDir, skill: sk.name, ref: refOf(sk), action: r.action, ...(r.reason ? { reason: r.reason } : {}) });
            if (!json) console.log(`  ${r.action.padEnd(22)} ${sk.name}${r.reason ? `  (${r.reason})` : ""}`);
          }
        }
        if (json) {
          printJson({ changes, warning: (await gjcWarning()) ?? null });
          break;
        }
      }
      const warning = await gjcWarning();
      if (warning) console.log(`  WARN ${warning}`);
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
        await hintArchived(cfg.workspace, cfg.ignore, sel.misses, opts.repo);
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

    case "outdated": {
      const repos = await scanWorkspace(cfg.workspace, { includeEmpty: true, ignore: cfg.ignore });
      await classifyRepos(repos, cfg.workspace, cfg.ownedOwners);
      const rows = await collectVersions(repos, { fetch: !flags.has("offline") });
      if (rows.some((r) => r.status === "BEHIND")) process.exitCode = 1;
      if (json) {
        printJson({ fetched: !flags.has("offline"), repos: rows });
        break;
      }
      for (const r of rows) {
        const head = r.head ?? "?";
        const version = r.head && r.head === r.latest ? head : `${head} -> ${r.latest ?? "?"}`;
        console.log(`  ${r.status.padEnd(12)} ${r.repo.padEnd(22)} ${version}${r.behind ? `  (+${r.behind})` : ""}  ${r.class ?? "?"}${r.note ? `  (${r.note})` : ""}`);
      }
      if (rows.some((r) => r.status === "BEHIND")) console.log("  external: skillbox update; owned: skillbox update <repo>");
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
        const old = (await revParse(r.path, "HEAD"))?.slice(0, 7) ?? "?";
        const res = await gitPull(r.path);
        const next = (await revParse(r.path, "HEAD"))?.slice(0, 7) ?? "?";
        if (!res.ok) console.log(`  FAILED   ${r.name}  ${res.out.split("\n")[0] ?? ""}`);
        else if (old === next) console.log(`  current  ${r.name}  ${old}`);
        else console.log(`  updated  ${r.name}  ${old} -> ${next}`);
      }
      break;
    }

    case "doctor": {
      const repos = await scanWorkspace(cfg.workspace, { includeEmpty: true, ignore: cfg.ignore });
      await classifyRepos(repos, cfg.workspace, cfg.ownedOwners);
      // Everywhere we may have planted links: registered aliases + every agent's user scope.
      const targets = [
        ...listTargets(cfg),
        ...Object.keys(AGENTS).map((a) => resolveTarget("--user", cfg, a)),
      ];
      const report = await runDoctor(repos, targets, cfg.workspace, { fetch: flags.has("fetch") });
      process.exitCode = report.verdict === "HEALTHY" ? 0 : 1;
      if (json) {
        printJson({ fetched: flags.has("fetch"), ...report });
        break;
      }
      for (const f of report.findings) {
        console.log(`  WARN ${f.check.padEnd(15)} ${f.subject}: ${f.detail}`);
      }
      if (report.findings.length) console.log("");
      console.log(`verdict: ${report.verdict}${flags.has("fetch") ? "" : "  (local-only; --fetch probes upstreams)"}`);
      break;
    }

    case "inventory": {
      const repos = await scanWorkspace(cfg.workspace, { ignore: cfg.ignore });
      await classifyRepos(repos, cfg.workspace, cfg.ownedOwners);
      const targets = [
        ...listTargets(cfg),
        ...Object.keys(AGENTS).map((a) => resolveTarget("--user", cfg, a)),
      ];
      const rows = await buildInventory(repos, targets, cfg.workspace);
      const md = renderInventory(rows, { date: new Date().toISOString().slice(0, 10), workspace: cfg.workspace });
      if (flags.has("write")) {
        const out = join(cfg.workspace, "INVENTORY.md");
        await writeFile(out, md);
        console.log(`wrote ${out}\n`);
      }
      console.log(md);
      break;
    }

    case "drift": {
      const repos = await scanWorkspace(cfg.workspace, { includeEmpty: true, ignore: cfg.ignore });
      await classifyRepos(repos, cfg.workspace, cfg.ownedOwners);
      const rows = await collectDrift(repos);
      if (rows.length === 0) {
        console.log("no owned repo declares an upstreams.json — nothing to check");
        break;
      }
      for (const r of rows) {
        const extra =
          r.status === "STALE" ? `  (+${r.behind} commits since pin — run the owner's drift-check, then re-pin)` :
          r.status === "UNKNOWN" ? `  (${r.note})` : "";
        console.log(`  ${r.status.padEnd(8)} ${r.owner} -> ${r.upstream} @ ${r.pin}${extra}`);
      }
      // Detection only — never auto-updates pins or the owning skill.
      process.exitCode = rows.some((r) => r.status !== "CURRENT") ? 1 : 0;
      break;
    }

    case "remove": {
      const name = positional[0];
      if (!name || positional.length !== 1) return fail("remove needs exactly one <repo>");
      const repos = await scanWorkspace(cfg.workspace, { ignore: cfg.ignore, includeEmpty: true });
      const repo = repos.find((r) => r.name === name);
      if (!repo) return fail(`unknown repo: ${name}`);
      await classifyRepos([repo], cfg.workspace, cfg.ownedOwners);
      if (repo.class === "owned") return fail(`${name} is owned — archive it in an owned repo's archive/ folder instead`);
      const srcs = await alwaysSrcs(await alwaysTargets(), cfg.workspace);
      for (const skill of repo.skills) {
        if (srcs.has(await resolveReal(skill.src))) return fail(`${skill.name} is always-on — run skillbox always --off ${skill.name} first`);
      }
      if (!flags.has("force")) {
        if (!repo.isGit) return fail(`${name} is not a git repo — use --force to remove`);
        const top = await git(repo.path, ["rev-parse", "--show-toplevel"]);
        if (!top.ok || await resolveReal(top.out) !== await resolveReal(repo.path)) return fail(`${name} is not a git repo — use --force to remove`);
        const status = await git(repo.path, ["status", "--porcelain"]);
        if (!status.ok) return fail(`cannot check ${name} working tree: ${status.out}`);
        if (status.out) return fail(`${name} has a dirty working tree — use --force to remove`);
        const unpushed = await git(repo.path, ["rev-list", "--all", "--not", "--remotes"]);
        if (!unpushed.ok) return fail(`cannot check ${name} commits: ${unpushed.out}`);
        if (unpushed.out) return fail(`${name} has commits not on any remote — use --force to remove`);
      }
      const categories = await readCategories(cfg.workspace);
      const skills = [...new Set(repo.skills.map((skill) => skill.name))].sort((a, b) => a.localeCompare(b));
      const url = repo.remote ?? "";
      await appendRemoved(cfg.workspace, { name, url, added: localDate((await stat(repo.path)).birthtime), removed: localDate(new Date()), skills });
      if (categories.delete(name)) await writeCategories(cfg.workspace, categories);
      await rm(repo.path, { recursive: true, force: true });
      console.log(`removed ${name} (${skills.length} skills) -> restore: skillbox add ${url}`);
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
          `  list [repo] [--archived|--owned|--external] [--category <name>] [--json]\n` +
          `  category [<name> [repo...]]        list or assign repo categories\n` +
          `  category --off <repo...>           remove repo categories\n` +
          `  path <skill|repo:skill>            print that skill's SKILL.md path\n` +
          `  always [--off] [skill...] [--json] manage always-on user-scope links\n` +
          `  outdated [--offline] [--json]      compare local commits with upstream\n` +
          `  install <target> [skill...] [--all|--repo R] [--copy] [--force]\n` +
          `  uninstall <target> [skill...] [--all]\n` +
          `  status <target>                    what is linked (health)\n` +
          `  prune <target>                     remove our broken links\n` +
          `  update [repo|--all|--external]     git pull — bulk touches external clones only\n` +
          `  doctor [--fetch] [--json]          fleet health: unbacked owned, external drift,\n` +
          `                                     broken links; exit 0 HEALTHY / 1 WARN\n` +
          `  inventory [--write]                fleet table (skill/class/remote/targets/drift)\n` +
          `  drift                              owned upstreams.json pins vs external HEADs\n` +
          `  add <git-url>                      clone into workspace\n` +
          `  remove <repo> [--force]            remove an external clone\n` +
          `  target add|list|rm <alias> [path]  manage target aliases\n` +
          `  ui                                 interactive TUI\n\n` +
          `  --json   machine-readable stdout for list, always, outdated, doctor;\n` +
          `           exit codes and stderr errors stay the same\n` +
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
