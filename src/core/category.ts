import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repo } from "./types.ts";

export async function readCategories(workspace: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let text: string;
  try {
    text = await readFile(join(workspace, ".skillboxcategory"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return map;
    throw error;
  }
  for (const line of text.split("\n")) {
    const clean = line.replace(/#.*$/, "").trim();
    const match = clean.match(/^(\S+)\s+(.+)$/);
    if (match) map.set(match[1], match[2].trim());
  }
  return map;
}

export async function writeCategories(workspace: string, map: Map<string, string>): Promise<void> {
  const entries = [...map].sort(([repoA, categoryA], [repoB, categoryB]) =>
    categoryA.localeCompare(categoryB) || repoA.localeCompare(repoB),
  );
  const lines = entries.map(([repo, category]) => `${repo} ${category}`);
  await writeFile(join(workspace, ".skillboxcategory"), ["# <repo-dir-name> <category>", ...lines, ""].join("\n"));
}

export async function applyCategories(repos: Repo[], workspace: string): Promise<Repo[]> {
  const categories = await readCategories(workspace);
  for (const repo of repos) repo.category = categories.get(repo.name);
  return repos;
}
