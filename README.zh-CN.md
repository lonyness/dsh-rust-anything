<p align="center"><a href="https://github.com/erkamyaman/rust-anything"><img width="112" height="112" alt="rust-anything" src="https://raw.githubusercontent.com/erkamyaman/rust-anything/c0862b8696b51779f4b32d16ad57b3601f75fb12/docs/assets/logo.png"></a></p>

<h1 align="center">适用于 DeepSeek Harness 的 rust-anything</h1>

[**下载插件 3.3.5**](https://github.com/lonyness/dsh-rust-anything/releases/download/v3.3.5/dsh-rust-anything-3.3.5.tgz) · [更新记录](CHANGELOG.md) · [上游项目](https://github.com/erkamyaman/rust-anything)

[English](README.md) · **简体中文**

先选一个函数迁到 Rust，再用原程序录下的输入检验新实现。代理负责编写 Rust，原生引擎负责录制行为、回放和报告差异。回放通过说明新实现匹配已录制的用例，不代表所有输入都等价。

**你能得到什么：** 判断是否迁移成功的是引擎，不是代理——它录制一次原行为，把同一批用例回放给 Rust 构建，并逐条指出差异。单元没通过校验前，原实现继续提供服务，前门程序会记录每次回退，所以迁移做到一半的程序仍然可用。本仓库 CI 实测：一个统计 Unicode 字符数的 JavaScript CLI 迁移后 **2/2** 用例通过；改成统计 UTF-8 字节数的变体只有 **1/2** 通过（原版输出 `2`，变体输出 `6`），回放会点名这条用例。

![真实的 app_replay 报告：Build ./stats_probe.exe、Passed: 6/6、Fallback rate: not reported by this build、Every case matches。](docs/media/replay.png)

*这是真实 DSH 会话中引擎对 Rust 构建给出的报告，按保存下来的文件重新渲染——[来源、校验和，以及这次构建未报告回退率的事实](docs/media/PROVENANCE.md)。*

这是基于 [erkamyaman/rust-anything](https://github.com/erkamyaman/rust-anything) v3.3.0 的 **非官方 DSH 适配**。原生引擎和迁移指南来自 [Erkam Yaman](https://github.com/erkamyaman) 与[上游贡献者](https://github.com/erkamyaman/rust-anything/graphs/contributors)；[本仓库](https://github.com/lonyness/dsh-rust-anything) 将它们打包接入 DeepSeek Harness，没有重新实现迁移引擎。

## 安装组合包

**稳定版插件：3.3.5 · 原生引擎：3.3.0。** 声明的 DSH 范围是 `>=0.2.2-rc.5 <0.3.0-0`，不等于每个版本都实测过。请安装上方正式发布的 `.tgz`；复核下载包或自行打包时可使用[发布包核验工具](runtime/PROVENANCE.md#maintainer-release-gate-from-the-checkout)。

- **插件页：** 解压组合包，在「插件」页安装本地组合包，输入含 `package.json` 的目录绝对路径。
- **DSH CLI：** 直接安装下载的压缩包。以下是 Windows 示例，请替换为自己的 profile 名称和文件绝对路径：

  ```powershell
  dsh plugin --profile "my-profile" add "file:C:/Downloads/dsh-rust-anything-3.3.5.tgz"
  ```

在「插件」页选中并启用组合包。如果当前 profile 未热加载，重启 DSH，再到目标项目打开新会话。无需运行 `rust-anything setup`，也不用替换 `PATH` 中的 CLI。

| 平台 | 原生引擎 |
| --- | --- |
| Windows x64 | 已内置于 `runtime/win32-x64/rust-anything.exe`。此平台不使用 `DSH_RUST_ANYTHING_BIN`。 |
| macOS 或 GNU/Linux（x64 / arm64） | 未内置。从[上游 v3.3.0 发布页](https://github.com/erkamyaman/rust-anything/releases/tag/v3.3.0) 下载对应架构的压缩包，用 [SHA256SUMS](https://github.com/erkamyaman/rust-anything/releases/download/v3.3.0/SHA256SUMS) 核对后，将 `DSH_RUST_ANYTHING_BIN` 设为可信可执行文件的绝对路径。请在启动 DSH 的环境中设置，不要指向目标项目提供的脚本。 |

macOS/Linux 在首次使用前对**解压后的文件**算一次 SHA-256（macOS 用 `shasum -a 256`，Linux 用 `sha256sum`），与[来源清单](runtime/upstream-v3.3.0.json)中本平台的 `executableSha256` 比对。宿主检查程序自报的版本、MCP 身份和协议，只证明**版本兼容**，不证明是官方文件；插件不下载引擎，也不在每次调用时重复哈希。Windows 如需单独检查，请用**绝对路径**调用，`--version` 应输出 `rust-anything 3.3.0`。编译、录制和性能测量仍需目标项目自身的工具链和依赖。

不要同时再配置一个名为 `rust-anything` 的官方 MCP 服务器：两者会发布相同的 `mcp__rust-anything__*` 工具名和 `mcp:rust-anything` 提示词段落，重复注册会失败。

## 从只读分析开始

> 用 rust-anything 分析当前项目，推荐一个适合先迁移的函数。先不要改文件。

确认范围后，先录制原实现的行为，再编写这个单元的 Rust 版本，回放同一组用例。输出不一致时，继续使用原实现。单个函数或热点参见[函数迁移指南](skills/rust-anything/SKILL.md)；CLI、HTTP 服务和库参见[整应用迁移指南](skills/rust-anything/whole-app.md)；迁移中的编译错误、FFI 与 `unsafe` 审查、crate 与 feature 适配参见[迁移手册](skills/rust-anything/playbook.md)。

**语言支持。** 固定引擎识别九种语言：TypeScript/JavaScript、Python、C、Go、Ruby、Java、Kotlin、PHP 和 C#。九种语言的分析与桥接都已在本仓实测；PHP 桥接只接受顶层函数，PHP 与 C# 不支持 `--batch`。回放 PHP、C#、Kotlin 需要各自的语言工具链，所以"桥接成功"不等于"回放通过"。

**审批规则。** DSH 中的原生工具名为 `mcp__rust-anything__<上游名称>`。在引擎工具中，只有 `analyze` 和 `map` 且上游三个标记同时为 `readOnlyHint=true`、`destructiveHint=false`、`openWorldHint=false` 才免审批。名称未知、标记缺失或不一致时一律走现有单次审批；当前其余 20 个工具均须批准。两个提示模板通过只读的 `rust_anything_prompt` 获取，不是引擎工具执行。策略为 `never` 时，需要审批的调用会被**拒绝**，不是自动批准；不要改用 CLI 绕过拒绝。录制和回放会运行应用代码，只对可信项目执行。 SDK 自动化请通过正常的 `session/prompt` 轮次调用写入工具，并接入宿主 `approval/request`；不要在轮次外直接调用 `execute`。对一个工作负载的热点迁移，可用原生 `go` 在一次授权调用中执行一轮；`gate` 可合并就绪检查。单次许可不延续到下一调用。

### 如何确认跑的是 Rust，而不是原版

`app_record.run` 传**参数数组**（如 `["python", "cli.py"]`）；`app_replay.build` 传**一条命令行字符串**（如 `"./correct.exe"`）。两者都省略时复用上一次录制：`run` 取已保存的命令，`app_replay` 不带 `build` 就运行录下来的原命令；从来没录制过则直接报错，不会去猜。**库**是唯一必须省略 `build` 的情况：用例通过各单元的绑定回放，传命令行字符串会被拒绝。

要看结果，不要只看传输。引擎返回 `build`、`passed`、`total`、`skipped`、`failures`、`fallback` 和报告路径；工具调用正常结束不等于移植成功。`fallback`（`cases`、`total`、`rate`、`names`）列出还原样交回原程序的用例，所以 **2/2 通过但 fallback 为 100% 时，两条用例都是原程序回答的，不是 Rust**。`fallback: null` 表示构建根本未报告回退率——应照此说明，不要写成 0。

无效值现在会在审批前报错：参数拼错或类型不对、`run` 为空、端口不在 1–65535、`timeout` 或 `pace` 为负。引擎用 `u64`/`u16` 读取这些字段，超出范围的值被静默丢弃，结果就是 HTTP 录制退化成 CLI 录制、负超时变成默认 30 秒。

Windows 会话可选择「**工作区内修改**」（`/permission workspace-write`）启用单次审批；默认「完全权限」预设反而关闭审批。此沙箱下，需要编译的单元操作将 Cargo 目标放在 `<crate>/.rust-anything/target`，组合操作放在 `<项目>/rust/.rust-anything/target`。这不会自动安装编译器或下载依赖。如果 crates.io 报 `SEC_E_NO_CREDENTIALS`，请使用已经准备好的离线依赖或恢复可信的注册表/TLS 访问，不要关闭证书校验。

固定引擎的 Python 单元操作先试 `python3` 再试 `python`。若启动环境只找到 Windows 商店别名（`9009`），请从有可运行 Python 的环境启动 DSH，例如已激活的项目虚拟环境。`app_record.run[0]` 和 Python `profile` 的工作负载可直接写解释器绝对路径，但这不能覆盖单元 `record`、`go`、`fuzz` 的内部解释器。适配器不修改全局 `PATH`。

## 大项目的资源限制

仅在启动 **DSH 宿主** 的环境中设置，重新加载插件后生效；只接受无前导零的正十进制整数。大小限制针对引擎进程的输出，不限制磁盘上的录制文件。

| 设置 | 默认值 | 有效范围 |
| --- | ---: | ---: |
| `DSH_RUST_ANYTHING_STARTUP_TIMEOUT_MS` | 15000 | 1–120000 |
| `DSH_RUST_ANYTHING_REQUEST_TIMEOUT_MS` | 600000 | 1–3600000 |
| `DSH_RUST_ANYTHING_STDOUT_MAX_BYTES` | 16777216 | 1–67108864 |
| `DSH_RUST_ANYTHING_STDERR_MAX_BYTES` | 8192 | 1–65536 |

超时、取消或输出被截断，不代表没有写文件。先检查目标项目的录制、构建文件或报告，再决定是否提高限制并重跑。

**从早期 3.3.x 升级：** 用新包在**原来的 profile** 执行上面的安装命令，然后重载插件。升级会替换组合包，不会重复注册，也不改动系统 CLI。

## 复测

从可写的源码或解包目录运行下面的命令。测试需要 Node.js 22.14+、Rust 工具链（含 `cargo`、`rustc` 和链接器）；macOS/Linux 还需按上表设置原版 `DSH_RUST_ANYTHING_BIN`。

```sh
npm test
```

[测试](test/parity.test.cjs)核对上游 22 个工具的名称与参数、两个原生提示词的三种调用，以及成功和出错时的行为。它还录制一个 JavaScript CLI，并分别对两个 Rust 构建回放。按 Unicode 标量值计数的实现通过 **2/2** 个用例；按 UTF-8 字节计数的实现只通过 **1/2**（输入 `é🦀` 时，原程序输出 `2`，字节计数版本输出 `6`）。

[适配层测试](test/adapter.test.cjs)覆盖工具注册、提示和审批结果；[运行时测试](test/runtime.test.cjs)覆盖超时、取消、输出截断和并发工作区。回放测试还编译生成的 Rust 入口回退模块，验证两条录制用例。技能本身由[五条中文验收场景](docs/acceptance-zh.md)约束：PHP 单元迁移、所有权编译错误、FFI 缓冲区审查、回放全过但全回退时，DSH 必须识别什么、给出什么结论。各平台结果见 [CI 记录](https://github.com/lonyness/dsh-rust-anything/actions/workflows/test.yml)；CI 通过不等于完整桌面宿主实测。

[来源记录](runtime/PROVENANCE.md)列有上游提交、原始文件和 SHA-256 校验和。上游代码和指南采用 [MIT 许可证](LICENSE)。

要移除此集成，可在「插件」页停用或移除组合包。这不会卸载系统 CLI，也不会删除已迁移的项目或录制结果。
