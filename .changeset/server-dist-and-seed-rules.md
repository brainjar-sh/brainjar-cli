---
'@brainjar/cli': minor
---

Thin-client architecture: all content (souls, personas, rules, brains, state) moved from local filesystem to brainjar server API. The CLI is now a lightweight client that talks to either a managed local server (auto-downloaded, embedded Postgres) or a remote server.

**Server management**: `brainjar server start|stop|status|logs|local|remote|upgrade` for full lifecycle control. Binary distribution via get.brainjar.sh with tarball downloads, SHA-256 checksum verification, and dynamic version resolution. Version tracking and update banner plumbing ready for next incur release.

**Migration**: `brainjar migrate` imports existing filesystem-based content into the server.

**Init overhaul**: `brainjar init` now downloads the server binary, starts it, creates the workspace, and seeds content via API. Seed rules flattened from a single "default" pack into individual rules (boundaries, context-recovery, task-completion, git-discipline, security).

**Other changes**: centralized error codes with typed constants, pack export/import, hooks management, standalone sync command, remote mode fixes, workspace auto-creation, stale docs cleanup.
