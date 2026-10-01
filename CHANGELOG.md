# Changelog

## 0.2.1

- Absolute note paths are rejected with `absolute paths not allowed` instead of
  being re-rooted inside the vault: `/etc/passwd` no longer resolves to
  `etc/passwd.md` and report "not found". Covers POSIX, Windows drive and UNC
  forms — the behaviour the READMEs already documented.

## 0.2.0

- `obsidian_wikilinks` plus `obsidian_read` `resolveLinks` — parse/resolve `[[wikilinks]]`.
- `obsidian_write` / `obsidian_append` require `confirm=true`.

## 0.1.0

- Initial release: `obsidian_status`, `obsidian_list`, `obsidian_search`, `obsidian_read`, `obsidian_write`, `obsidian_append`, `obsidian_open`.
- Vault resolution via `config.vaultPath` or Windows `obsidian.json` through `/mnt/c/Users/…`.
- Prefers NTFS (`/mnt/<drive>`) vaults; warns on `\\wsl$` layouts.
