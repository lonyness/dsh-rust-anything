# Changelog

## Unreleased — not yet published (engine: rust-anything 3.3.0)

- Reject the arguments the pinned engine would silently reinterpret: `app_record.port` outside `1..65535`, negative `timeout`/`pace`, and an `app_record.run` whose array is empty or starts blank. An out-of-range port made HTTP recording look like a CLI recording; a negative timeout fell back to the default and a negative pace kept the old value; a blank `run` reused the previous command instead of the argument given. Refused before approval, with the field and the value it received.
- Say what a replay result does and does not prove: `app_record.run` and `app_replay.build` are omitted to reuse the last recording, a library's cases replay through each unit's bindings so `build` does not apply, and `passed`/`total` must be read together with `skipped`, `failures` and `fallback`. A build that reports no fallback rate is reported as such, not as zero.
- READMEs open with what the engine actually decides and include a real `app_replay` report, with its source file and digest recorded in `docs/media/PROVENANCE.md`.
- The release checker now requires the archive's members to equal what `npm pack --dry-run` would publish, compares every member with `git HEAD`, and runs the packaged test suite from the extracted archive; `--self-check` proves the comparator still rejects extra, missing and tampered members.

## 3.3.4 — Stable DSH adapter (engine: rust-anything 3.3.0)

- Includes the [3.3.3-rc.1 prerelease](https://github.com/lonyness/dsh-rust-anything/releases/tag/v3.3.3-rc.1): the final-package provenance gate and the narrow approval exemption remain in place.
- Validate the pinned tools' argument names, required fields, types, array elements and enum values before requesting approval. A malformed `app_replay.build` no longer silently runs the original; omit it for a baseline or pass one nonblank command-line **string** to test a build.
- Windows `workspace-write` builds use a target local to the selected crate/project rather than the shared `%LOCALAPPDATA%` cache. The sandbox and one-call approval remain in force. Python error `9009` now explains the interpreter requirement; no global PATH, CLI or TLS settings are changed.

## 3.3.3-rc.1 — GitHub prerelease (engine: rust-anything 3.3.0)

- Pin both archive and executable digests for all five official release assets. The maintainer gate checks the raw Windows EXE before packing and again inside the final `.tgz`; runtime compatibility checks do not authenticate external macOS/Linux binaries.
- Limit approval-free native calls to `analyze` and `map` **with** their expected safety annotations. Unknown tools and missing or conflicting hints require a fresh one-call grant. No upstream engine, guide or tool protocol changes.

## 3.3.2 — Plugin display and prompt sanitation (engine: rust-anything 3.3.0)

- Add the bundle's Plugin Manager display resources: English and Chinese titles and descriptions, an original icon, and one-image detail pages. The descriptions state platform support, approval behavior, build prerequisites and limits.
- Strip the standalone CLI install fallback from prompt-template output, matching the bundled skill, so neither channel tells the model to install or call the CLI. The upstream guide and prompt files on disk stay unchanged.

## 3.3.1 — DSH adapter update (engine: rust-anything 3.3.0)

- Use native DSH tool registration without an external MCP-client package. The 22 upstream tools, two prompt templates, CLI and migration guides are retained.
- Accept DSH versions from 0.2.2-rc.5 up to, but not including, the 0.3.0 prereleases. A version in range is eligible to load, not necessarily independently tested.
- Require a fresh host grant for operations that write or run workloads. Read-only classification uses the pinned engine’s safety annotations and defaults to requiring approval. Prompt input errors identify the invalid field. See the README for SDK turns and upstream multi-step commands.
- Support bounded host settings for startup and call timeouts, stdout and stderr. Diagnostics distinguish cancellation, timeouts, truncation and native failures; check for partial project changes before retrying.
- Add adapter and runtime regression tests alongside real record/replay tests, and a Windows/Linux/macOS CI workflow. See [verification](README.md#verify).

**升级说明：** 本次只更新插件适配层，不升级或替换系统 CLI。请安装新的 `dsh-rust-anything-3.3.1.tgz` 并重载插件。默认资源限制不变；若使用 SDK 执行会写文件的工具，请通过正常会话轮次取得单次许可。详见[中文说明](README.zh-CN.md)。

## 3.3.0 — Initial DSH integration

First adapter release for the upstream v3.3.0 engine, with the Windows x64 executable and the original migration skills. See [asset provenance](runtime/PROVENANCE.md).
