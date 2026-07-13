import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p); // follows symlinks — used to detect broken links
    return true;
  } catch {
    return false;
  }
}

// Canonicalize a path, resolving symlinks in every ancestor (so /tmp -> /private/tmp,
// worktree links, etc. don't fool containment checks). Works even when the leaf does
// not exist (a broken link target): canonicalize the parent, then re-attach the base.
export async function resolveReal(p: string): Promise<string> {
  const abs = resolve(p);
  try {
    return await realpath(abs);
  } catch {
    try {
      return join(await realpath(dirname(abs)), basename(abs));
    } catch {
      return abs; // nothing on disk to canonicalize against — lexical is best we can do
    }
  }
}
