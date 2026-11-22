<p align="center"><a href="https://github.com/erkamyaman/rust-anything"><img width="112" height="112" alt="rust-anything" src="https://raw.githubusercontent.com/erkamyaman/rust-anything/c0862b8696b51779f4b32d16ad57b3601f75fb12/docs/assets/logo.png"></a></p>

<h1 align="center">适用于 DeepSeek Harness 的 rust-anything</h1>

[**下载 v3.3.0**](https://github.com/lonyness/dsh-rust-anything/releases/tag/v3.3.0) · [上游项目](https://github.com/erkamyaman/rust-anything)

[English](README.md) · **简体中文**

先选一个函数迁到 Rust，再用原程序录下的输入检验新实现。代理负责编写 Rust，原生引擎负责录制行为、回放和报告差异。回放通过说明新实现匹配已录制的用例，不代表所有输入都等价。

这是基于 [erkamyaman/rust-anything](https://github.com/erkamyaman/rust-anything) v3.3.0 的 **非官方 DSH 适配**。原生引擎和迁移指南来自 [Erkam Yaman](https://github.com/erkamyaman) 与[上游贡献者](https://github.com/erkamyaman/rust-anything/graphs/contributors)；[本仓库](https://github.com/lonyness/dsh-rust-anything) 将它们打包接入 DeepSeek Harness，没有重新实现迁移引擎。

## 安装组合包

**宿主版本：DeepSeek Harness 0.2.2-rc.5。** 下载 DSH 组合包 [dsh-rust-anything-3.3.0.tgz](https://github.com/lonyness/dsh-rust-anything/releases/download/v3.3.0/dsh-rust-anything-3.3.0.tgz)，任选一种方式安装：

- **插件页：** 解压组合包，在「插件」页安装本地组合包，输入含 `package.json` 的目录绝对路径。
- **DSH CLI：** 直接安装下载的压缩包。以下是 Windows 示例，请替换为自己的 profile 名称和文件绝对路径：

  ```powershell
  dsh plugin --profile "my-profile" add "file:C:/Downloads/dsh-rust-anything-3.3.0.tgz"
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

**审批规则。** DSH 中的原生工具名为 `mcp__rust-anything__<上游名称>`。`analyze`、`map` 和两个上游提示词（通过 `rust_anything_prompt` 读取）均为只读。其余 20 个原生工具可能写文件或执行工作负载，必须获得宿主批准。策略为 `never` 时，需要审批的调用会被**拒绝**，不是自动批准；不要改用 CLI 绕过拒绝。录制和回放会运行应用代码，只对可信项目执行。

## 在 Windows x64 上复测

在解压后的可写组合包目录运行以下命令，需要 Node.js、`rustc` 和链接器：

```sh
node --test test/parity.test.cjs
```

[测试](test/parity.test.cjs)核对上游 22 个工具的名称与参数、两个原生提示词的三种调用，以及成功和出错时的行为。它还录制一个 JavaScript CLI，并分别对两个 Rust 构建回放。按 Unicode 标量值计数的实现通过 **2/2** 个用例；按 UTF-8 字节计数的实现只通过 **1/2**（输入 `é🦀` 时，原程序输出 `2`，字节计数版本输出 `6`）。

[来源记录](runtime/PROVENANCE.md)列有上游提交、原始文件和 SHA-256 校验和。上游代码和指南采用 [MIT 许可证](LICENSE)。

要移除此集成，可在「插件」页停用或移除组合包。这不会卸载系统 CLI，也不会删除已迁移的项目或录制结果。
