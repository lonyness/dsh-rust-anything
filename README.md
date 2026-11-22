<p align="center"><a href="https://github.com/erkamyaman/rust-anything"><img width="112" height="112" alt="rust-anything" src="https://raw.githubusercontent.com/erkamyaman/rust-anything/c0862b8696b51779f4b32d16ad57b3601f75fb12/docs/assets/logo.png"></a></p>

<h1 align="center">rust-anything for DeepSeek Harness</h1>

[**Download v3.3.0**](https://github.com/lonyness/dsh-rust-anything/releases/tag/v3.3.0) · [Upstream project](https://github.com/erkamyaman/rust-anything)

**English** · [简体中文](README.zh-CN.md)

Migrate one function to Rust, then replay the original program’s inputs against it. The agent writes the Rust code; the native engine records behavior and reports differences. A passing replay covers the recorded cases, not every possible input.

This is an **unofficial DSH integration** based on [erkamyaman/rust-anything](https://github.com/erkamyaman/rust-anything) v3.3.0. The native engine and migration guides are the work of [Erkam Yaman](https://github.com/erkamyaman) and the [upstream contributors](https://github.com/erkamyaman/rust-anything/graphs/contributors). [This repository](https://github.com/lonyness/dsh-rust-anything) packages them for DeepSeek Harness; it does not reimplement the migration engine.

## Install the bundle

**Required host: DeepSeek Harness 0.2.2-rc.5.** The DSH release asset is [dsh-rust-anything-3.3.0.tgz](https://github.com/lonyness/dsh-rust-anything/releases/download/v3.3.0/dsh-rust-anything-3.3.0.tgz). Choose one installation method:

- **Plugins page:** Extract the archive. Install a local bundle using the absolute path of the directory containing `package.json`.
- **DSH CLI:** Install the downloaded archive directly. Replace the profile and absolute path in this Windows example:

  ```powershell
  dsh plugin --profile "my-profile" add "file:C:/Downloads/dsh-rust-anything-3.3.0.tgz"
  ```

Select and enable the bundle in **Plugins**. If the profile does not reload it, restart DSH and open a new session in the target project. There is no need to run `rust-anything setup` or replace a CLI on your `PATH`.

| Platform | Native engine |
| --- | --- |
| Windows x64 | Included at `runtime/win32-x64/rust-anything.exe`. The bundle ignores `DSH_RUST_ANYTHING_BIN` here. |
| macOS or GNU/Linux (x64 / arm64) | Not included. Download the matching archive from [upstream v3.3.0](https://github.com/erkamyaman/rust-anything/releases/tag/v3.3.0), verify it against [SHA256SUMS](https://github.com/erkamyaman/rust-anything/releases/download/v3.3.0/SHA256SUMS), then set `DSH_RUST_ANYTHING_BIN` to the absolute path of the trusted executable in the environment that launches DSH. Do not point it at a project-supplied script. |

To check the Windows CLI separately, run it by **absolute path** from the target project directory. `--version` should print `rust-anything 3.3.0`; `--help` lists the commands. Builds, recordings, and benchmarks still require the target project’s own toolchain and dependencies.

## Try a read-only analysis

> Use rust-anything to analyze this project and suggest one function to migrate first. Do not change any files.

Once you agree on the scope, record the original behavior, implement that unit in Rust, and replay the same cases. If the outputs differ, keep the original implementation active. See the [function and hotspot guide](skills/rust-anything/SKILL.md) or the [whole-app guide](skills/rust-anything/whole-app.md) for CLIs, HTTP services, and libraries.

**Approvals.** DSH exposes native tools as `mcp__rust-anything__<upstream_name>`. The `analyze` and `map` tools and the two upstream prompts (via `rust_anything_prompt`) are read-only. The other 20 native tools require host approval because they can write files or run workloads. Under `never`, calls requiring approval are **denied**, not auto-approved. Do not retry them through the CLI. Recording and replay execute application code: only run them on projects you trust.

## Verify on Windows x64

From a writable copy of the extracted bundle, with Node.js, `rustc`, and a linker installed, run:

```sh
node --test test/parity.test.cjs
```

The [suite](test/parity.test.cjs) checks the names and parameters of all 22 upstream tools, three calls to the two native prompts, and success and error handling. It also records a JavaScript CLI and replays its inputs against two Rust builds. Counting Unicode scalar values matches **2/2** cases; counting UTF-8 bytes matches only **1/2** (for `é🦀`, the original prints `2` and the byte counter prints `6`).

[Provenance](runtime/PROVENANCE.md) lists the upstream commit, original files, and SHA-256 checksums. The upstream code and guides are distributed under the [MIT license](LICENSE).

To remove the integration, disable or remove the bundle in **Plugins**. This does not uninstall a system CLI or delete migrated projects or recordings.
