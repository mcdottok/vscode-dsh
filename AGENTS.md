# 实现代理操作规范

本文件是代理的强制约束。长期说明分别见 [架构与安全](docs/architecture.md)、[DSH 契约](docs/dsh-contract.md)、[能力矩阵](docs/capability-matrix.md)和[质量流程](docs/quality.md)；不要把某次改动记录追加到这些规范。

## 修改前

1. 阅读 `README.md`、`docs/quality.md` 和目标能力对应的矩阵行。
2. 阅读目标文件中完整的 `TODO`/`unimplemented` 要求；它们是验收条件，不能为了通过测试而删除。
3. 按目标 DSH 版本在固定 tag/commit 的真实接口源码、事件和工具目录核对契约。历史 Host API 固定提交只适用于对应家族，不能拿它猜新版 Remote；来源见 `docs/dsh-contract.md`。
4. 每次只选一个可验证的垂直切片，并检查 Domain、Adapter、Application、Extension/Protocol、Webview 和测试中确有需要的层。
5. 先检查工作区状态。保留用户未提交内容、`.codegraph/` 和无关本地产物。

## 绝对禁止

- Webview 直接 fetch DSH，或接收 endpoint、PID、Cookie、API key、Secret、绝对路径及原始诊断正文。
- Domain 引入 VS Code、React、HTTP、子进程或平台 API；DSH Adapter 调用 `vscode.*`；上游 wire 类型向 Application/Webview 泄漏。
- 解析 TUI/ANSI，或从模型文本猜测工具、审批、Goal、Job、Workflow 等状态。
- `auto` 发现完成前启动 DSH；停止、重启、kill 或接管外部 DSH；仅凭 PID 推断进程所有权。
- 扫描任意端口范围，自动发现连接非验证 loopback 目标，或使用 shell 拼接子进程命令。远程 HTTP(S) 仅允许用户显式选择并原生授权的 `custom` 端点；凭据按完整 origin 隔离，禁止自动重定向，HTTPS 必须验证证书，远程 HTTP 必须明确确认明文风险。
- 硬编码 Provider、Model、Skill、Plugin、动态命令或第三方工具清单。
- 删除 TODO 验收条件、弱化严格类型、跳过错误分支，或把自动测试冒充真实运行验证。
- 提交 `DSH_VSCODE_IMPLEMENTATION_PLAN.md`、`LOCAL_*.md`、真实凭据、用户路径、构建产物或 `.vsix`。

## 实现顺序与完成条件

先定 Domain 与仓储接口；用脱敏 fixture 写 Adapter 契约测试使缺口可见；实现目标版本 mapper/RPC/错误；再接 Application、Host route 与协议 schema；最后完成 Webview 状态、组件及可访问性测试。新 DSH 大版本在 `packages/dsh-adapter/src/versions/<version>/` 建独立入口，版本判断不散落到 UI 或用例。

移除一个 `unimplemented` 调用，必须同时覆盖原 TODO 的每项行为、适用的成功/业务错误/协议错误/超时/取消/畸形响应/资源释放测试，更新矩阵状态与证据，执行 `pnpm check && pnpm build`。涉及真实 DSH 的核心能力还需记录目标版本、平台、步骤和结果；缺少现场证据时维持 `PARTIAL`，不能标 `DONE`。

Secret 只经 VS Code 密码输入或 SecretStorage 由 Extension Host 处理；Webview 只显示 configured/missing。日志采用 allowlist，prompt、body、response、工具输入输出、key、token、authorization、secret 和 password 默认脱敏。附件、导出和文件选择通过用户操作及 Host 的 VS Code API 完成。

用户协作偏好：默认只快速修改代码，由用户自行编译；除非用户明确要求，不主动执行编译、打包或安装。Superpowers 技能仅在用户明确要求时使用，不自动或间接调用。

## 发布前的 CI 检查注意事项

每次改完代码后，在仓库根目录运行 `pnpm exec prettier --write <本次改动文件列表>`。只传入本次任务改动且受 Prettier 支持的文件，避免全仓格式化。

日常修改时补充必要测试代码并人工审阅差异。测试、Lint、类型、格式和文档等 CI 检查按用户明确要求的范围执行。全量 CI 仅在用户明确要求时运行，本地提交和发布准备均不会自动触发全量 CI。本文及子目录文档提及的检查流程均受此执行时机约束。编译、打包、安装和发布仍需用户明确要求。

以下是启用检查时的注意事项，不是每次修改的自动执行清单。每次改动均默认保留在工作区，等用户确认效果并明确要求提交后再提交，不必等用户额外说明“暂不提交”。

1. 按改动范围执行检查，不能只用单个组件测试通过代替其他门禁。提交前运行 `git diff --check`，并对修改的文件运行 `pnpm exec prettier --check <文件列表>`；Markdown 表格交给 Prettier 对齐，不在格式化后手动恢复空格。
2. 修改文档、版本号、更新日志或能力矩阵时，运行 `pnpm docs:check`；修改 Webview 文案时，运行 `pnpm i18n:check`。根目录与扩展内的更新日志必须同步。DSH 精确版本仅写入契约文档和发布更新日志，能力矩阵引用契约文档；契约中受脚本校验的版本字段必须与代码及校验规则一致。
3. 修改 TypeScript、TSX 或测试时，检查相关文件的 ESLint，并运行 `pnpm typecheck`（仅检查类型、不输出编译产物）。测试代码同样需要显式返回类型、安全的赋值和有效的变量初始化；不得通过关闭规则、使用 `any` 或删除断言绕过检查。修改继承方法时，检查整条继承链的参数与返回类型，特别是可选能力返回 `undefined` 的约定。
4. 行为变更运行 `pnpm test:changed`，合并受影响测试与固定契约，避免重复执行；修复 CI 时先查看失败任务，并复现失败文件或分组。涉及未来时间、过期、时区或夏令时的测试必须固定测试时钟，不能让写死的日期随着真实时间推移而失效；只需固定日期时仅模拟 `Date`，结束后恢复，避免影响异步等待。
5. 一个 CI 步骤失败后，后续步骤可能被跳过；修复后必须补查原先未执行的适用门禁。不得因为错误早已存在就忽略与本次提交相关的失败；尚未通过时明确说明失败项及验证范围，不宣称 CI 已通过。远端 CI 结果和本地检查结果分开说明。
6. 用户明确要求全量 CI 时运行 `pnpm check`；单独验证或修复 CI 时只运行所需检查，避免无关的重复测试。完整构建仍遵循用户的明确授权。不自动 push 或发布。

以下完整构建检查仅在用户要求执行验证时运行：

```powershell
pnpm check
pnpm build
git diff --check
git status --short
```

每次改动完成后保留在工作区，先交由用户确认效果；只有用户明确确认并要求提交后才执行 commit，不因功能或修复完成而自动提交。此前的提交授权不延续到后续改动；提交时按独立功能或修复拆分并写清说明，不自动 push 或发布。

仅在用户确定发布或明确要求时升级插件版本号，并同步清单、适用的锁文件与更新日志；日常本地修改保留版本号，记录到未发布变更。
