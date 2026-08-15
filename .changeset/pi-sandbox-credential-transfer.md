---
"@mauricioliu/ralph": minor
---

Transfer the host's pi credentials into sandboxes automatically for sandboxed `pi()` runs. Before the agent process starts (on every iteration), Ralph copies `~/.pi/agent/auth.json` and the `models-store.json` model-catalog cache into the sandbox's `~/.pi/agent/`, mirroring the session-transfer mechanism. This lets pi's OAuth-subscription models (`openai-codex`, `zai-coding-cn`) authenticate inside sandboxes with no manual credential setup — there are no API-key env vars for them. The copy is one-way: the host file stays authoritative and sandbox-side token refreshes never propagate back. A missing host `auth.json` fails the run with a typed error naming the missing file. The no-sandbox provider is unaffected. Implements ADR 0021.
