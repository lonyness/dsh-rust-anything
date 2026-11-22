<p align="center"><a href="https://github.com/erkamyaman/rust-anything"><img width="112" height="112" alt="rust-anything" src="https://raw.githubusercontent.com/erkamyaman/rust-anything/c0862b8696b51779f4b32d16ad57b3601f75fb12/docs/assets/logo.png"></a></p>

<h1 align="center">rust-anything for DeepSeek Harness</h1>

[**Download plugin 3.3.2**](https://github.com/lonyness/dsh-rust-anything/releases/download/v3.3.2/dsh-rust-anything-3.3.2.tgz) · [Changelog](CHANGELOG.md) · [Upstream project](https://github.com/erkamyaman/rust-anything)

**English** · [简体中文](README.zh-CN.md)

Migrate one function to Rust, then replay the original program’s inputs against it. The agent writes the Rust code; the native engine records behavior and reports differences. A passing replay covers the recorded cases, not every possible input.

This is an **unofficial DSH integration** based on [erkamyaman/rust-anything](https://github.com/erkamyaman/rust-anything) v3.3.0. The native engine and migration guides are the work of [Erkam Yaman](https://github.com/erkamyaman) and the [upstream contributors](https://github.com/erkamyaman/rust-anything/graphs/contributors). [This repository](https://github.com/lonyness/dsh-rust-anything) packages them for DeepSeek Harness; it does not reimplement the migration engine.

## Install the bundle

**Plugin 3.3.2 · native engine 3.3.0.** The declared DSH range is `>=0.2.2-rc.5 <0.3.0-0`, not a claim that every future build has been tested. Use a `.tgz` matching the desired **plugin** version, or run `npm pack --ignore-scripts` from this checkout (no npm dependencies required). Older release assets do not contain these fixes.

- **Plugins page:** Extract the archive. Install a local bundle using the absolute path of the directory containing `package.json`.
- **DSH CLI:** Install the downloaded archive directly. Replace the profile and absolute path in this Windows example:

  ```powershell
  dsh plugin --profile "my-profile" add "file:C:/Downloads/dsh-rust-anything-3.3.2.tgz"
  ```

Select and enable the bundle in **Plugins**. If the profile does not reload it, restart DSH and open a new session in the target project. There is no need to run `rust-anything setup` or replace a CLI on your `PATH`.

| Platform | Native engine |
| --- | --- |
| Windows x64 | Included at `runtime/win32-x64/rust-anything.exe`. The bundle ignores `DSH_RUST_ANYTHING_BIN` here. |
| macOS or GNU/Linux (x64 / arm64) | Not included. Download the matching archive from [upstream v3.3.0](https://github.com/erkamyaman/rust-anything/releases/tag/v3.3.0), verify it against [SHA256SUMS](https://github.com/erkamyaman/rust-anything/releases/download/v3.3.0/SHA256SUMS), then set `DSH_RUST_ANYTHING_BIN` to the absolute path of the trusted executable in the environment that launches DSH. Do not point it at a project-supplied script. |

To check the Windows CLI separately, run it by **absolute path** from the target project directory. `--version` should print `rust-anything 3.3.0`; `--help` lists the commands. Builds, recordings, and benchmarks still require the target project’s own toolchain and dependencies.

Do not also add an official MCP server named `rust-anything`: it would publish the same `mcp__rust-anything__*` tool names and the `mcp:rust-anything` prompt section, and the duplicate registration fails.

## Try a read-only analysis

> Use rust-anything to analyze this project and suggest one function to migrate first. Do not change any files.

Once you agree on the scope, record the original behavior, implement that unit in Rust, and replay the same cases. If the outputs differ, keep the original implementation active. See the [function and hotspot guide](skills/rust-anything/SKILL.md) or the [whole-app guide](skills/rust-anything/whole-app.md) for CLIs, HTTP services, and libraries.

**Approvals.** DSH exposes native tools as `mcp__rust-anything__<upstream_name>`. The `analyze` and `map` tools and the two upstream prompts (via `rust_anything_prompt`) are read-only. The other 20 native tools require host approval because they can write files or run workloads. Under `never`, calls requiring approval are **denied**, not auto-approved. Do not retry them through the CLI. Recording and replay execute application code: only run them on projects you trust. SDK clients should use a normal `session/prompt` turn with host `approval/request` handling, not call mutating tool definitions directly outside a turn. Use upstream `go` for one hot-path migration pass or `gate` for a combined readiness check. A grant never carries over to another call.

## Limits for large projects

Set these in the **DSH host** environment and reload the plugin. Values must be positive decimal integers without leading zeroes. Byte limits apply to process output, not recordings on disk.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `DSH_RUST_ANYTHING_STARTUP_TIMEOUT_MS` | 15000 | 1–120000 |
| `DSH_RUST_ANYTHING_REQUEST_TIMEOUT_MS` | 600000 | 1–3600000 |
| `DSH_RUST_ANYTHING_STDOUT_MAX_BYTES` | 16777216 | 1–67108864 |
| `DSH_RUST_ANYTHING_STDERR_MAX_BYTES` | 8192 | 1–65536 |

A timeout, cancellation or truncated response does not roll back project files. Inspect the recording, build or report before increasing a limit or retrying.

**Upgrading from an earlier 3.3.x?** Use the same install command above with the new archive and the **same profile name**, then reload the plugin. Upgrading replaces the bundle without duplicating it and does not change any system CLI.

## Verify

Run the following in a writable checkout or extracted bundle. Tests need Node.js 22.14+, a Rust toolchain (`cargo`, `rustc` and a linker), and on macOS/Linux the original binary selected by `DSH_RUST_ANYTHING_BIN` as above.

```sh
npm test
```

The [suite](test/parity.test.cjs) checks the names and parameters of all 22 upstream tools, three calls to the two native prompts, and success and error handling. It also records a JavaScript CLI and replays its inputs against two Rust builds. Counting Unicode scalar values matches **2/2** cases; counting UTF-8 bytes matches only **1/2** (for `é🦀`, the original prints `2` and the byte counter prints `6`).

The [adapter tests](test/adapter.test.cjs) exercise DSH registration, prompts and approval outcomes; the [runtime tests](test/runtime.test.cjs) cover deadlines, cancellation, truncation and concurrent workspaces. The record/replay test also compiles the generated front-door fallback and replays both recorded cases. See [CI runs](https://github.com/lonyness/dsh-rust-anything/actions/workflows/test.yml) for each platform; a green job is not a full desktop-host test.

[Provenance](runtime/PROVENANCE.md) lists the upstream commit, original files, and SHA-256 checksums. The upstream code and guides are distributed under the [MIT license](LICENSE).

To remove the integration, disable or remove the bundle in **Plugins**. This does not uninstall a system CLI or delete migrated projects or recordings.
