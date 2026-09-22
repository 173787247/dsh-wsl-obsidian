import { existsSync, readdirSync } from "node:fs";
import { toWindowsPath } from "./path.js";

/** Build obsidian://open URI. file is vault-relative (with or without .md). */
export function buildOpenUri({ vaultName, file } = {}) {
  const vault = String(vaultName || "").trim();
  if (!vault) return { ok: false, error: "missing vaultName" };
  const params = new URLSearchParams();
  params.set("vault", vault);
  const f = String(file || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (f) params.set("file", f.replace(/\.md$/i, ""));
  return { ok: true, uri: `obsidian://open?${params.toString()}` };
}

export function candidateObsidianExePaths({ exists = existsSync } = {}) {
  const out = [];
  try {
    for (const name of readdirSync("/mnt/c/Users")) {
      if (["Public", "Default", "Default User", "All Users"].includes(name)) continue;
      out.push(`/mnt/c/Users/${name}/AppData/Local/Programs/Obsidian/Obsidian.exe`);
    }
  } catch {
    /* not in WSL or no /mnt/c */
  }
  out.push(
    "/mnt/c/Program Files/Obsidian/Obsidian.exe",
    "/mnt/c/Program Files (x86)/Obsidian/Obsidian.exe",
  );
  return out.filter((p) => exists(p));
}

export function findObsidianExe({ exists = existsSync, env = process.env } = {}) {
  const configured = String(env.OBSIDIAN_EXE || "").trim();
  if (configured && exists(configured)) return configured;

  const localApp = env.LOCALAPPDATA;
  if (localApp) {
    const native = joinWin(localApp, "Programs", "Obsidian", "Obsidian.exe");
    if (exists(native)) return native;
    const asLinux = String(localApp)
      .replace(/\\/g, "/")
      .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
    const win = `${asLinux}/Programs/Obsidian/Obsidian.exe`;
    if (exists(win)) return win;
  }

  return candidateObsidianExePaths({ exists })[0] || null;
}

function joinWin(...parts) {
  return parts.map((p) => String(p).replace(/[\\/]+$/, "")).join("\\");
}

export function buildOpenScript(uri) {
  const u = String(uri).replace(/'/g, "''");
  return `Start-Process '${u}'; 'ok'`;
}

export function formatOpenResult(value) {
  if (!value.ok) return `obsidian_open failed: ${value.error || "denied"}`;
  return `opened: ${value.uri}${value.path ? ` (${value.path})` : ""}`;
}

export function windowsPathForVaultRoot(vaultLinuxPath) {
  return toWindowsPath(vaultLinuxPath);
}
