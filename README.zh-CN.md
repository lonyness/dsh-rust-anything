<p align="center"><a href="https://github.com/erkamyaman/rust-anything"><img width="112" height="112" alt="rust-anything" src="https://raw.githubusercontent.com/erkamyaman/rust-anything/c0862b8696b51779f4b32d16ad57b3601f75fb12/docs/assets/logo.png"></a></p>

<h1 align="center">适用于 DeepSeek Harness 的 rust-anything</h1>

[**下载插件 3.3.1**](https://github.com/lonyness/dsh-rust-anything/releases/download/v3.3.1/dsh-rust-anything-3.3.1.tgz) · [更新记录](CHANGELOG.md) · [上游项目](https://github.com/erkamyaman/rust-anything)

[English](README.md) · **简体中文**

先选一个函数迁到 Rust，再用原程序录下的输入检验新实现。代理负责编写 Rust，原生引擎负责录制行为、回放和报告差异。回放通过说明新实现匹配已录制的用例，不代表所有输入都等价。

这是基于 [erkamyaman/rust-anything](https://github.com/erkamyaman/rust-anything) v3.3.0 的 **非官方 DSH 适配**。原生引擎和迁移指南来自 [Erkam Yaman](https://github.com/erkamyaman) 与[上游贡献者](https://github.com/erkamyaman/rust-anything/graphs/contributors)；[本仓库](https://github.com/lonyness/dsh-rust-anything) 将它们打包接入 DeepSeek Harness，没有重新实现迁移引擎。

## 安装组合包

**插件 3.3.1 · 原生引擎 3.3.0。** 此版声明的 DSH 范围是 `>=0.2.2-rc.5 <0.3.0-0`，不是所有未来版本的实测保证。获取与所需插件版本匹配的 `.tgz`；从本源码打包请在仓库根目录运行 `npm pack --ignore-scripts`（无需安装 npm 依赖）。旧版发行包不含此修复。

- **插件页：** 解压组合包，在「插件」页安装本地组合包，输入含 `package.json` 的目录绝对路径。
- **DSH CLI：** 直接安装下载的压缩包。以下是 Windows 示例，请替换为自己的 profile 名称和文件绝对路径：

  ```powershell
  dsh plugin --profile "my-profile" add "file:C:/Downloads/dsh-rust-anything-3.3.1.tgz"
  ```

在「插件」页选中并启用组合包。如果当前 profile 未热加载，重启 DSH，再到目标项目打开新会话。无需运行 `rust-anything setup`，也不用替换 `PATH` 中的 CLI。

| 平台 | 原生引擎 |
| --- | --- |
| Windows x64 | 已内置于 `runtime/win32-x64/rust-anything.exe`。此平台不使用 `DSH_RUST_ANYTHING_BIN`。 |
| macOS 或 GNU/Linux（x64 / arm64） | 未内置。从[上游 v3.3.0 发布页](https://github.com/erkamyaman/rust-anything/releases/tag/v3.3.0) 下载对应架构的压缩包，用 [SHA256SUMS](https://github.com/erkamyaman/rust-anything/releases/download/v3.3.0/SHA256SUMS) 核对后，将 `DSH_RUST_ANYTHING_BIN` 设为可信可执行文件的绝对路径。请在启动 DSH 的环境中设置，不要指向目标项目提供的脚本。 |

如需单独检查 Windows CLI，请在目标项目目录用**绝对路径**调用。`--version` 应输出 `rust-anything 3.3.0`；`--help` 可列出子命令。编译、录制和性能测量仍需目标项目自身的工具链和依赖。

## 从只读分析开始

> 用 rust-anything 分析当前项目，推荐一个适合先迁移的函数。先不要改文件。

确认范围后，先录制原实现的行为，再编写这个单元的 Rust 版本，回放同一组用例。输出不一致时，继续使用原实现。单个函数或热点参见[函数迁移指南](skills/rust-anything/SKILL.md)；CLI、HTTP 服务和库参见[整应用迁移指南](skills/rust-anything/whole-app.md)。

**审批规则。** DSH 中的原生工具名为 `mcp__rust-anything__<上游名称>`。`analyze`、`map` 和两个上游提示词（通过 `rust_anything_prompt` 读取）均为只读。其余 20 个原生工具可能写文件或执行工作负载，必须获得宿主批准。策略为 `never` 时，需要审批的调用会被**拒绝**，不是自动批准；不要改用 CLI 绕过拒绝。录制和回放会运行应用代码，只对可信项目执行。 SDK 自动化请通过正常的 `session/prompt` 轮次调用写入工具，并接入宿主 `approval/request`；不要在轮次外直接调用 `execute`。对一个工作负载的热点迁移，可用原生 `go` 在一次授权调用中执行一轮；`gate` 可合并就绪检查。单次许可不延续到下一调用。

## 大项目的资源限制

仅在启动 **DSH 宿主** 的环境中设置，重新加载插件后生效；只接受无前导零的正十进制整数。大小限制针对引擎进程的输出，不限制磁盘上的录制文件。

| 设置 | 默认值 | 有效范围 |
| --- | ---: | ---: |
| `DSH_RUST_ANYTHING_STARTUP_TIMEOUT_MS` | 15000 | 1–120000 |
| `DSH_RUST_ANYTHING_REQUEST_TIMEOUT_MS` | 600000 | 1–3600000 |
| `DSH_RUST_ANYTHING_STDOUT_MAX_BYTES` | 16777216 | 1–67108864 |
| `DSH_RUST_ANYTHING_STDERR_MAX_BYTES` | 8192 | 1–65536 |

超时、取消或输出被截断，不代表没有写文件。先检查目标项目的录制、构建文件或报告，再决定是否提高限制并重跑。

**从 3.3.0 升级：** 用新包在**原来的 profile** 执行上面的安装命令，然后重载插件。Windows x64 隔离配置实测会用 3.3.1 替换旧版，不重复注册组合包，也不替换系统 CLI。

## 复测

从可写的源码或解包目录运行下面的命令。测试需要 Node.js 22.14+、Rust 工具链（含 `cargo`、`rustc` 和链接器）；macOS/Linux 还需按上表设置原版 `DSH_RUST_ANYTHING_BIN`。

```sh
npm test
```

[测试](test/parity.test.cjs)核对上游 22 个工具的名称与参数、两个原生提示词的三种调用，以及成功和出错时的行为。它还录制一个 JavaScript CLI，并分别对两个 Rust 构建回放。按 Unicode 标量值计数的实现通过 **2/2** 个用例；按 UTF-8 字节计数的实现只通过 **1/2**（输入 `é🦀` 时，原程序输出 `2`，字节计数版本输出 `6`）。

[适配层测试](test/adapter.test.cjs)覆盖工具注册、提示和审批结果；[运行时测试](test/runtime.test.cjs)覆盖超时、取消、输出截断和并发工作区。回放测试还编译生成的 Rust 入口回退模块，验证两条录制用例。各平台结果见 [CI 记录](https://github.com/lonyness/dsh-rust-anything/actions/workflows/test.yml)；CI 通过不等于完整桌面宿主实测。

[来源记录](runtime/PROVENANCE.md)列有上游提交、原始文件和 SHA-256 校验和。上游代码和指南采用 [MIT 许可证](LICENSE)。

要移除此集成，可在「插件」页停用或移除组合包。这不会卸载系统 CLI，也不会删除已迁移的项目或录制结果。
