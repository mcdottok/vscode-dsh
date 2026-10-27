# DSH Coding Agent

Develop with DeepSeek Harness in VS Code, with an editor workflow similar to Codex and Claude Code extensions: chat about your project, attach selections and files, follow tool execution, and review changes. Run a local DSH package or connect to Desktop and continue the same workspace and session.

[简体中文](https://github.com/mcdottok/vscode-dsh/blob/main/README.md) | [English](https://github.com/mcdottok/vscode-dsh/blob/main/README.en.md)

## Demo

[![Watch the shared-session demo](https://raw.githubusercontent.com/mcdottok/vscode-dsh/main/docs/assets/demo-preview.jpg)](https://github.com/mcdottok/vscode-dsh/blob/main/docs/assets/demo.mp4)

## Install and connect

Install **DSH Coding Agent** in VS Code, open a trusted project folder, then open **DSH** in the right side bar. Choose either way to run DSH below.

### Option 1: Connect to Desktop and continue shared sessions

1. In DeepSeek Harness / DSH Desktop, open **Plugins → Add plugin**, enter `dsh-vscode-connect@latest`, and install and enable the companion [dsh-vscode-connect](https://github.com/mcdottok/dsh-vscode-connect). Its **VS Code connection** entry is on by default for new installations.
2. Keep Desktop running. On Windows, the plugins discover and connect automatically on the same machine, without copying an address or enabling browser access.
3. Select the same workspace and existing session to continue from either app.

If you previously disabled the connection entry, re-enable **Settings → General → VS Code connection** in Desktop. A saved manual connection takes precedence.

For other platforms, remote environments, or when automatic connection is unavailable, copy the address from Desktop's **VS Code connection** entry and run **DSH: Connect to Desktop** in VS Code. Credentials are stored in VS Code SecretStorage.

### Option 2: Use a local DSH package from npm

This option requires neither Desktop nor the connect plugin. Install Node.js (see [compatibility](https://github.com/mcdottok/vscode-dsh/blob/main/docs/dsh-contract.md) for runtime requirements and supported DSH versions), then run:

```sh
npm install --global @deepseek-ai/dsh
```

In the extension, open **Settings → Connection source**, select **Local DSH package**, confirm the detected global package or select an executable, then click **Start and connect to local DSH**. You can also install a specific version under **Local package and version** in settings. The extension starts a separate service; use option 1 to continue an existing Desktop session.

If you download a `.vsix` from GitHub Releases, install it with **Extensions: Install from VSIX...** in VS Code.

Chat in the side bar or an editor tab. Available models, tools and advanced features depend on the connected DSH runtime. See [compatibility](https://github.com/mcdottok/vscode-dsh/blob/main/docs/dsh-contract.md) and the [capability matrix](https://github.com/mcdottok/vscode-dsh/blob/main/docs/capability-matrix.md) for scope and limitations, and [support](https://github.com/mcdottok/vscode-dsh/blob/main/apps/extension/SUPPORT.md) for reporting instructions.

## Upgrading from the local build

This extension uses the ID `mcdottok.vscode-dsh`. If you previously installed `dsh-local.vscode-dsh` from a VSIX, uninstall that extension before installing this one to avoid loading both copies. VS Code treats them as separate extensions, so you may need to configure the connection again. Your DSH sessions remain in DSH.

## License and credits

MIT. Based on [Jabofish/deepseek-harness-vscode](https://github.com/Jabofish/deepseek-harness-vscode), powered by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). This project is independently maintained by the community.
