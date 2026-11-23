# v3.3.4 — final-package acceptance

| Artifact | Verified value |
| --- | --- |
| Plugin | `dsh-rust-anything-3.3.4.tgz`, 5,652,743 bytes |
| Plugin SHA-256 | `c3f3c2a69727d09c2367891288ec794fb87ec1e16afd5c5ba1b7674a9a6f2163` |
| Upstream | Unmodified `rust-anything` 3.3.0; [pinned archives and executable hashes](../runtime/upstream-v3.3.0.json) |
| Windows EXE in the upstream ZIP, checkout, tgz and installed plugin | `7cf46ddfcc987f3ccd5bb501130254b765fb3690b0494ba1a65b84f872254183` |

All five official archives and their executable members passed the [offline verifier](../runtime/PROVENANCE.md#maintainer-release-gate-from-the-checkout). All 24 packed files matched the checkout. The unmodified tgz passed; flipping an archive byte, changing the checkout or packed EXE, or removing or duplicating the packed EXE all failed verification. The pre-pack failures produced no candidate. `npm test` passed **26/26**, none skipped, in both the Windows checkout and the extracted archive.

## Real Windows DSH host

The [SDK driver](windows-sdk/run.ps1) installed that same tgz into **two independent, empty profiles**. Both ran the same DSH version, `0.2.2-rc.5` (also the declared minimum), Electron 44.7.0, host Node 24.21.0, fixture Node 22.14.0 and rustc 1.100.0. Only the model was scripted; calls used normal `session/prompt` turns. Each run recorded **12 turns and 7 distinct approval decisions** under `workspace-write` + `ask`; the SDK events matched the persisted session log. Neither run used a daily profile or its credentials.

| Check | Observed outcome in each profile |
| --- | --- |
| Discovery | Plugin active; 22 tools, two prompt templates and the skill visible. Skill, `port_unit` and read-only `analyze` worked. |
| One-call approval | Denied recording left no cases or launch marker. Granting `app_record` recorded `abc → 3` and `é🦀 → 2`; repeating identical record/replay calls asked again. Denials changed no sample files. |
| Explicit Rust target | `build: "./correct.exe"` returned `build: ["./correct.exe"]`, `passed: 2`, `total: 2`, `skipped: 0`, `failures: []`. Only the Rust marker changed; the on-disk report named the same executable. |
| Missing target | A granted `build: "./missing.exe"` failed naming that target (`os error 2`). Neither the original nor the Rust program ran. |
| Malformed target | Both an argv array and a blank string failed with a `build`/`string` diagnostic, **before approval**; the fixture tree did not change. An independent run of this regression against `3.3.3-rc.1` failed as expected: the old adapter incorrectly asked to execute the malformed call. |
| Confined Cargo build | An approved dependency-free C ABI build produced a real Windows DLL. The unit's `.rust-anything/target` contained the owner/lock files and compiled DLL; the published DLL in `target/release` matched byte-for-byte. The driver did not set `CARGO_TARGET_DIR`; no target directory appeared in the private profile's `%LOCALAPPDATA%/rust-anything`. |

Local audit-log SHA-256s: `731630b9b53261e9b1f5e681d075b5862ebe70f3e83e1c9ee1c7a472974917f4`, `9ae185db588ba8c9c794debffa58e9f6d35758a21c5a62ee51d419bcb726a003`. Raw session and project paths are not published.

To repeat on Windows x64 with DSH Desktop and a real Rust MSVC toolchain, use the **downloaded archive** (absolute path) and its SHA-256 above:

```powershell
pwsh -NoProfile -File ./test/windows-sdk/run.ps1 -Archive $absoluteTgz -Sha256 $sha -DesktopExe $absoluteDesktopExe
```

Both profiles ran on Windows. Cross-platform CI is not a macOS/Linux desktop install or a visual check of the GUI. The offline C ABI fixture does not establish that an unconfigured Python alias works, that Cargo can download crates, or that a full application has been migrated.
