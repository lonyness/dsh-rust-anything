# rust-anything v3.3.0 provenance

[Release v3.3.0](https://github.com/erkamyaman/rust-anything/releases/tag/v3.3.0) points to [commit c0862b8696b51779f4b32d16ad57b3601f75fb12](https://github.com/erkamyaman/rust-anything/commit/c0862b8696b51779f4b32d16ad57b3601f75fb12).

The [Windows x64 ZIP](https://github.com/erkamyaman/rust-anything/releases/download/v3.3.0/rust-anything-v3.3.0-x86_64-pc-windows-msvc.zip) (5,307,263 bytes) matched the publisher's [SHA256SUMS](https://github.com/erkamyaman/rust-anything/releases/download/v3.3.0/SHA256SUMS) before extraction: `9974932da25ee4cbb1a50ded3e57b2f2a9d0c089691bc64f666c38eb03802b9b`.
Only the unmodified archive member `rust-anything-v3.3.0-x86_64-pc-windows-msvc/rust-anything.exe` is bundled. The [machine-readable pins](upstream-v3.3.0.json) identify all five platform/architecture pairs, the exact archive and executable member, and **separate SHA-256s** for the compressed file and extracted bytes. Each archive was downloaded from that tag and checked against the publisher’s `SHA256SUMS` before hashing its executable. A runtime `--version`/MCP handshake checks compatibility, **not** official file identity. On macOS/Linux, verify the archive and extracted executable against the matching pins before setting the explicit absolute path; the plugin does not download, search `PATH` or hash it per call.

## Maintainer release gate (from the checkout)

With GitHub CLI, Python 3.9+ and npm, use a fresh destination. You can also supply an existing directory containing the exact five official archives and `SHA256SUMS`; the checker itself is offline. On Windows use `py -3` in place of `python3`.

```sh
gh release download v3.3.0 -R erkamyaman/rust-anything -D ../official-3.3.0
python3 test/verify_release.py ../official-3.3.0 --pack-to ../candidate
# Recheck the exact file intended for installation/release; do not repack after this.
python3 test/verify_release.py ../official-3.3.0 --tgz ../candidate/dsh-rust-anything-3.3.4.tgz
```

The gate compares `SHA256SUMS`, each archive and its member with the pins, and checks the Windows EXE in the checkout **before** `npm pack --ignore-scripts`. It then opens the actual `.tgz`, checks its Windows EXE, provenance and package identity, and only then moves it out of staging and prints its SHA-256. Any mismatch exits nonzero: do not distribute a raw `npm pack` or a different file. This is a byte comparison against the pinned publisher release, not a claim of independent code signing.

The official v3.3.0 binaries do not render identical prompt text on every OS. The [upstream prompt renderer](https://github.com/erkamyaman/rust-anything/blob/c0862b8696b51779f4b32d16ad57b3601f75fb12/src/mcp_prompts.rs#L33-L79) removes YAML front matter from LF guides, but not the CRLF guide embedded in the Windows binary. The [protocol snapshots](../test/upstream-v3.3.0.json) pin these original Windows and Unix responses separately, before the DSH adapter removes the standalone CLI fallback.

| Bundled path | Upstream source | SHA-256 |
|---|---|---|
| `runtime/win32-x64/rust-anything.exe` | ZIP member above | `7cf46ddfcc987f3ccd5bb501130254b765fb3690b0494ba1a65b84f872254183` |
| `skills/rust-anything/SKILL.md` | [plugin/skills/rust-anything/SKILL.md](https://github.com/erkamyaman/rust-anything/blob/c0862b8696b51779f4b32d16ad57b3601f75fb12/plugin/skills/rust-anything/SKILL.md) | `adcd6cd4b784ca41261af670713eb1843a3d42c2ecb3d4c27105bfe882f6c7aa` |
| `skills/rust-anything/whole-app.md` | [plugin/skills/rust-anything/whole-app.md](https://github.com/erkamyaman/rust-anything/blob/c0862b8696b51779f4b32d16ad57b3601f75fb12/plugin/skills/rust-anything/whole-app.md) | `6228c0d7f46d319092900d816cd55c057bc22075e497818d5c27be9ad9bcc37d` |
| `LICENSE` | [LICENSE](https://github.com/erkamyaman/rust-anything/blob/c0862b8696b51779f4b32d16ad57b3601f75fb12/LICENSE) | `f7c6d76768cf5bdcd8fbc9f4df6b040789ed9802707e49987dd8357a6bd92759` |

`skills/rust-anything/playbook.md` is adapter-authored, not upstream, and carries no upstream digest. `docs/acceptance-zh.md` and `docs/media/` are adapter-authored too.

The injected skill text is not byte-identical to `SKILL.md` on disk. Two edits are applied when it is registered: the standalone CLI-install fallback is removed (DSH must never be told to run it), and the language paragraph is replaced because the pinned guide still says the PHP and C# bridges do not exist while the pinned engine bridges both. The file bytes above stay pinned to the digest in this table.
