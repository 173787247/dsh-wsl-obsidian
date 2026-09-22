# Security

`dsh-wsl-obsidian` must not log, print, or return secrets (API tokens, Local REST API bearer keys, passwords).

- Note paths stay inside the configured vault (path traversal rejected).
- `obsidian_open` only launches `obsidian://` URIs via the Windows host; it does not run arbitrary executables.

Report issues via GitHub Issues on this repository.
