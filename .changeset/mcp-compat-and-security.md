---
'@brainjar/cli': minor
---

Add --content option to create and update commands for MCP compatibility, add delete commands for persona/soul/rules/brain, normalize drop (deactivate) and delete (permanent) semantics across all resources, fix path traversal in pack export via basename validation, add semver validation on version strings from external sources, fix drop commands not clearing state by sending empty string instead of null.
