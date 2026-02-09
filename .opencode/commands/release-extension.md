---
description: Package extension, publish to CWS, and sync GitHub
---

Use the `chrome-extension-release` skill.

TASK:
- Release this Chrome extension from the current repository.

MUST DO:
- Read `manifest.json` and confirm version.
- Run `scripts/release-extension.ps1` with flags based on user request:
  - package only: no flags
  - package + CWS publish: `-PublishCws`
  - package + CWS publish + git sync: `-PublishCws -SyncGitHub`
- Report zip path, CWS result, and git result.

MUST NOT DO:
- Do not expose secret env values.
- Do not force-push.
- Do not amend commits unless user asked.
