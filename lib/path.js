/** Minimal WSL ↔ Windows path helpers (drvfs + \\wsl$). */

export function distroName({ env = process.env } = {}) {
  return env.WSL_DISTRO_NAME || "WSL";
}

export function toWindowsPath(linuxPath, { distro = distroName() } = {}) {
  const normalized = String(linuxPath || "").trim().replace(/\\/g, "/");
  if (!normalized.startsWith("/")) return { ok: false, error: "linux path must be absolute" };

  const mnt = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (mnt) {
    const rest = mnt[2].replace(/\//g, "\\");
    return { ok: true, windows: `${mnt[1].toUpperCase()}:\\${rest}`, kind: "drvfs" };
  }
  const mntRoot = normalized.match(/^\/mnt\/([a-zA-Z])\/?$/);
  if (mntRoot) {
    return { ok: true, windows: `${mntRoot[1].toUpperCase()}:\\`, kind: "drvfs" };
  }
  const trimmed = normalized.replace(/^\//, "").replace(/\//g, "\\");
  return { ok: true, windows: `\\\\wsl$\\${distro}\\${trimmed}`, kind: "wsl$" };
}

export function toLinuxPath(windowsPath) {
  const raw = String(windowsPath || "").trim();
  if (!raw) return { ok: false, error: "empty windows path" };

  const drive = raw.match(/^([a-zA-Z]):[\\/]?(.*)$/);
  if (drive) {
    const rest = drive[2].replace(/\\/g, "/").replace(/^\/+/, "");
    return {
      ok: true,
      linux: rest ? `/mnt/${drive[1].toLowerCase()}/${rest}` : `/mnt/${drive[1].toLowerCase()}`,
      kind: "drvfs",
    };
  }

  const unc = raw.match(/^\\\\wsl(?:\$|\.localhost)\\([^\\/]+)[\\/]?(.*)$/i);
  if (unc) {
    const rest = unc[2].replace(/\\/g, "/").replace(/^\/+/, "");
    return { ok: true, linux: rest ? `/${rest}` : "/", kind: "wsl$", distro: unc[1] };
  }

  return { ok: false, error: "unrecognized windows path" };
}

/** Prefer an absolute Linux path when running under WSL; pass through Windows drive paths via /mnt. */
export function normalizeVaultRoot(raw) {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, error: "empty vault path" };
  if (s.startsWith("/")) {
    return { ok: true, linux: s.replace(/\/+$/, "") || "/", kind: s.startsWith("/mnt/") ? "drvfs" : "linux" };
  }
  const converted = toLinuxPath(s);
  if (!converted.ok) return converted;
  return {
    ok: true,
    linux: converted.linux.replace(/\/+$/, "") || converted.linux,
    kind: converted.kind,
    windows: s,
  };
}
