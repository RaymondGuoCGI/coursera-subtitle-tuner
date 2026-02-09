---
name: chrome-extension-release
description: Package a Chrome extension, publish it to Chrome Web Store, and sync the release to GitHub safely.
---

# Chrome Extension Release Skill

Use this skill when the user asks to release a Chrome extension and wants packaging, Chrome Web Store publish, and GitHub sync in one flow.

## Preconditions

- Extension project has a valid `manifest.json` in repo root.
- `git` is available and current folder is the extension repo.
- For CWS API publish, required environment variables are set:
  - `CWS_CLIENT_ID`
  - `CWS_CLIENT_SECRET`
  - `CWS_REFRESH_TOKEN`
  - `CWS_EXTENSION_ID`

## Release Flow

1. Validate `manifest.json` has a valid version string.
2. Run packaging script:
   - `powershell -ExecutionPolicy Bypass -File scripts/release-extension.ps1`
3. If user wants Chrome Web Store publish:
   - `powershell -ExecutionPolicy Bypass -File scripts/release-extension.ps1 -PublishCws`
4. If user wants GitHub sync too:
   - `powershell -ExecutionPolicy Bypass -File scripts/release-extension.ps1 -PublishCws -SyncGitHub`

## Safety Rules

- Never print secret values in chat.
- Never commit generated zip artifacts unless user explicitly asks.
- If CWS credentials are missing, stop CWS publish step and explain exactly which vars are missing.
- If git working tree is clean, skip commit/push gracefully.

## Expected Output

- A versioned zip under `dist/`.
- Optional CWS upload + publish result summary.
- Optional GitHub commit and push result summary.
