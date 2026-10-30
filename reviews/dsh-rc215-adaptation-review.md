# DSH 0.2.1-rc.5 适配检查

- 固定来源：[`dsh-v0.2.1-rc.5`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.5)，提交 `b830ec950faba0a46dda564be3e2d854afed94f1`；对照 [`dsh-v0.2.1-rc.4`](https://github.com/deepseek-ai/deepseek-harness/tree/504a01a9578abc2c6f1fb896b1dc322c9fe24f66)。
- 对比两个固定源码树：包版本更新之外，仅 Web 思考展示及相应文档和测试变化；扩展消费的 Connection、Gateway、Session、Workspace、工具和 Remote 服务端源码不变。rc.4 发布包与 rc.3 的消费契约对照记录见 [DSH 契约](../docs/dsh-contract.md)。
- `rc215` 继承 `rc213` 的已核对协议，仅接纳 rc.5 的精确身份；rc.4 和其他未单独适配版本仍走有界兼容检查并保留内部状态。`--no-open` 启动策略和引导安装默认版本不变。
- 自动回归覆盖精确识别、无兼容警告、旧版与未知版本回退、启动参数及既有版本链；相关 7 个测试文件共 163 项通过。
- 2026-10-30 在 Windows、Node.js 24.22.1 和本机 DSH CLI 0.2.1-rc.5 上，使用临时 DSH / agents 配置和工作区运行 `tests/live-dsh/rc211-surfaces.spec.ts`：精确身份与无兼容警告、设置读写、插件目录、会话创建与打开、归档往返及退出后的端口释放均通过。没有使用真实账户或发送模型请求。
- 此检查不代表所有 VS Code 交互、真实账户、模型回复及历史会话场景均已验证；对应能力仍按原矩阵标注。
