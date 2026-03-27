---
"@brainjar/cli": minor
---

Remove identity feature (commands, credential engines, state fields). brainjar now focuses on prompt composition: soul, persona, rules, brain. Identity and credential management will live in a separate tool.

**Breaking:** `brainjar identity` commands, `--identity` shell flag, and `BRAINJAR_IDENTITY` env var are removed. Existing `identity` fields in state.yaml are silently ignored and cleaned up on next write.
