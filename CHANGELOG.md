# Changelog

## Unreleased

- Get a new machine ready in one pass instead of half a port: the injected guidance tells the agent to check `node`, `python3` and `cargo`/`rustc` before the first write, to present one install plan and wait for agreement, and to ask for a DSH restart afterwards, because the MCP process keeps the PATH DSH started with. `analyze`, `map` and `bridge` need none of it.
- Name the fix when a program is missing: `error: running cargo build: program not found`, `running node: …` and the other original-runtime cases now carry the install that resolves them. Verification: `node --test test/*.test.cjs` 26/26.

- The upstream documentation now lists this plugin as a community integration, merged from [erkamyaman/rust-anything#709](https://github.com/erkamyaman/rust-anything/pull/709). Both READMEs and `runtime/PROVENANCE.md` record the listing, its exact wording and the obligation it carries: the engine version named there moves with the pin.
- Both READMEs open with an explicit statement that this repository is a DeepSeek Harness plugin around the upstream rust-anything engine, not the upstream project and not published by it, followed by what the adapter maintains.
- Rewrite both READMEs in a plainer register: the record/port/replay loop, what the adapter adds, a comparison with running the upstream CLI directly, and how a replay result is read. Promotional phrasing is removed; the technical content, the numbers and every stated limit stay. Adds `docs/media/banner.svg`.

## 3.3.5 — Skill corrections, migration playbook and a stricter release gate (engine: rust-anything 3.3.0)

- Reject the arguments the pinned engine would silently reinterpret: `app_record.port` outside `1..65535`, negative `timeout`/`pace`, and an `app_record.run` whose array is empty or starts blank. An out-of-range port made HTTP recording look like a CLI recording; a negative timeout fell back to the default and a negative pace kept the old value; a blank `run` reused the previous command instead of the argument given. Refused before approval, with the field and the value it received.
- Say what a replay result does and does not prove: `app_record.run` and `app_replay.build` are omitted to reuse the last recording, a library's cases replay through each unit's bindings so `build` does not apply, and `passed`/`total` must be read together with `skipped`, `failures` and `fallback`. A build that reports no fallback rate is reported as such, not as zero.
- READMEs open with what the engine actually decides and include a real `app_replay` report, with its source file and digest recorded in `docs/media/PROVENANCE.md`.
- The release checker now requires the archive's members to equal what `npm pack --dry-run` would publish, compares every member with `git HEAD`, and runs the packaged test suite from the extracted archive; `--self-check` proves the comparator still rejects extra, missing and tampered members.
- Correct the language support the pinned guide still contradicts: analyze and bridge were run on the pinned engine for PHP (`php-ffi`), C# (`dotnet-ffi`) and Kotlin (JNI, artifacts shared with Java), so the injected guide, the skill description and both locale descriptions now list all nine languages and the two real limits instead of saying the PHP and C# bridges do not exist. The upstream `SKILL.md` bytes are unchanged; the correction is applied at injection time, like the CLI fallback.
- Add [`skills/rust-anything/playbook.md`](skills/rust-anything/playbook.md): per-step evidence for the nine languages; diagnosis for `E0382`/`E0507`, `E0499`/`E0502`, `E0597`/`E0515`/`E0716` and `E0277`, each with a migration scenario and the ownership, call and thread question that picks the fix; a six-line boundary review for FFI/`unsafe` (owner and free-er, pointer lifetime, buffer length units, threads and callbacks, errors and panics) that must name which side guarantees each precondition; and crate/feature fit that reads the target's `Cargo.toml`, lockfile and toolchain instead of trusting the engine's static crate table.
- Add [`docs/acceptance-zh.md`](docs/acceptance-zh.md): five Chinese acceptance scenarios (PHP unit, ownership error, FFI buffer review, replay that passes at 100% fallback, Kotlin/C# boundary) with what DSH must recognize, what it must conclude, and what counts as a failure.

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
