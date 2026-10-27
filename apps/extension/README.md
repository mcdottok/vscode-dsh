# DSH for VS Code

Develop with DeepSeek Harness inside VS Code: chat beside your code, attach files, follow tool execution and review changes, with an editor workflow similar to Codex and Claude Code extensions.

## Install and connect

1. Install and enable `dsh-vscode-connect` in DeepSeek Harness / DSH Desktop. Its connection entry is on by default for new installations.
2. Install this extension and open a trusted project folder in VS Code.
3. Keep Desktop running and open **DSH** in the right side bar. On Windows, the plugins connect automatically on the same machine.
4. Choose the same workspace and existing session to continue from either app.

No browser access is required. Previously disabled connection entries must be re-enabled in Desktop's General settings. Existing manual connection settings take precedence.

Other platforms, remote environments and automatic connection failures use manual setup: copy the address from Desktop's **VS Code connection** entry and run **DSH: Connect to Desktop**. Credentials stay in VS Code SecretStorage.

Chat in the side bar or an editor tab. Available models, tools and advanced features depend on the connected DSH runtime. See the repository documentation for compatibility and [support](SUPPORT.md) for reporting instructions.

## Upgrading from the local build

This extension uses the ID `mcdottok.vscode-dsh`. If you previously installed `dsh-local.vscode-dsh` from a VSIX, uninstall that extension before installing this one to avoid loading both copies. VS Code treats them as separate extensions, so you may need to configure the connection again. Your DSH sessions remain in DSH.

## License and credits

MIT. Based on [Jabofish/deepseek-harness-vscode](https://github.com/Jabofish/deepseek-harness-vscode), powered by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). This community build uses `dsh-local.vscode-dsh` and is not a Marketplace listing.
