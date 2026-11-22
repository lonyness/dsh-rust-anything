# Windows 验收：适配器 3.3.3-rc.1 / 原版引擎 3.3.0

这是本地候选的验收记录，不是 Release。源码基线为 `v3.3.2`（`07e42828e029a36159508b199c36190418e05946`）。以下包摘要只针对本次实测的文件，不等同于其他环境重新打出来的包。

| 对象 | SHA-256 |
|---|---|
| 官方 Windows x64 ZIP | `9974932da25ee4cbb1a50ded3e57b2f2a9d0c089691bc64f666c38eb03802b9b` |
| ZIP 中的 EXE = 仓库内 EXE = 下列 tgz 内 EXE | `7cf46ddfcc987f3ccd5bb501130254b765fb3690b0494ba1a65b84f872254183` |
| 本地候选 `dsh-rust-anything-3.3.3-rc.1.tgz`（5,649,282 字节） | `5b614a58b49defb9ea455f777b55c449633e0c9cdecd6e1b22fa27062c97465a` |

## 产物与自动化测试

- [上游 v3.3.0](https://github.com/erkamyaman/rust-anything/releases/tag/v3.3.0) 标签解析到提交 `c0862b8696b51779f4b32d16ad57b3601f75fb12`。实际下载五个归档，先验官方 `SHA256SUMS` 及每个归档，再验各自可执行文件。核对值见[来源清单](../runtime/upstream-v3.3.0.json)；[打包命令](../runtime/PROVENANCE.md#maintainer-release-gate-from-the-checkout)在启动 npm 之前和生成 tgz 之后分别核对 EXE。仓库内引擎、原版指南均未修改。
- 在隔离副本中验证门禁：分别改动官方归档一个字节、打包前 EXE 一个字节，均退出 1，未产出候选；重做有效 tgz 但改变其中的 EXE、删除 EXE、使 EXE 成员重复，复核均退出 1。正确对照退出 0。
- Windows x64，Node 22.14.0、npm 10.9.2、rustc / cargo 1.100.0。原基线 23/23；本轮源码与最终 tgz 解包各 24/24，均无跳过。新测试在旧逻辑上复现了未知名称免审批；修复后未知名称以及 `analyze`/`map` 缺失、反向或非布尔标记均须审批。原生引擎的 Unicode 回放正确实现 2/2，按字节计数的负对照为 1/2。**这些不是 DSH 宿主验收。**

## 真实宿主（Windows x64）

在 Windows x64 上，实际桌面安装内置的 DSH CLI **0.2.2-rc.5** 恰好是声明下限；这是一个实测版本，不是两个。Electron 44.7.0，宿主 Node 24.21.0，pnpm 11.28.5。官方 CLI 从空 `DSH_HOME` 创建 `sdk` profile，离线安装经过上述 SHA-256 核对的 tgz，不使用链接目录，也不是同 profile 升级。未使用日常凭据、profile 或真实项目。

| 项目 | 正常 SDK 轮次中的实测结果 |
|---|---|
| 管理器与发现 | Manager 返回 `installed=true`、`enabled=true`、插件行 `active`，中英文标题、图标字节和两份本地化详情都正确。模型请求可见 22 个引擎工具、两个模板和 `rust-anything` Skill。实际加载 Skill，调用 `port_unit` 成功。 |
| 无须审批 | `analyze` 找到小样例中的 `counter.py`；这个轮次没有审批事件。 |
| 拒绝不执行 | 第一次拒绝 `app_record`，没有 `rust/` 目录或程序启动标记。其余两次拒绝前后，样例文件内容哈希、修改时间和启动标记都未变。 |
| 逐次许可与业务结果 | `app_record`：拒绝 → 单次允许 → 相同参数再次询问并拒绝；`app_replay`：另一次单次允许 → 相同参数再次询问并拒绝。录制 `abc→3`、`é🦀→2`；Rust 正确实现实际回放 `passed=2, total=2, skipped=0, failures=[]`，落盘报告为 `Passed: 2/2`。 |

[复验驱动](windows-sdk/run.ps1)通过真正的 SDK `session/prompt` 发起 8 个轮次，保持临时会话的 `workspace-write` / `ask`。只有模型是确定性的本地测试驱动；工具执行、引擎、审批、持久化均为真实宿主行为。5 个审批 ID 不同，原始 SDK 收发与物理日志逐项匹配：`asked→decided` 序号为 `56→57`、`71→72`、`86→87`、`101→102`、`116→117`。本次物理日志 SHA-256 为 `ac8bd108e602b6f1f170c755fd5d11c3d5351a561e060d830189635033e8ec97`。随后从仓库内的复验入口，用同一 tgz 在第二个全新临时 profile 重跑也通过，审批序列相同，独立物理日志 SHA-256 为 `011c4f7d3dc0010166651b4dfe2bf0b84ad4f20993c7ede3bffcdb11345e77a1`。含本机路径的原始审计日志不随仓库发布。

### 最短复验

从检出目录执行。Windows x64 需 PowerShell 7.3+、已安装的 DSH Desktop、Node、Rust MSVC 工具链及链接器。使用原候选时将 `$sha` 设为上表的 tgz 哈希；重新打包则使用本次[门禁输出](../runtime/PROVENANCE.md)的摘要，并对同一文件重跑冒烟。

```powershell
pwsh -NoProfile -File ./test/windows-sdk/run.ps1 -Archive $absoluteTgz -Sha256 $sha -DesktopExe $absoluteDesktopExe
```

每次都会新建临时目录；退出 0 后查看其 `result.json`、`manager.json`、`turns.json` 与样例的 `rust/app-cases/replay-report.md`。只有宿主测试使用此驱动，它不装入候选包。

**未验收：** 未目测真实插件页面（含主题、窄屏和图片渲染），管理器数据正确不等于 GUI 通过。可在新的 PowerShell 进程、全新临时 `DSH_HOME` / `DSH_AGENTS_HOME` 中运行 `dsh plugin --profile web add "file:<候选绝对路径>"`，再执行 `dsh --profile web --no-open --host 127.0.0.1 --port 0`；仅打开该临时实例给出的地址，到「插件」核对启用状态、中英文标题和详情图。macOS/Linux 的桌面宿主、其他 DSH 版本没有实装，CI/字节校验不替代这些测试。
