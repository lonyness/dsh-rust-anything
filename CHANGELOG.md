# Changelog

## 3.3.1 — DSH adapter update (engine: rust-anything 3.3.0)

- Use native DSH tool registration without an external MCP-client package. The 22 upstream tools, two prompt templates, CLI and migration guides are retained.
- Accept DSH versions from 0.2.2-rc.5 up to, but not including, the 0.3.0 prereleases. A version in range is eligible to load, not necessarily independently tested.
- Require a fresh host grant for operations that write or run workloads. Read-only classification uses the pinned engine’s safety annotations and defaults to requiring approval. Prompt input errors identify the invalid field. See the README for SDK turns and upstream multi-step commands.
- Support bounded host settings for startup and call timeouts, stdout and stderr. Diagnostics distinguish cancellation, timeouts, truncation and native failures; check for partial project changes before retrying.
- Add adapter and runtime regression tests alongside real record/replay tests, and a Windows/Linux/macOS CI workflow. See [verification](README.md#verify).

**升级说明：** 本次只更新插件适配层，不升级或替换系统 CLI。请安装新的 `dsh-rust-anything-3.3.1.tgz` 并重载插件。默认资源限制不变；若使用 SDK 执行会写文件的工具，请通过正常会话轮次取得单次许可。详见[中文说明](README.zh-CN.md)。

## 3.3.0 — Initial DSH integration

First adapter release for the upstream v3.3.0 engine, with the Windows x64 executable and the original migration skills. See [asset provenance](runtime/PROVENANCE.md).
