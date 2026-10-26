# DSH for VS Code

[简体中文](README.md) | [English](README.en.md)

Use DeepSeek Harness inside VS Code: chat beside your code, attach selected files, follow tool execution, and review changes. It offers an editor workflow similar to Codex and Claude Code extensions, with DSH providing the runtime.

## Demo

[![Watch the demo](docs/assets/demo-preview.jpg)](docs/assets/demo.mp4)

[Watch the demo video](docs/assets/demo.mp4)

## Install and connect

1. Install the companion [dsh-vscode-connect](https://github.com/mcdottok/dsh-vscode-connect/releases/tag/v0.1.11) in DeepSeek Harness or DSH Desktop and keep Desktop running. New installations enable the connection entry by default.
2. Install this extension's `.vsix` in VS Code using **Extensions: Install from VSIX...**.
3. Open a trusted project folder in VS Code, then open **DSH** in the right side bar. On Windows, the two plugins discover and connect automatically on the same machine.
4. Select the same workspace and existing session as Desktop to continue the conversation from either app.

No address copying or browser access is needed for the Windows automatic flow. If you previously disabled the connection entry, re-enable **Settings → General → VS Code connection** in Desktop. A saved manual connection takes precedence.

For other platforms, remote environments, or when automatic connection is unavailable, copy the address from Desktop's **VS Code connection** entry and run **DSH: Connect to Desktop** in VS Code. Credentials are stored in VS Code SecretStorage.

## In your editor

- Continue shared sessions with streaming replies, thinking and tool progress.
- Attach selected code, images and files; respond to questions and approvals.
- Choose the models and permissions offered by DSH, and inspect proposed changes.
- Chat in the side bar or an editor tab.

The extension attaches to your running DSH by default. Advanced features depend on the connected runtime; see [compatibility](docs/dsh-contract.md) and the [capability matrix](docs/capability-matrix.md).

## Development

See [build instructions](BUILD.md), [contributing](CONTRIBUTING.md) and [developer documentation](docs/README.md). This community build uses `dsh-local.vscode-dsh` and is not a Marketplace listing.

See the [changelog](CHANGELOG.md) for this fork’s development history and version changes.

## License and credits

MIT. Based on [Jabofish/deepseek-harness-vscode](https://github.com/Jabofish/deepseek-harness-vscode). Powered by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). This is an independent community project.
