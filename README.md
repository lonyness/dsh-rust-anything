<div align="center">
  <img src="docs/media/banner.svg" alt="rust-anything for DeepSeek Harness" width="100%">
</div>

<div align="center">

**A DeepSeek Harness plugin for the rust-anything engine: typed tools, gated writes, and a replay report you can audit case by case.**

[![release](https://img.shields.io/github/v/release/lonyness/dsh-rust-anything?style=flat-square&label=release&color=f4661e)](https://github.com/lonyness/dsh-rust-anything/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/lonyness/dsh-rust-anything/test.yml?style=flat-square&label=CI)](https://github.com/lonyness/dsh-rust-anything/actions/workflows/test.yml)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.5%20%3C0.3.0--0-2f6feb?style=flat-square)](#platform-and-limits)
[![engine](https://img.shields.io/badge/engine-3.3.0%20pinned-8b949e?style=flat-square)](#compared-with-running-rust-anything-yourself)
[![tools](https://img.shields.io/badge/MCP%20tools-22-6e7681?style=flat-square)](#the-22-tools)
[![license](https://img.shields.io/badge/license-MIT-2f6feb?style=flat-square)](LICENSE)

<a href="#what-it-actually-does">What it does</a> ·
<a href="#60-second-start">Start</a> ·
<a href="#what-this-bundle-adds">What it adds</a> ·
<a href="#compared-with-running-rust-anything-yourself">vs upstream</a> ·
<a href="#read-the-proof">Proof</a> ·
<a href="#the-22-tools">Tools</a> ·
<a href="#approvals">Approvals</a> ·
<a href="#platform-and-limits">Limits</a> ·
<a href="README.zh-CN.md">简体中文</a>

</div>

---

## What it actually does

[rust-anything](https://github.com/erkamyaman/rust-anything) is a porting engine: it reads a repository, picks the units worth rewriting, generates a Rust crate for one of them, and then replays cases it recorded from the *original* program against the Rust build. This bundle is the DeepSeek Harness front end for that engine. It adds no new powers over your files — it makes the engine callable as 22 typed tools and keeps the evidence attached to the work.

The loop the tools enforce:

| Step | Tool | What you get |
|:--|:--|:--|
| 1 | `analyze` / `map` | Units, port order, risks with `file:line`, and which bridge each unit needs. Read-only, no approval prompt. |
| 2 | `record` | Cases captured by running the original program — inputs, outputs, exit codes, written files. |
| 3 | `bridge` → `build` | A Rust crate with a real language bridge (napi, PyO3, C ABI, cgo, Fiddle, JNI, PHP FFI, P/Invoke). |
| 4 | `diff` → `bench` → `gate` | Case-by-case comparison, speed on your workload, and the definition-of-done check. |

Nothing is declared ported because it compiled. A unit counts when its recorded cases match, `gate` passes, and `bench` shows it is not slower as its callers call it.

**Who it is for:** you have a working program (or one hot path) in TypeScript/JavaScript, Python, C, Go, Ruby, Java, Kotlin, PHP or C#, and you want Rust without losing the behavior you already rely on.

## 60-second start

**1. Install the bundle** (stable **3.3.5**, engine **rust-anything 3.3.0**):

```bash
dsh plugin --profile "my-profile" add "file:C:/Downloads/dsh-rust-anything-3.3.5.tgz"
```

Or install it from the plugin page in the GUI, or from the plugin market by name. Download the tarball from [Releases](https://github.com/lonyness/dsh-rust-anything/releases/latest).

**2. Ask for something read-only first:**

> Analyze this repository with rust-anything. Give me the five units to port first, the risks, and the bridge each one needs. Do not modify any files.

`analyze` and `map` are the two tools allowed to run without an approval prompt, so this costs you nothing but tokens.

**3. Then approve one build.** The first write (`bridge`, `record`, `build`, …) asks once. Approve that call and the rest of the loop is normal work.

## What this bundle adds

The engine is the same; everything below is the adapter.

| Aspect | What it gives you |
|:--|:--|
| **Bundled engine** | Windows x64 ships the unmodified 3.3.0 executable, checksum pinned in `runtime/upstream-v3.3.0.json`. No install step, no PATH hunting, no runtime download. macOS and GNU Linux (x64/arm64) point at a binary you downloaded and verified yourself. |
| **Typed tools, not flags** | 22 MCP tools with JSON Schemas, exposed as `mcp__rust-anything__*`. The agent reads the contract instead of recalling CLI syntax, and the same catalog validates every call. |
| **Arguments checked before the prompt** | Anything wrong is refused before you are asked to approve: wrong types, unknown keys, missing required fields, bad enum values, and the traps the engine would silently reinterpret (see the comparison below). You get a refusal that names the field and the value, not a mystery result. |
| **One approval per call** | Only `analyze` and `map` skip approval, and only because the engine itself marks them read-only. The other 20 ask once each. Under `never`, they are denied. |
| **Sandbox-safe Cargo output** | Under Windows `workspace-write`, builds would otherwise write `%LOCALAPPDATA%\rust-anything\target` and be denied. The child process gets `CARGO_TARGET_DIR` inside the workspace instead — `<crate>/.rust-anything/target`, or `<project>/rust/.rust-anything/target` for composite calls. |
| **A skill that matches the engine** | The bundled skill states what the pinned engine can actually do — nine languages, with the real limits (PHP bridges top-level functions only, PHP and C# have no `--batch`) — plus a [migration playbook](skills/rust-anything/playbook.md): compile-error triage (E0382, E0507, E0499, E0502, E0597, E0515, E0716, E0277), FFI and `unsafe` review, and crate/feature matching against your own `Cargo.toml`. |
| **Evidence discipline in the prompt** | The injected guidance tells the agent to read `passed`/`total`/`skipped`/`failures`/`fallback` together, and that a `2/2` with a 100% fallback rate is not a Rust result. `fallback: null` means "not reported", never "0". |
| **A release you can check** | `test/verify_release.py` compares the packed tarball against the npm publish list, byte-compares every member against git `HEAD`, then unpacks and runs the test suite. Three-platform CI does the same on every push. |

## Compared with running rust-anything yourself

Same engine, different surroundings. This is the honest list of what changes when the engine runs inside DSH:

| Aspect | rust-anything CLI alone | This bundle inside DSH |
|:--|:--|:--|
| **Getting the engine** | Download per platform, unpack, keep on `PATH`, update by hand | Pinned 3.3.0 executable in the package (Windows x64), SHA-256 recorded; other platforms supply their own verified path via `DSH_RUST_ANYTHING_BIN` |
| **Invoking it** | Remember 22 subcommands and their flags | 22 typed tools; the model reads schemas instead of guessing |
| **Bad numbers** | `port: 70000` is dropped by `u16::try_from`, the HTTP request disappears, and recording silently falls back to CLI mode; `timeout: -5` becomes "no timeout given" and reverts to the configured 30 s; `pace: -5` keeps the old value | Refused before approval: `app_record.port: expected an integer from 1 to 65535, got 70000` |
| **Empty `run`** | `strings("run")` on an empty list reuses the previously recorded command — you think you re-recorded `php other.php`, you re-recorded the old one | Refused: a non-empty argv array whose first item names the program, or omit `run` on purpose |
| **Replay target** | `--build` passed where a string was expected is simply ignored by the engine; the run then replays through unit bindings and looks like a pass | Refused: `app_replay.build` must be one command-line string; a library must omit it |
| **Permission** | Whatever your shell allows | Every call approved once, read-only pair excepted; `never` denies the writes |
| **Windows build cache** | Writes outside the workspace, denied under `workspace-write` | `CARGO_TARGET_DIR` confined to the workspace |
| **Version drift** | npm and auto-update can move the engine under you | No auto-update, no PATH search, no download at runtime — the pinned version is what runs |
| **Telemetry** | — | None. The only network traffic is what your own build fetches. |

**What it deliberately does not change:** the engine's logic, its `SKILL.md` on disk (the two corrections happen at injection time, and [PROVENANCE](runtime/PROVENANCE.md) records both), your project files, or the promise that a finished port is behaviorally identical everywhere. It also will not upgrade the engine for you, even when a new one ships.

## Read the proof

<div align="center">
  <img src="docs/media/replay.png" alt="app_replay report: Build ./stats_probe.exe, Passed 6/6, Every case matches" width="820">
</div>

That is the engine's own report from a real DSH session, rendered from the saved file ([source and hash](docs/media/PROVENANCE.md)). A replay result is five numbers, not one:

- `passed` / `total` — cases that matched. `skipped` above zero means the run proved less than it looks.
- `failures` — each entry names the case and the diff. One failure is a failed port, not a rounding error.
- `fallback` — how much of the run was still answered by the original implementation. A `6/6` at a 100% fallback rate means the Rust code never ran. `null` means the build did not report it, which is not the same as `0`.

## The 22 tools

<details>
<summary><b>Full tool list by phase</b></summary>

| Phase | Tools |
|:--|:--|
| Look — no approval prompt | `map`, `analyze` |
| Plan | `profile`, `bridge`, `package` |
| Record and prove | `record`, `refresh`, `build`, `diff`, `bench`, `gate`, `report` |
| Switch a unit on or off | `shadow`, `enable`, `disable` |
| Speed | `go`, `fuzz` |
| Whole app | `app_record`, `app_replay`, `app_front_door`, `app_wire`, `app_lift` |

`rust_anything_prompt` is a read-only helper that returns the engine's own migration prompt.

</details>

## Approvals

- `analyze` and `map` need no approval, because the engine advertises them with `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.
- Every other call asks once, with the exact arguments. An approved call is not a standing permission.
- Nothing here bypasses the host: a denied tool stays denied. Restarting the loop through a terminal, `force`, or a skipped gate is not a workaround, and the skill says so.
- A refusal that names a field is the adapter doing its job — fix the argument rather than retrying.

## Platform and limits

| Platform | Engine |
|:--|:--|
| Windows x64 | Bundled. `DSH_RUST_ANYTHING_BIN` is ignored here on purpose, so the shipped executable is the one that runs. |
| macOS / GNU Linux, x64 or arm64 | Supply your own: download the `v3.3.0` asset from the [upstream release](https://github.com/erkamyaman/rust-anything/releases/tag/v3.3.0), verify it against `SHA256SUMS`, and set `DSH_RUST_ANYTHING_BIN` to its absolute path. If you build from source instead, expect `--version` to print `rust-anything 3.3.0`. |

Known limits, stated plainly:

- **Writes need a permissive sandbox.** On Windows use `/permission workspace-write`, otherwise builds and gates fail on the engine's cache directory.
- **Python units need a working interpreter.** `record` and `go` probe `python3`, then `python`. On a machine where `python` is the Windows Store stub you get `9009`; the adapter reports that, and you can pass an absolute interpreter as `app_record.run[0]`.
- **Dependency downloads can fail behind a proxy.** A build that reports `SEC_E_NO_CREDENTIALS` needs network or proxy configuration. Do not "fix" it by disabling TLS verification — the adapter will not do that for you.
- **Large repositories are bounded on purpose.** Four host variables tune the bridge without reopening the compiler to unbounded work:

| Variable | Default | Range |
|:--|--:|:--|
| `DSH_RUST_ANYTHING_STARTUP_TIMEOUT_MS` | 15000 | 1 – 120000 |
| `DSH_RUST_ANYTHING_REQUEST_TIMEOUT_MS` | 600000 | 1 – 3600000 |
| `DSH_RUST_ANYTHING_STDOUT_MAX_BYTES` | 16777216 | 1 – 67108864 |
| `DSH_RUST_ANYTHING_STDERR_MAX_BYTES` | 8192 | 1 – 65536 |

Confirmed by this repository's CI: the bundled engine reproduces Unicode behavior exactly (a case with `é🦀` yields 2 in the original and 6 in a byte-shifted reimplementation — the report names the difference instead of hiding it). Build and replay are tested end to end for TypeScript, Python and C; the other six languages are analyzed and bridged with real output, but their toolchains were not available in CI.

## Verify the download

```bash
python test/verify_release.py <upstream-v3.3.0-assets-dir> --tgz dsh-rust-anything-3.3.5.tgz
```

It checks the official upstream checksums, then that the tarball contains exactly the npm publish list, with every member byte-identical to git `HEAD`, and finally that the unpacked package passes `node --test test/*.test.cjs`. `--self-check` proves the checker itself accepts a correct set and rejects a tampered, extra or missing member. Contributing: `npm test` (Node 22.14+, Rust toolchain) — see [runtime/PROVENANCE.md](runtime/PROVENANCE.md#maintainer-release-gate-from-the-checkout).

## Docs

[Playbook](skills/rust-anything/playbook.md) · [Chinese acceptance scenarios](docs/acceptance-zh.md) · [Engine skill](skills/rust-anything/SKILL.md) · [Whole-app guide](skills/rust-anything/whole-app.md) · [Details](docs/DETAIL.md) · [Changelog](CHANGELOG.md) · [Tests](test/parity.test.cjs)

MIT licensed, matching the upstream engine. Unofficial integration: not affiliated with or endorsed by the rust-anything project. Remove with `dsh plugin --profile "my-profile" remove dsh-rust-anything`; nothing outside the bundle's directory is written except Cargo output under the workspace.
