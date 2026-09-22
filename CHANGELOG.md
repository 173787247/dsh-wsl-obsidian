# Changelog

## 0.1.0

- Initial release: `obsidian_status`, `obsidian_list`, `obsidian_search`, `obsidian_read`, `obsidian_write`, `obsidian_append`, `obsidian_open`.
- Vault resolution via `config.vaultPath` or Windows `obsidian.json` through `/mnt/c/Users/…`.
- Prefers NTFS (`/mnt/<drive>`) vaults; warns on `\\wsl$` layouts.
