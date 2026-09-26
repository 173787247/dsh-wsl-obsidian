import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { normalizeVaultRoot, toLinuxPath, toWindowsPath } from "./path.js";

const DEFAULT_EXCLUDE = [".obsidian", ".git", ".trash", "node_modules"];

export function parseObsidianJson(raw) {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const vaults = data?.vaults && typeof data.vaults === "object" ? data.vaults : {};
    const list = Object.entries(vaults).map(([id, v]) => ({
      id,
      path: String(v?.path || ""),
      open: Boolean(v?.open),
      ts: Number(v?.ts) || 0,
    })).filter((v) => v.path);
    list.sort((a, b) => Number(b.open) - Number(a.open) || b.ts - a.ts);
    return list;
  } catch {
    return [];
  }
}

export function candidateObsidianJsonPaths({ env = process.env, exists = existsSync } = {}) {
  const out = [];
  const home = env.HOME || env.USERPROFILE || "";
  const winUser = env.WSL_USERPROFILE
    || env.USERPROFILE
    || (home.startsWith("/mnt/c/Users/") ? home.replace(/^\/mnt\/c/, "C:").replace(/\//g, "\\") : "");

  if (winUser) {
    const roaming = join(
      String(winUser).replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`),
      "AppData/Roaming/obsidian/obsidian.json",
    ).replace(/\\/g, "/");
    out.push(roaming);
  }

  // Common WSL mounts for the interactive Windows user
  try {
    const usersRoot = "/mnt/c/Users";
    if (exists(usersRoot)) {
      for (const name of readdirSync(usersRoot)) {
        if (name === "Public" || name === "Default" || name === "Default User" || name === "All Users") continue;
        out.push(`${usersRoot}/${name}/AppData/Roaming/obsidian/obsidian.json`);
      }
    }
  } catch {
    /* ignore */
  }

  return [...new Set(out)];
}

export function discoverVaultFromObsidianJson({ env = process.env, exists = existsSync, read = readFileSync } = {}) {
  for (const p of candidateObsidianJsonPaths({ env, exists })) {
    if (!exists(p)) continue;
    let raw;
    try {
      raw = read(p, "utf8");
    } catch {
      continue;
    }
    const vaults = parseObsidianJson(raw);
    if (!vaults.length) continue;
    const chosen = vaults.find((v) => v.open) || vaults[0];
    const linux = toLinuxPath(chosen.path);
    if (!linux.ok) continue;
    return {
      ok: true,
      vaultPath: linux.linux,
      vaultWindowsPath: chosen.path,
      vaultName: basenamePath(chosen.path),
      source: p,
      kind: linux.kind,
    };
  }
  return { ok: false, error: "obsidian.json not found or has no vaults" };
}

export function resolveVaultConfig(config = {}, deps = {}) {
  const { exists = existsSync } = deps;
  const explicit = String(config.vaultPath || "").trim();
  if (explicit) {
    // Prefer a path that exists on this runtime (native Windows tests vs WSL /mnt).
    if (exists(explicit)) {
      const asWin = /^[a-zA-Z]:[\\/]/.test(explicit) || explicit.startsWith("\\\\");
      const win = asWin ? explicit.replace(/\//g, "\\") : (toWindowsPath(explicit).windows || explicit);
      const kind = explicit.replace(/\\/g, "/").startsWith("/mnt/") || asWin
        ? "drvfs"
        : explicit.startsWith("/")
          ? "linux"
          : "drvfs";
      return {
        ok: true,
        vaultPath: explicit,
        vaultWindowsPath: win,
        vaultName: String(config.vaultName || basenamePath(explicit)),
        source: "config",
        kind,
      };
    }
    const n = normalizeVaultRoot(explicit);
    if (!n.ok) return n;
    if (exists(n.linux)) {
      const win = n.windows || toWindowsPath(n.linux);
      return {
        ok: true,
        vaultPath: n.linux,
        vaultWindowsPath: typeof win === "string" ? win : win.windows,
        vaultName: String(config.vaultName || basenamePath(n.linux)),
        source: "config",
        kind: n.kind,
      };
    }
    const win = n.windows || toWindowsPath(n.linux);
    return {
      ok: true,
      vaultPath: n.linux,
      vaultWindowsPath: typeof win === "string" ? win : win.windows,
      vaultName: String(config.vaultName || basenamePath(n.linux)),
      source: "config",
      kind: n.kind,
    };
  }
  const discovered = discoverVaultFromObsidianJson(deps);
  if (!discovered.ok) return discovered;
  // If discovered Linux mount does not exist (running outside WSL), try Windows path.
  if (discovered.vaultWindowsPath && !exists(discovered.vaultPath) && exists(discovered.vaultWindowsPath)) {
    discovered.vaultPath = discovered.vaultWindowsPath;
  }
  if (config.vaultName) discovered.vaultName = String(config.vaultName);
  return discovered;
}

export function vaultNameFromPath(vaultPath) {
  return basenamePath(vaultPath);
}

function basenamePath(p) {
  const s = String(p || "").replace(/[\\/]+$/, "");
  const parts = s.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "vault";
}

export function safeJoinVault(vaultRoot, relPath) {
  const root = resolve(String(vaultRoot));
  const rel = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel) return { ok: false, error: "empty relative path" };
  if (rel.includes("\0")) return { ok: false, error: "invalid path" };
  const abs = resolve(root, rel);
  const relCheck = relative(root, abs);
  if (relCheck.startsWith("..") || relCheck === ".." || abs === root && rel.includes("..")) {
    return { ok: false, error: "path escapes vault" };
  }
  // Windows drive / UNC absolute injection
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("//") || rel.startsWith("\\\\")) {
    return { ok: false, error: "absolute paths not allowed" };
  }
  if (!abs.startsWith(root + sep) && abs !== root) {
    // On Windows resolve may change casing; compare lowercase
    if (abs.toLowerCase() !== root.toLowerCase() && !abs.toLowerCase().startsWith(root.toLowerCase() + sep)) {
      return { ok: false, error: "path escapes vault" };
    }
  }
  return { ok: true, absolute: abs, relative: relCheck.replace(/\\/g, "/") || rel };
}

export function ensureMarkdownRel(rel) {
  const r = String(rel || "").replace(/\\/g, "/");
  if (!r) return r;
  if (/\.[a-z0-9]+$/i.test(r)) return r;
  return `${r}.md`;
}

export function listNotes(vaultRoot, { prefix = "", excludeDirs = DEFAULT_EXCLUDE, limit = 200 } = {}) {
  const root = resolve(vaultRoot);
  if (!existsSync(root)) return { ok: false, error: `vault not found: ${vaultRoot}` };
  const exclude = new Set((excludeDirs || DEFAULT_EXCLUDE).map(String));
  const out = [];
  const start = prefix ? safeJoinVault(root, prefix) : { ok: true, absolute: root, relative: "" };
  if (!start.ok) return start;

  function walk(dir, relBase) {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const ent of entries) {
      if (out.length >= limit) break;
      if (exclude.has(ent.name)) continue;
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs, rel);
      } else if (ent.isFile() && /\.md$/i.test(ent.name)) {
        out.push(rel.replace(/\\/g, "/"));
      }
    }
  }

  walk(start.absolute, start.relative);
  out.sort((a, b) => a.localeCompare(b));
  return { ok: true, notes: out, truncated: out.length >= limit };
}

export function searchNotes(vaultRoot, query, { excludeDirs = DEFAULT_EXCLUDE, limit = 50, maxBytes = 512_000 } = {}) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, error: "empty query" };
  const listed = listNotes(vaultRoot, { excludeDirs, limit: 5000 });
  if (!listed.ok) return listed;
  const needle = q.toLowerCase();
  const hits = [];
  for (const rel of listed.notes) {
    if (hits.length >= limit) break;
    const abs = join(vaultRoot, rel);
    let text;
    try {
      const st = statSync(abs);
      if (st.size > maxBytes) continue;
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const idx = text.toLowerCase().indexOf(needle);
    if (idx < 0 && !rel.toLowerCase().includes(needle)) continue;
    const lineStart = text.lastIndexOf("\n", Math.max(0, idx)) + 1;
    const lineEnd = text.indexOf("\n", idx);
    const snippet = text.slice(lineStart, lineEnd < 0 ? lineStart + 160 : lineEnd).trim().slice(0, 160);
    hits.push({ path: rel, snippet: snippet || `(filename match: ${rel})` });
  }
  return { ok: true, query: q, hits, truncated: hits.length >= limit };
}

export function readNote(vaultRoot, relPath, { resolveLinks = false, excludeDirs = DEFAULT_EXCLUDE } = {}) {
  const rel = ensureMarkdownRel(relPath);
  const joined = safeJoinVault(vaultRoot, rel);
  if (!joined.ok) return joined;
  if (!existsSync(joined.absolute)) return { ok: false, error: `not found: ${joined.relative}` };
  try {
    const content = readFileSync(joined.absolute, "utf8");
    const out = { ok: true, path: joined.relative, content, bytes: Buffer.byteLength(content, "utf8") };
    if (resolveLinks) {
      out.links = resolveWikilinks(vaultRoot, content, { excludeDirs });
    }
    return out;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Extract Obsidian `[[target]]` / `[[target|alias]]` / `[[target#heading]]` wikilinks. */
export function parseWikilinks(content) {
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
  const links = [];
  let m;
  const text = String(content || "");
  while ((m = re.exec(text))) {
    links.push({
      raw: m[0],
      target: m[1].trim(),
      alias: m[2] ? m[2].trim() : null,
    });
  }
  return links;
}

/**
 * Parse wikilinks and resolve targets to vault-relative note paths when found.
 * Matches by full relative stem or basename (case-insensitive).
 */
export function resolveWikilinks(vaultRoot, content, { excludeDirs = DEFAULT_EXCLUDE } = {}) {
  const links = parseWikilinks(content);
  const listed = listNotes(vaultRoot, { excludeDirs, limit: 5000 });
  const byKey = new Map();
  if (listed.ok) {
    for (const n of listed.notes) {
      const norm = n.replace(/\\/g, "/");
      const stem = norm.replace(/\.md$/i, "");
      const base = stem.split("/").pop();
      byKey.set(stem.toLowerCase(), norm);
      if (base) byKey.set(base.toLowerCase(), norm);
    }
  }
  return links.map((l) => {
    const key = l.target.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
    const path = byKey.get(key) || null;
    return { ...l, path, found: Boolean(path) };
  });
}

export function writeNote(vaultRoot, relPath, content, { createDirs = true } = {}) {
  const rel = ensureMarkdownRel(relPath);
  const joined = safeJoinVault(vaultRoot, rel);
  if (!joined.ok) return joined;
  try {
    if (createDirs) mkdirSync(dirname(joined.absolute), { recursive: true });
    writeFileSync(joined.absolute, String(content ?? ""), "utf8");
    return { ok: true, path: joined.relative, bytes: Buffer.byteLength(String(content ?? ""), "utf8") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function appendNote(vaultRoot, relPath, content) {
  const rel = ensureMarkdownRel(relPath);
  const joined = safeJoinVault(vaultRoot, rel);
  if (!joined.ok) return joined;
  try {
    mkdirSync(dirname(joined.absolute), { recursive: true });
    const chunk = String(content ?? "");
    appendFileSync(joined.absolute, chunk, "utf8");
    return { ok: true, path: joined.relative, appended: Buffer.byteLength(chunk, "utf8") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export { DEFAULT_EXCLUDE };
