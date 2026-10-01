import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  appendNote,
  listNotes,
  parseObsidianJson,
  parseWikilinks,
  readNote,
  resolveVaultConfig,
  resolveWikilinks,
  safeJoinVault,
  searchNotes,
  writeNote,
} from "../lib/vault.js";
import { buildOpenUri } from "../lib/open.js";
import { normalizeVaultRoot, toLinuxPath, toWindowsPath } from "../lib/path.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureVault = join(here, "fixtures", "vault");

describe("path", () => {
  it("maps /mnt/d to D:\\", () => {
    const r = toWindowsPath("/mnt/d/Notes/Vault");
    assert.equal(r.ok, true);
    assert.equal(r.kind, "drvfs");
    assert.equal(r.windows, "D:\\Notes\\Vault");
  });

  it("maps D:\\ to /mnt/d", () => {
    const r = toLinuxPath("D:\\Notes\\Vault");
    assert.equal(r.ok, true);
    assert.equal(r.linux, "/mnt/d/Notes/Vault");
  });

  it("normalizeVaultRoot accepts linux and windows", () => {
    assert.equal(normalizeVaultRoot("/mnt/c/Users/a/Vault").linux, "/mnt/c/Users/a/Vault");
    assert.equal(normalizeVaultRoot("C:\\Users\\a\\Vault").linux, "/mnt/c/Users/a/Vault");
  });
});

describe("vault safety", () => {
  it("rejects path escape", () => {
    const r = safeJoinVault(fixtureVault, "../outside.md");
    assert.equal(r.ok, false);
  });

  it("rejects POSIX absolute paths instead of re-rooting them", () => {
    for (const p of ["/etc/passwd", "/Inbox/Note.md", "//server/share/x.md"]) {
      const r = safeJoinVault(fixtureVault, p);
      assert.equal(r.ok, false, `${p} should be rejected`);
      assert.equal(r.error, "absolute paths not allowed");
    }
  });

  it("rejects Windows drive and UNC absolute paths", () => {
    for (const p of ["C:\\Users\\a\\Vault\\x.md", "D:/notes/x.md", "\\\\server\\share\\x.md"]) {
      const r = safeJoinVault(fixtureVault, p);
      assert.equal(r.ok, false, `${p} should be rejected`);
      assert.equal(r.error, "absolute paths not allowed");
    }
  });

  it("readNote reports an absolute path as a contract error, not a missing note", () => {
    const r = readNote(fixtureVault, "/etc/passwd");
    assert.equal(r.ok, false);
    assert.equal(r.error, "absolute paths not allowed");
  });

  it("joins relative md", () => {
    const r = safeJoinVault(fixtureVault, "Inbox/Note.md");
    assert.equal(r.ok, true);
    assert.equal(r.relative.replace(/\\/g, "/"), "Inbox/Note.md");
  });
});

describe("vault io", () => {
  it("lists fixture notes", () => {
    const r = listNotes(fixtureVault);
    assert.equal(r.ok, true);
    assert.ok(r.notes.some((n) => n.includes("Welcome.md")));
    assert.ok(r.notes.some((n) => n.includes("Inbox/Note.md")));
  });

  it("searches pineapple", () => {
    const r = searchNotes(fixtureVault, "pineapple");
    assert.equal(r.ok, true);
    assert.equal(r.hits.length, 1);
    assert.match(r.hits[0].path, /Inbox\/Note\.md$/);
  });

  it("reads welcome", () => {
    const r = readNote(fixtureVault, "Welcome.md");
    assert.equal(r.ok, true);
    assert.match(r.content, /Hello from fixture/);
  });

  it("parses and resolves wikilinks", () => {
    const parsed = parseWikilinks("See [[Welcome]] and [[Inbox/Note|inbox]] and [[Missing]].");
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].target, "Welcome");
    assert.equal(parsed[1].alias, "inbox");

    const links = resolveWikilinks(
      fixtureVault,
      "See [[Welcome]] and [[Inbox/Note|inbox]] and [[Missing]].",
    );
    assert.equal(links[0].found, true);
    assert.match(links[0].path, /Welcome\.md$/);
    assert.equal(links[1].found, true);
    assert.match(links[1].path, /Inbox\/Note\.md$/);
    assert.equal(links[2].found, false);

    const withLinks = readNote(fixtureVault, "Welcome.md", { resolveLinks: true });
    assert.equal(withLinks.ok, true);
    assert.ok(Array.isArray(withLinks.links));
  });

  it("write and append in temp vault", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-obs-"));
    try {
      mkdirSync(join(dir, "A"), { recursive: true });
      const w = writeNote(dir, "A/New.md", "# New\n");
      assert.equal(w.ok, true);
      const a = appendNote(dir, "A/New.md", "line2\n");
      assert.equal(a.ok, true);
      const body = readFileSync(join(dir, "A", "New.md"), "utf8");
      assert.equal(body, "# New\nline2\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("obsidian.json + open uri", () => {
  it("parses vaults preferring open", () => {
    const list = parseObsidianJson({
      vaults: {
        a: { path: "C:\\Vaults\\A", open: false, ts: 1 },
        b: { path: "D:\\Vaults\\B", open: true, ts: 2 },
      },
    });
    assert.equal(list[0].path, "D:\\Vaults\\B");
  });

  it("resolveVaultConfig uses explicit path", () => {
    const r = resolveVaultConfig({ vaultPath: fixtureVault, vaultName: "fixture" });
    assert.equal(r.ok, true);
    assert.equal(r.vaultName, "fixture");
    assert.ok(r.vaultPath.includes("fixtures"));
  });

  it("buildOpenUri encodes vault and file", () => {
    const r = buildOpenUri({ vaultName: "My Vault", file: "Inbox/Note.md" });
    assert.equal(r.ok, true);
    assert.match(r.uri, /^obsidian:\/\/open\?/);
    assert.match(r.uri, /vault=My\+Vault/);
    assert.match(r.uri, /file=Inbox%2FNote/);
  });
});
