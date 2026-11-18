import fs from "node:fs";
import path from "node:path";

/**
 * Resolves a relative path strictly inside `projectRoot`, preventing `..` escapes and symlink escapes.
 */
export function resolveInsideProject(projectRoot: string, relativePath = "."): string {
  if (relativePath.includes("\0")) {
    throw new Error("Invalid path: null byte");
  }
  const canonicalRoot = fs.realpathSync(projectRoot);
  const cleaned = relativePath.trim() === "" ? "." : relativePath;

  if (path.isAbsolute(cleaned) || /^[A-Za-z]:/.test(cleaned) || cleaned.startsWith("\\\\")) {
    throw new Error(`Absolute paths are not allowed: ${relativePath}`);
  }

  const candidate = path.resolve(canonicalRoot, cleaned);
  const rel = path.relative(canonicalRoot, candidate);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }

  // Verify existing parent chain via realpath to block symlink escapes
  let checkTarget = candidate;
  while (!fs.existsSync(checkTarget)) {
    const parent = path.dirname(checkTarget);
    if (parent === checkTarget) break;
    checkTarget = parent;
  }

  if (fs.existsSync(checkTarget)) {
    const realTarget = fs.realpathSync(checkTarget);
    const realRel = path.relative(canonicalRoot, realTarget);
    if (realRel === ".." || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) {
      throw new Error(`Symlink escapes project root: ${relativePath}`);
    }
  }

  return candidate;
}
