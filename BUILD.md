# Build from source

This repository builds independently. Node.js must satisfy `package.json`; use the pnpm version declared in `packageManager`.

```powershell
pnpm install --frozen-lockfile
pnpm package:vsix
```

On Windows, run `.\build.cmd` from the repository root. The script installs dependencies from the frozen lockfile, then builds the editor companion, Webview and extension. It writes a versioned VSIX (`dsh-coding-agent-<version>.vsix`) to `artifacts/`.

Run `pnpm check` for the standard quality gates. Live DSH and VS Code checks require explicit setup; see [quality](docs/quality.md). Known capability limitations remain in the [matrix](docs/capability-matrix.md).

The separate `dsh-vscode-connect` repository builds the Desktop connection plugin. Neither repository requires a sibling checkout, local reference repositories, or another repository's dependencies.
