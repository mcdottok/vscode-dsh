# DSH for VS Code

[简体中文](README.md) | [English](README.en.md)

在 VS Code 中使用 DeepSeek Harness：边写代码边对话，附加选区和文件，查看工具执行并审阅变更。使用体验类似 Codex、Claude Code 的编辑器插件，由 DSH 提供运行内核。

## 演示

[![查看演示视频](docs/assets/demo-preview.jpg)](docs/assets/demo.mp4)

[查看演示视频](docs/assets/demo.mp4)

## 安装与自动连接

1. 在 DeepSeek Harness 或 DSH Desktop 中安装配套的 [dsh-vscode-connect](https://github.com/mcdottok/dsh-vscode-connect/releases/tag/v0.1.11)，保持桌面端运行。首次安装默认开启连接入口。
2. 在 VS Code 中通过 **扩展：从 VSIX 安装…** 安装本扩展的 `.vsix`。
3. 打开并信任项目文件夹，展开右侧 **DSH**。Windows 同机环境下，两个插件会自动发现并连接。
4. 选择与桌面端相同的工作区和已有会话，即可从任一端继续开发。

Windows 自动连接无需复制地址，也无需开启浏览器访问。曾手动关闭入口的用户，需要在桌面端 **设置 → 通用设置 → VS Code 连接** 中重新开启。已有手动连接配置优先使用。

其他平台、远程环境或自动连接不可用时，在桌面端的 **VS Code 连接** 入口复制地址，再到 VS Code 执行 **DSH: Connect to Desktop / 连接桌面端**。凭据由 VS Code SecretStorage 保存。

## 在编辑器中开发

- 接续同一会话，实时查看回复、思考和工具进度。
- 附加代码选区、图片和文件，处理提问与审批。
- 选择 DSH 提供的模型和权限，审阅代码变更。
- 在侧栏或编辑器标签页中聊天。

扩展默认连接已有 DSH。高级功能取决于所连接的内核，具体见[兼容说明](docs/dsh-contract.md)和[能力矩阵](docs/capability-matrix.md)。

## 开发

见[构建说明](BUILD.md)、[贡献指南](CONTRIBUTING.md)和[开发者文档](docs/README.md)。此社区版本使用 `dsh-local.vscode-dsh` 标识，尚未发布到 Marketplace。

开发历程和版本变更见[更新日志](CHANGELOG.md)。

## 许可与致谢

MIT。基于 [Jabofish/deepseek-harness-vscode](https://github.com/Jabofish/deepseek-harness-vscode)，由 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供运行内核。本项目由社区独立维护。
