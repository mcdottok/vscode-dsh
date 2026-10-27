# DSH Coding Agent

[简体中文](README.md) | [English](README.en.md)

在 VS Code 中使用 DeepSeek Harness，获得类似 Codex、Claude Code 的编辑器插件体验：围绕当前项目对话，附加选区和文件，跟踪工具执行并审阅代码变更。可独立运行本机 DSH，也可自动连接桌面端并接续同一工作区与会话。

## 演示

[![查看演示视频](docs/assets/demo-preview.jpg)](docs/assets/demo.mp4)

[查看演示视频](docs/assets/demo.mp4)

## 安装与连接

先在 VS Code 中安装 **DSH Coding Agent**，打开并信任项目文件夹，再展开右侧 **DSH**。可选择以下任一种方式使用 DSH。

### 方式一：连接桌面端，接续同一会话

1. 在 DeepSeek Harness / DSH Desktop 的 **插件 → 添加插件** 中输入 `dsh-vscode-connect@latest`，安装并启用配套的 [dsh-vscode-connect](https://github.com/mcdottok/dsh-vscode-connect)。首次安装默认开启 **VS Code 连接** 入口。
2. 保持桌面端运行。Windows 同机环境下，两个插件会自动发现并连接，无需复制地址或开启浏览器访问。
3. 选择与桌面端相同的工作区和已有会话，即可从任一端继续开发。

曾手动关闭入口的用户，需要在桌面端 **设置 → 通用设置 → VS Code 连接** 中重新开启。已有手动连接配置优先使用。

其他平台、远程环境或自动连接不可用时，在桌面端的 **VS Code 连接** 入口复制地址，再到 VS Code 执行 **DSH: Connect to Desktop / 连接桌面端**。凭据由 VS Code SecretStorage 保存。

### 方式二：使用 npm 安装的本机 DSH

此方式无需桌面端，也无需安装 connect 插件。安装 Node.js（版本要求及 DSH 兼容范围见[兼容说明](docs/dsh-contract.md)），然后运行：

```sh
npm install --global @deepseek-ai/dsh
```

打开扩展内的 **设置 → 连接来源**，选择 **本机 DSH 安装包**，确认检测到的全局安装包或手动选择可执行文件，再点击 **启动并连接本机 DSH**。也可在设置中的 **本机安装包与版本** 安装指定版本。扩展会启动独立服务；已有桌面会话请使用方式一接续。

若通过 GitHub Release 下载 `.vsix`，在 VS Code 中执行 **扩展：从 VSIX 安装…** 即可安装本扩展。

## 在编辑器中开发

- 接续同一会话，实时查看回复、思考和工具进度。
- 附加代码选区、图片和文件，处理提问与审批。
- 选择 DSH 提供的模型和权限，审阅代码变更。
- 在侧栏或编辑器标签页中聊天。

扩展默认连接已有 DSH。高级功能取决于所连接的内核，具体见[兼容说明](docs/dsh-contract.md)和[能力矩阵](docs/capability-matrix.md)。

## 开发

见[构建说明](BUILD.md)、[贡献指南](CONTRIBUTING.md)和[开发者文档](docs/README.md)。此社区版本使用 `mcdottok.vscode-dsh` 标识。此前手动安装的 `dsh-local.vscode-dsh` 是独立扩展，升级前请先卸载旧版，再安装新版；可能需要重新配置连接。

开发历程和版本变更见[更新日志](CHANGELOG.md)。

## 许可与致谢

MIT。基于 [Jabofish/deepseek-harness-vscode](https://github.com/Jabofish/deepseek-harness-vscode)，由 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供运行内核。本项目由社区独立维护。
