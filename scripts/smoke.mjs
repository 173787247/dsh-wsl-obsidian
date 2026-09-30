/**
 * Manual smoke against a real NTFS vault (no dsh host required).
 * Usage: node scripts/smoke.mjs [vaultPath]
 */
import { existsSync } from "node:fs";
import {
  appendNote,
  listNotes,
  readNote,
  resolveVaultConfig,
  searchNotes,
  writeNote,
} from "../lib/vault.js";
import { buildOpenUri, buildOpenScript, findObsidianExe } from "../lib/open.js";
import { detectWsl, runPowerShell } from "../lib/wsl-host.js";
import { toWindowsPath } from "../lib/path.js";

const vaultArg = process.argv[2]
  || process.env.OBSIDIAN_VAULT
  || `${process.env.HOME}/Documents/dsh-wsl-obsidian-vault`;

const winFallback = `${process.env.WSL_WINDOWS_HOME || "/mnt/c/Users"}/${process.env.WINDOWS_USER || "you"}/Documents/dsh-wsl-obsidian-vault`;
const vaultPath = existsSync(vaultArg) ? vaultArg : (existsSync(winFallback) ? winFallback : vaultArg);

const config = { vaultPath, vaultName: "dsh-wsl-obsidian-vault" };
const steps = [];

function step(name, result) {
  const ok = result && result.ok !== false && !result.error;
  steps.push({ name, ok: Boolean(ok), result });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}`);
  if (!ok) console.log("      ", result);
  else if (name === "search") console.log("      hits:", result.hits?.length, result.hits?.[0]?.path);
  else if (name === "list") console.log("      notes:", result.notes?.length);
  else if (name === "status") console.log("      ", {
    vaultPath: result.vaultPath,
    kind: result.kind,
    exe: result.obsidianExe,
    wsl: result.wsl,
  });
}

const vault = resolveVaultConfig(config);
step("resolve", vault);

const exe = findObsidianExe();
const win = vault.ok ? toWindowsPath(vault.vaultPath) : null;
step("status", {
  ok: true,
  wsl: detectWsl(),
  vaultPath: vault.vaultPath,
  kind: vault.kind || win?.kind,
  obsidianExe: exe,
  vaultExists: vault.ok && existsSync(vault.vaultPath),
});

step("list", listNotes(vault.vaultPath));
step("search", searchNotes(vault.vaultPath, "pineapple"));
step("read", readNote(vault.vaultPath, "Welcome.md"));
step("write", writeNote(vault.vaultPath, "Smoke/Agent.md", `# Agent smoke\n\nwritten at ${new Date().toISOString()}\n`));
step("append", appendNote(vault.vaultPath, "Smoke/Agent.md", "\nappended line\n"));
step("read-smoke", readNote(vault.vaultPath, "Smoke/Agent.md"));

const uri = buildOpenUri({ vaultName: config.vaultName, file: "Welcome.md" });
step("build-uri", uri);

let openResult = { ok: false, error: "skipped" };
if (detectWsl()) {
  try {
    await runPowerShell(buildOpenScript(uri.uri), { timeoutMs: 20_000 });
    openResult = { ok: true, uri: uri.uri, via: "powershell" };
  } catch (err) {
    openResult = { ok: false, error: err instanceof Error ? err.message : String(err), uri: uri.uri };
  }
} else {
  try {
    await runPowerShell(buildOpenScript(uri.uri), { timeoutMs: 20_000 });
    openResult = { ok: true, uri: uri.uri, via: "powershell-native" };
  } catch (err) {
    // On native Windows without /mnt powershell path, use Start-Process directly
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", buildOpenScript(uri.uri)],
        { timeout: 20_000, windowsHide: true },
      );
      openResult = { ok: true, uri: uri.uri, via: "powershell.exe" };
    } catch (err2) {
      openResult = {
        ok: false,
        error: err2 instanceof Error ? err2.message : String(err2),
        uri: uri.uri,
      };
    }
  }
}
step("open", openResult);

const failed = steps.filter((s) => !s.ok);
console.log("\n---");
console.log(`passed ${steps.length - failed.length}/${steps.length}`);
process.exit(failed.length ? 1 : 0);
