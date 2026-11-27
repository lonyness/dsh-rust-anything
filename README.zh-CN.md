<div align="center">
  <img src="docs/media/banner.svg" alt="rust-anything for DeepSeek Harness" width="100%">
</div>

> **本仓库是 [rust-anything](https://github.com/erkamyaman/rust-anything) 的 DeepSeek Harness 插件封装，不是 rust-anything 项目本身，也不由该项目发布。** 迁移引擎、源码与许可归上游作者所有。
>
> 此处维护的是 DSH 接入层：固定版本引擎的打包、22 个 MCP 工具、审批边界、参数校验、随包技能与发布校验工具。上游源码未作修改。

<div align="center">

[![release](https://img.shields.io/github/v/release/lonyness/dsh-rust-anything?style=flat-square&label=release&color=f4661e)](https://github.com/lonyness/dsh-rust-anything/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/lonyness/dsh-rust-anything/test.yml?style=flat-square&label=CI)](https://github.com/lonyness/dsh-rust-anything/actions/workflows/test.yml)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.5%20%3C0.3.0--0-2f6feb?style=flat-square)](#平台与限制)
[![engine](https://img.shields.io/badge/engine-3.3.0%20pinned-8b949e?style=flat-square)](#与上游-cli-的差异)
[![tools](https://img.shields.io/badge/MCP%20tools-22-6e7681?style=flat-square)](#工具)
[![license](https://img.shields.io/badge/license-MIT-2f6feb?style=flat-square)](LICENSE)

<a href="#插件提供什么">概述</a> ·
<a href="#安装">安装</a> ·
<a href="#适配层能力">适配层</a> ·
<a href="#与上游-cli-的差异">对比上游</a> ·
<a href="#解读回放结果">回放结果</a> ·
<a href="#工具">工具</a> ·
<a href="#审批">审批</a> ·
<a href="#平台与限制">限制</a> ·
<a href="README.md">English</a>

</div>

---

## 插件提供什么

rust-anything 读取仓库、挑出值得重写的单元、为其中一个生成 Rust crate，再把从原程序录制下来的用例回放到 Rust 构建上。本插件把这条流程以 22 个 MCP 工具的形式接入 DeepSeek Harness，模型通过有类型的 schema 调用引擎，而不是拼接命令行。

| 步骤 | 工具 | 结果 |
|:--|:--|:--|
| 1 | `analyze`、`map` | 迁移单元、顺序、带 `file:line` 的风险，以及每个单元需要的桥接方式。只读，不弹审批。 |
| 2 | `record` | 运行原程序录制的用例：输入、输出、退出码、写出的文件。 |
| 3 | `bridge`、`build` | 带语言桥接的 Rust crate（napi、PyO3、C ABI、cgo、Fiddle、JNI、PHP FFI、P/Invoke）。 |
| 4 | `diff`、`bench`、`gate` | 逐个用例比对、在真实负载上测速、执行完成条件检查。 |

一个单元只有在录制用例全部匹配、`gate` 通过、并且 `bench` 显示按调用方的方式调用它并不更慢时，才算迁移完成。仅编译通过不构成完成。

适用对象：已有程序需要保留现有行为并改写成 Rust，原语言为 TypeScript/JavaScript、Python、C、Go、Ruby、Java、Kotlin、PHP 或 C#。

## 安装

**1. 安装插件包。** 稳定版插件 **3.3.5**，引擎 **rust-anything 3.3.0**。

```bash
dsh plugin --profile "my-profile" add "file:C:/Downloads/dsh-rust-anything-3.3.5.tgz"
```

也可以在 GUI 的插件页或插件市场中安装。安装包见 [Releases](https://github.com/lonyness/dsh-rust-anything/releases/latest)。

**2. 先发一个只读请求。**

> 用 rust-anything 分析这个仓库。列出最值得先迁的五个单元、相关风险，以及每个单元需要的桥接方式。不要修改任何文件。

`analyze` 与 `map` 是仅有的两个不需要审批的工具，因此这一步适合用来确认插件、引擎与平台都已正确工作。

**3. 批准一次写操作。** 第一个写操作（`bridge`、`record`、`build` 等）会请求审批，授权只对当次调用有效。

## 适配层能力

引擎未作改动，下列内容属于适配层。

| 组成 | 行为 |
|:--|:--|
| 内置引擎 | Windows x64 随包附带未经修改的 3.3.0 可执行文件，校验和记录在 `runtime/upstream-v3.3.0.json`。不需要安装步骤，不查找 PATH，运行时也不下载。macOS 与 GNU Linux（x64/arm64）使用用户自行下载并校验过的二进制。 |
| 有类型的工具 | 22 个带 JSON Schema 的 MCP 工具，前缀 `mcp__rust-anything__*`。模型读取契约而不是命令行语法，同一份固定目录对每次调用做校验。 |
| 审批前校验 | 类型错误、未知键、缺失必填字段、非法枚举值，以及引擎会静默改写的参数，都在审批之前被拒绝，报错点名字段与实到值。 |
| 审批边界 | 只有 `analyze` 与 `map` 免审批，依据是引擎将它们标记为只读。其余 20 个工具每次调用都需要一次授权；`never` 模式下会被拒绝。 |
| 沙箱内的 Cargo 输出 | 在 Windows `workspace-write` 下，构建原本会写入 `%LOCALAPPDATA%\rust-anything\target` 并被拒绝。现在子进程获得工作区内的 `CARGO_TARGET_DIR`：直接调用为 `<crate>/.rust-anything/target`，组合调用为 `<project>/rust/.rust-anything/target`。 |
| 与引擎一致的技能 | 注入的技能说明固定引擎实际支持的能力：九种语言及其真实限制（PHP 只桥接顶层函数，PHP 与 C# 没有 `--batch`），并链接[迁移 playbook](skills/rust-anything/playbook.md)，覆盖编译错误诊断（`E0382`、`E0507`、`E0499`、`E0502`、`E0597`、`E0515`、`E0716`、`E0277`）、FFI 与 `unsafe` 审查，以及按目标项目 `Cargo.toml` 匹配 crate 与 feature。 |
| 回放结果指引 | 注入内容要求把 `passed`、`total`、`skipped`、`failures`、`fallback` 合起来读：回退率 100% 的 `2/2` 不是 Rust 的结果，`fallback: null` 表示该构建未报告回退率，而不是回退率为零。 |
| 发布校验 | `test/verify_release.py` 用 npm 发布清单比对安装包成员，逐个与 git `HEAD` 比较字节，再解包运行测试。CI 在三个平台上执行同样的检查。 |

## 与上游 CLI 的差异

引擎行为在两种使用方式下一致，差异来自宿主环境。

| 方面 | 仅使用上游 CLI | DSH 中的本插件 |
|:--|:--|:--|
| 获取引擎 | 按平台下载、解包、放入 `PATH`、手动升级 | 包内固定 3.3.0 可执行文件（Windows x64），记录 SHA-256；其他平台通过 `DSH_RUST_ANYTHING_BIN` 指向自行校验的路径 |
| 调用方式 | 22 个子命令及其参数 | 22 个由 schema 描述的有类型工具 |
| 数值越界 | `port: 70000` 被 `u16::try_from` 丢弃，HTTP 请求随之消失，录制降级为 CLI 模式；`timeout: -5` 被当作未提供超时，回落到配置的 30 秒；`pace: -5` 保留原值 | 审批前拒绝：`app_record.port: expected an integer from 1 to 65535, got 70000` |
| 空 `run` | 空列表传给 `strings("run")` 会复用上次录制的命令，新参数被忽略且无提示 | 拒绝：要么提供首项为程序名的非空 argv 数组，要么明确省略 `run` |
| 回放目标 | 非字符串的 `--build` 被忽略，回放改走单元绑定，结果看起来像通过 | 拒绝：`app_replay.build` 必须是单条命令行字符串，库必须省略该参数 |
| 权限 | 由 shell 权限决定 | 每次调用单独授权，只读的两个工具除外；`never` 模式下写操作被拒绝 |
| Windows 构建缓存 | 写入工作区之外，在 `workspace-write` 下被拒绝 | `CARGO_TARGET_DIR` 限定在工作区内 |
| 版本漂移 | 包更新与自动更新可能在不通知的情况下更换引擎 | 不自动更新、不查找 PATH、运行时不下载；运行的就是固定版本 |
| 遥测 | 无 | 无；唯一的网络流量来自构建获取依赖 |

本插件不改变：引擎逻辑；磁盘上 `SKILL.md` 的字节内容（两处更正在注入时生效，均记录在 [PROVENANCE](runtime/PROVENANCE.md)）；用户项目文件；引擎版本不会自动升级。本插件也不保证迁移完成后的程序在所有环境中行为完全一致，证据范围以录制用例为限。

## 解读回放结果

<div align="center">
  <img src="docs/media/replay.png" alt="app_replay 报告：Build ./stats_probe.exe，Passed 6/6，Every case matches" width="820">
</div>

上图是引擎在真实 DSH 会话中写出的报告，由保存的文件渲染而来（[来源与摘要](docs/media/PROVENANCE.md)）。一次回放结果包含五个值：

- `passed` / `total`：匹配的用例数。`skipped` 不为零时，实际覆盖的用例少于总数。
- `failures`：每条记录用例与差异。出现一条即表示该单元未完成。
- `fallback`：本次回放中仍由原实现作答的比例。回退率 100% 时即便显示 `6/6`，Rust 代码也未被真正执行。`null` 表示该构建未报告回退率。

## 工具

<details>
<summary><b>按阶段查看全部 22 个工具</b></summary>

| 阶段 | 工具 |
|:--|:--|
| 检查，不弹审批 | `map`、`analyze` |
| 规划 | `profile`、`bridge`、`package` |
| 录制与验证 | `record`、`refresh`、`build`、`diff`、`bench`、`gate`、`report` |
| 切换单元 | `shadow`、`enable`、`disable` |
| 性能 | `go`、`fuzz` |
| 整应用 | `app_record`、`app_replay`、`app_front_door`、`app_wire`、`app_lift` |

`rust_anything_prompt` 为只读辅助工具，返回引擎自带的迁移提示模板。

</details>

## 审批

- `analyze` 与 `map` 不需要审批：引擎以 `readOnlyHint: true`、`destructiveHint: false`、`openWorldHint: false` 声明它们只读。
- 其余工具每次调用都需要一次审批，审批范围包含当次参数。
- 插件不绕过宿主策略。被拒绝的调用保持拒绝状态；通过终端重试、添加 `force` 或跳过 gate 都不构成替代方案。
- 报错中点名字段的，属于适配层的参数校验，处理方式是修改参数。

## 平台与限制

| 平台 | 引擎 |
|:--|:--|
| Windows x64 | 随包附带。这里有意忽略 `DSH_RUST_ANYTHING_BIN`，以保证运行的是随包的可执行文件。 |
| macOS / GNU Linux（x64 或 arm64） | 由用户提供：从[上游 v3.3.0 Release](https://github.com/erkamyaman/rust-anything/releases/tag/v3.3.0) 下载对应资产，用 `SHA256SUMS` 校验后把 `DSH_RUST_ANYTHING_BIN` 设为绝对路径。若从源码构建，`--version` 应输出 `rust-anything 3.3.0`。 |

已知限制：

- 写操作需要放开沙箱。Windows 上使用 `/permission workspace-write`，否则构建与 gate 会在引擎写缓存时失败。
- Python 单元需要可用的解释器。`record` 与 `go` 依次尝试 `python3` 与 `python`。若 `python` 是应用商店存根，调用会以 `9009` 失败；适配层会报告该情况，也可以通过 `app_record.run[0]` 指定解释器的绝对路径。
- 代理环境下依赖下载可能失败。出现 `SEC_E_NO_CREDENTIALS` 时需要处理网络或代理配置；关闭 TLS 校验不是可接受的方案，适配层也不会这样做。
- 大仓库的处理范围受到限制，由四个宿主变量控制：

| 变量 | 默认值 | 范围 |
|:--|--:|:--|
| `DSH_RUST_ANYTHING_STARTUP_TIMEOUT_MS` | 15000 | 1 – 120000 |
| `DSH_RUST_ANYTHING_REQUEST_TIMEOUT_MS` | 600000 | 1 – 3600000 |
| `DSH_RUST_ANYTHING_STDOUT_MAX_BYTES` | 16777216 | 1 – 67108864 |
| `DSH_RUST_ANYTHING_STDERR_MAX_BYTES` | 8192 | 1 – 65536 |

本仓库 CI 的覆盖范围：随包引擎能精确复现 Unicode 行为（包含 `é🦀` 的用例在原版返回 2，在按字节处理的实现中返回 6，报告中会指出该差异）。构建与回放已在 TypeScript、Python、C 上端到端验证；其余六种语言只验证了分析与桥接产物，因为 CI 环境中没有对应工具链。

## 校验发布包

```bash
python test/verify_release.py <上游 v3.3.0 资产目录> --tgz dsh-rust-anything-3.3.5.tgz
```

脚本先核对上游官方校验和，再确认安装包成员与 npm 发布清单完全一致且每个成员与 git `HEAD` 逐字节相同，最后解包并运行 `node --test test/*.test.cjs`。`--self-check` 用于验证校验器本身会接受正确的成员集合，并分别拒绝被篡改、多出与缺失的成员。参与开发需运行 `npm test`（Node 22.14+ 与 Rust 工具链），细节见 [runtime/PROVENANCE.md](runtime/PROVENANCE.md#maintainer-release-gate-from-the-checkout)。

## 文档

[Playbook](skills/rust-anything/playbook.md) · [中文验收场景](docs/acceptance-zh.md) · [引擎技能](skills/rust-anything/SKILL.md) · [整应用指南](skills/rust-anything/whole-app.md) · [细节](docs/DETAIL.zh.md) · [变更记录](CHANGELOG.md) · [测试](test/parity.test.cjs)

MIT 许可，与上游引擎一致。本仓库为第三方集成，与 rust-anything 项目无隶属关系，也未获其背书。卸载：`dsh plugin --profile "my-profile" remove dsh-rust-anything`。除插件目录外，只会在工作区内产生 Cargo 构建输出。
