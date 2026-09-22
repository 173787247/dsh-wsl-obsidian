import { existsSync } from "node:fs";
import { detectWsl, runPowerShell } from "./lib/wsl-host.js";
import { toWindowsPath } from "./lib/path.js";
import {
  appendNote,
  listNotes,
  readNote,
  resolveVaultConfig,
  searchNotes,
  writeNote,
  ensureMarkdownRel,
  DEFAULT_EXCLUDE,
} from "./lib/vault.js";
import { buildOpenUri, buildOpenScript, findObsidianExe, formatOpenResult } from "./lib/open.js";

export const name = "dsh-wsl-obsidian";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx, config = {}) {
  const timeoutMs = positive(config.timeoutMs, 20_000);
  const excludeDirs = Array.isArray(config.excludeDirs) && config.excludeDirs.length
    ? config.excludeDirs.map(String)
    : DEFAULT_EXCLUDE;
  const wsl = detectWsl();

  ctx.systemPrompt.section({
    name: "tool:obsidian",
    order: 119,
    text: [
      "Use obsidian_* tools for the local Obsidian vault on Windows NTFS (prefer /mnt/<drive>/… paths).",
      "Keep the vault on Windows filesystem, not under the Linux home disk, so the Windows Obsidian app can watch files.",
      "obsidian_open launches the Windows Obsidian UI via obsidian:// — Obsidian must be installed on Windows.",
      "Do not invent vault paths; call obsidian_status first if unsure.",
    ].join(" "),
  });

  const vaultDeps = () => resolveVaultConfig(config);

  ctx.tools.register({
    name: "obsidian_status",
    description: "Report Obsidian vault resolution, path kind (drvfs vs wsl$), and whether Obsidian.exe / URI open are available.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: formatStatus(value) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute() {
      const vault = vaultDeps();
      const exe = findObsidianExe();
      const win = vault.ok ? toWindowsPath(vault.vaultPath) : null;
      return {
        ok: true,
        wsl: Boolean(wsl),
        vaultOk: vault.ok,
        vaultPath: vault.vaultPath || null,
        vaultWindowsPath: vault.vaultWindowsPath || (win?.ok ? win.windows : null),
        vaultName: vault.vaultName || null,
        vaultKind: vault.kind || win?.kind || null,
        vaultSource: vault.source || null,
        vaultExists: vault.ok ? existsSync(vault.vaultPath) : false,
        vaultError: vault.ok ? null : vault.error,
        obsidianExe: exe,
        warning: vault.kind === "wsl$" || win?.kind === "wsl$"
          ? "Vault appears on Linux FS (\\\\wsl$). Windows Obsidian file watching is unreliable — prefer NTFS under /mnt/<drive>/."
          : null,
      };
    },
    presentCall: () => ({ card: "generic", title: "Obsidian status" }),
    presentResult: (_a, r) => ({ card: "generic", title: "Obsidian status", content: r.content }),
  });

  ctx.tools.register({
    name: "obsidian_list",
    description: "List Markdown notes in the vault (relative paths).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prefix: { type: "string", description: "Optional subdirectory prefix inside the vault." },
        limit: { type: "number", description: "Max notes to return (default 200)." },
      },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: formatList(v) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const vault = vaultDeps();
      if (!vault.ok) return vault;
      return listNotes(vault.vaultPath, {
        prefix: args?.prefix,
        excludeDirs,
        limit: positive(args?.limit, 200),
      });
    },
    presentCall: () => ({ card: "generic", title: "Obsidian list" }),
    presentResult: (_a, r) => ({ card: "generic", title: "Obsidian list", content: r.content }),
  });

  ctx.tools.register({
    name: "obsidian_search",
    description: "Full-text search Markdown notes in the vault (case-insensitive substring).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: formatSearch(v) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const vault = vaultDeps();
      if (!vault.ok) return vault;
      return searchNotes(vault.vaultPath, args?.query, {
        excludeDirs,
        limit: positive(args?.limit, 50),
      });
    },
    presentCall: () => ({ card: "generic", title: "Obsidian search" }),
    presentResult: (_a, r) => ({ card: "generic", title: "Obsidian search", content: r.content }),
  });

  ctx.tools.register({
    name: "obsidian_read",
    description: "Read a note by vault-relative path (e.g. Inbox/Note.md).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", description: "Vault-relative path; .md added if missing." },
      },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: formatRead(v) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const vault = vaultDeps();
      if (!vault.ok) return vault;
      return readNote(vault.vaultPath, args?.path);
    },
    presentCall: () => ({ card: "generic", title: "Obsidian read" }),
    presentResult: (_a, r) => ({ card: "generic", title: "Obsidian read", content: r.content }),
  });

  ctx.tools.register({
    name: "obsidian_write",
    description: "Create or overwrite a Markdown note (vault-relative path).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: formatWrite(v) }],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const vault = vaultDeps();
      if (!vault.ok) return vault;
      return writeNote(vault.vaultPath, args?.path, args?.content);
    },
    presentCall: () => ({ card: "generic", title: "Obsidian write" }),
    presentResult: (_a, r) => ({ card: "generic", title: "Obsidian write", content: r.content }),
  });

  ctx.tools.register({
    name: "obsidian_append",
    description: "Append text to a Markdown note (creates parent dirs / file if needed).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: formatAppend(v) }],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const vault = vaultDeps();
      if (!vault.ok) return vault;
      return appendNote(vault.vaultPath, args?.path, args?.content);
    },
    presentCall: () => ({ card: "generic", title: "Obsidian append" }),
    presentResult: (_a, r) => ({ card: "generic", title: "Obsidian append", content: r.content }),
  });

  ctx.tools.register({
    name: "obsidian_open",
    description: "Open a note (or the vault) in the Windows Obsidian app via obsidian:// URI.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Optional vault-relative note path." },
      },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: formatOpenResult(v) }],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      if (!wsl) return { ok: false, error: "not running in WSL (obsidian_open needs Windows host)" };
      const vault = vaultDeps();
      if (!vault.ok) return vault;
      const rel = args?.path ? ensureMarkdownRel(args.path) : "";
      const built = buildOpenUri({ vaultName: vault.vaultName, file: rel });
      if (!built.ok) return built;
      try {
        await runPowerShell(buildOpenScript(built.uri), { timeoutMs });
        return { ok: true, uri: built.uri, path: rel || null, vaultName: vault.vaultName };
      } catch (err) {
        return {
          ok: false,
          uri: built.uri,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    presentCall: () => ({ card: "generic", title: "Obsidian open" }),
    presentResult: (_a, r) => ({ card: "generic", title: "Obsidian open", content: r.content }),
  });
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function formatStatus(v) {
  const lines = [
    `wsl: ${v.wsl}`,
    `vaultOk: ${v.vaultOk}`,
    `vaultName: ${v.vaultName || "-"}`,
    `vaultPath: ${v.vaultPath || "-"}`,
    `vaultWindowsPath: ${v.vaultWindowsPath || "-"}`,
    `vaultKind: ${v.vaultKind || "-"}`,
    `vaultExists: ${v.vaultExists}`,
    `source: ${v.vaultSource || "-"}`,
    `obsidianExe: ${v.obsidianExe || "(not found)"}`,
  ];
  if (v.vaultError) lines.push(`error: ${v.vaultError}`);
  if (v.warning) lines.push(`warning: ${v.warning}`);
  return lines.join("\n");
}

function formatList(v) {
  if (!v.ok) return `obsidian_list failed: ${v.error}`;
  return [`notes: ${v.notes.length}${v.truncated ? " (truncated)" : ""}`, ...v.notes.map((n) => `- ${n}`)].join("\n");
}

function formatSearch(v) {
  if (!v.ok) return `obsidian_search failed: ${v.error}`;
  if (!v.hits.length) return `no hits for: ${v.query}`;
  return [
    `query: ${v.query}`,
    `hits: ${v.hits.length}${v.truncated ? " (truncated)" : ""}`,
    ...v.hits.map((h) => `- ${h.path}: ${h.snippet}`),
  ].join("\n");
}

function formatRead(v) {
  if (!v.ok) return `obsidian_read failed: ${v.error}`;
  return `# ${v.path}\n\n${v.content}`;
}

function formatWrite(v) {
  if (!v.ok) return `obsidian_write failed: ${v.error}`;
  return `wrote ${v.path} (${v.bytes} bytes)`;
}

function formatAppend(v) {
  if (!v.ok) return `obsidian_append failed: ${v.error}`;
  return `appended ${v.appended} bytes → ${v.path}`;
}
