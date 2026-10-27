# Build from source

This repository builds independently. Node.js must satisfy `package.json`; use the pnpm version declared in `packageManager`.

```powershell
pnpm install --frozen-lockfile
pnpm package:vsix
```

On Windows, after installing dependencies, run `.\build.cmd`. It builds the editor companion, Webview and extension, then writes a versioned VSIX (`dsh-coding-agent-<version>.vsix`) to `artifacts/`. It does not install dependencies or plugins.

Run `pnpm check` for the standard quality gates. Live DSH and VS Code checks require explicit setup; see [quality](docs/quality.md). Known capability limitations remain in the [matrix](docs/capability-matrix.md).

The separate `dsh-vscode-connect` repository builds the Desktop connection plugin. Neither repository requires a sibling checkout, local reference repositories, or another repository's dependencies.
