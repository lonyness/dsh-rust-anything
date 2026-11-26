# Migration playbook (DSH adapter)

Read this when the mechanical loop stops carrying you: a unit that will not compile,
a boundary that crosses into unsafe code, or a dependency decision. Together with
[SKILL.md](SKILL.md) it replaces guessing with a rule and a check.

Every claim below is grounded in the pinned engine (rust-anything 3.3.0) sources and
in runs recorded in this repository. Where a claim was **not** reproduced here, the
text says so — do not upgrade it into a promise.

## 1. Which languages this build handles

The engine detects nine languages and maps each to one bridge
(`src/lang/mod.rs:23-65`, `src/analyze.rs:74-84`):

| Language | Bridge | Artifacts |
| --- | --- | --- |
| TypeScript / JavaScript | napi-rs or wasm-bindgen | `.node` / wasm package |
| Python | PyO3 | extension module |
| C | C ABI | `cdylib` + `staticlib` |
| Go | cgo over the C ABI | C ABI crate |
| Ruby | Fiddle over the C ABI | C ABI crate |
| Java, Kotlin | JNI | `cdylib` + `rlib` |
| PHP | PHP FFI over the C ABI | C ABI crate + `php/src_rs.php` |
| C# | P/Invoke over the C ABI | C ABI crate + `cs/<File>Rs.cs` |

Split the four steps apart, because they have different evidence:

| Step | Status in this repository |
| --- | --- |
| analyze | All nine run: exit 0, correct unit and bridge. PHP, C# and Kotlin were probed for real (`analyze --lang php|kotlin|csharp`), not read off the source. |
| bridge | All nine run: exit 0 with real artifacts. PHP produced `php/src_rs.php`, C# produced `cs/CalcRs.cs`, Kotlin produced `java/probe/Calc.java` plus `java/rustanything/*.java`. |
| build | TypeScript/JavaScript, Python and C are built in this repository's tests, including a C ABI crate compiled offline. A PHP unit crate was **not** built here: this machine's sandbox denied the Cargo home and the crate download, which is a host limit, not an engine one. |
| record / replay | TypeScript/JavaScript and Python are recorded and replayed here. PHP, C# and Kotlin were **not** replayed: `php`, `dotnet` and `kotlinc` are absent on this machine (only a JDK 21 is present). Replay needs the original's own toolchain. |

Language-specific limits that will change your plan:

- **PHP**: the bridge takes top-level functions. A static or instance method stops the
  bridge with `the PHP bridge takes top-level functions for now`; keep that export in
  PHP and say so instead of promising a rewrite.
- **PHP and C#**: `--batch` is unavailable (`src/bridge.rs:1081-1086`). Do not plan a
  batched hot loop for these languages; port the loop whole inside one unit instead.
- **Kotlin**: the JNI artifacts are the Java artifacts (`src/codegen_kotlin.rs` re-exports
  `codegen_java`), so a Kotlin class becomes `<File>Kt` static methods with `@JvmStatic`.
  Detection prefers Kotlin only for a Gradle module whose sources are all `.kt`; a
  `pom.xml` or mixed sources stay Java unless you pass `--lang kotlin`.

## 2. Compile errors after a port

Most port compile errors are one mistake wearing four costumes: the Rust signature does
not match the ownership contract the original had. Decide the contract **before** you
silence the compiler, from four questions about the original:

1. Who creates the value?
2. Who still needs it after the call returns?
3. May the callee mutate it, and may two callers hold it at once?
4. Which thread touches it?

| Symptom | Ask about the original | Fix | Check |
| --- | --- | --- | --- |
| `E0382` / `E0507` use of moved value | Does the original share one mutable object, or hand out value semantics (JS/Python objects passed by reference, but often treated as copies)? | Shared mutable state: `Rc<RefCell<..>>`, or `Arc<Mutex<..>>` when threads. Value semantics: `clone()` **at the port boundary**. Read-only: pass `&T`. | `diff` for equality, `bench` for the clone (a clone inside the hot loop still passes, then shows up as slower). |
| `E0499` / `E0502` two mutable borrows | Is the first borrow still needed while the second starts, or can the value be taken out first? | Take a value, index or length out before re-borrowing; `split_at_mut` for two disjoint slices; or move the state into a struct method so one `&mut self` covers both. | `build`, then `diff`: the fix must not change output. |
| `E0597` / `E0515` / `E0716` lifetime, returning a reference to a local | Does the original return a reference into itself — a C `char*` into an internal buffer, a Python dict view, a Java sublist? | A cross-boundary port cannot return a borrow: return owned `String`/`Vec`, or fill a buffer the caller owns. Keep borrows inside a single call. | `build` plus one non-ASCII replay case (see §3.3). |
| `E0277` `Send`/`Sync` not satisfied | Is the original actually concurrent, or single-threaded with a callback? | Single-threaded callback: `Box<dyn FnMut(..)>`, no `Send` bound. Truly concurrent: `Arc<Mutex<..>>` and `'static`. Never `unsafe impl Send` to make the error go away. | For `unsafe impl`: §3 review and `gate`. For the others: `diff`. |

Scenario sketches for the four rows:

- **Ownership move.** A PHP `normalize($rows)` receives an array by value and the caller
  reuses `$rows` afterwards. PHP arrays are copy-on-write, so the contract is value
  semantics: the port takes `Vec<Row>` or clones at the boundary — not `&mut Vec<Row>`.
- **Mutable borrow conflict.** A Java method reads `this.cache.size()` and then adds to
  the same map. The borrow conflict means the port should read the length into a local
  first, or expose one method that owns both operations.
- **Lifetime.** A C function returns `char*` pointing into its own static buffer. The
  port must return an owned `String` (or take an out-buffer); returning `&'a str` to a
  caller that outlives the buffer is what `E0515` is telling you.
- **Thread constraint.** A Go handler spawns a goroutine that mutates a shared map. The
  Rust port needs `Arc<Mutex<..>>` and a `'static` capture; if the original was actually
  one goroutine at a time, a `RefCell` inside one call is enough and cheaper.

## 3. Reviewing the boundary: FFI and unsafe

The generated C ABI (`src/codegen_ffi.rs`, shared by C, Go, Ruby, Java and Kotlin,
and used underneath PHP and C#) already fixes several of these decisions. Read the
generated `src/lib.rs` and the host wrapper before reviewing hand-written code.

| # | Precondition | Guaranteed by | What to check |
| --- | --- | --- | --- |
| 1 | **Ownership and the free-er.** Inputs are copied on entry (`CStr::from_ptr(..).to_string_lossy()`): the caller keeps ownership, needs no free, and must keep the buffer alive for the duration of the call. Output is allocated by Rust (`CString::into_raw`) and **must** be freed with `rust_anything_free`. | Protocol, enforced by the host wrapper (`php/src_rs.php`, `cs/<File>Rs.cs`, `java/rustanything/*Wire.java`). | The wrapper calls `rust_anything_free` on every return path. Freeing with the host allocator (`free()`, `Marshal.FreeHGlobal`, a GC finalizer) is a heap mismatch — blocker. |
| 2 | **Pointer lifetime.** The engine stores no pointer between calls. A batch index (`<FnIndex>`) is the exception: it is `Box::into_raw` and needs an explicit close/`Drop`. | Rust (engine) for the entry; your port for any handle you add. | Any `Box::into_raw`, `mem::forget` or field holding a raw pointer has a documented owner and a release path. |
| 3 | **Buffer length units.** The C ABI passes NUL-terminated strings; no length travels with them. PHP strings are byte arrays, C# and Java strings are UTF-16. | Host wrapper, per call. | Length was never copied from the host language: `as_bytes().len()` and `encode_utf16().count()` differ. Test with a non-ASCII case; a `len()` that only works for ASCII is a silent truncation. |
| 4 | **Threads and callbacks.** The generated entry has no `Send`/`Sync` bound; JNI runs on the caller's Java thread. | Your port. | No `static mut`. Shared state is `Mutex`/`OnceLock`. A callback trampoline wraps the call in `catch_unwind(AssertUnwindSafe)` and keeps its boxed closure alive in a guard, so a panic cannot leak or run after free. |
| 5 | **Errors and panics across the boundary.** The entry wraps the call in `catch_unwind` and answers `{"ok":..}`, `{"error":..}` or `{"panic":..}`. | Rust (engine). | The host handles both `error` and `panic`. Panic is not control flow. Port code returns `Err` for bad input instead of `unwrap`/`expect` — a panic the engine catches still means the case failed. |
| 6 | **Who guarantees the safety.** | Named per line. | Every review line names Rust, the host wrapper, or the documented caller protocol. An unassigned precondition is a **blocker**: redesign before porting, do not paper over it with a comment. |

Report a review as a table — precondition, guaranteed by, evidence (the generated
wrapper line, the replay case that exercises it, the `gate` result) — plus one line per
blocker. "Looks fine" is not a review.

## 4. Crate and feature fit

The engine's crate advice is a static library-name to crate table with a
`good`/`partial`/`none` fit (`src/crates.rs`, surfaced by `analyze`). It does **not**
read your `Cargo.toml`, so it cannot know your versions, features or MSRV, and the
crates it generates pin `rust-version` to the engine's own minimum — not to yours.

Before recommending anything, read the target project:

- `Cargo.toml` — `[dependencies]`, `[features]`, `rust-version`, `edition`
- `Cargo.lock` — what is actually resolved today
- `rust-toolchain.toml` and `.cargo/config.toml` — pinned toolchain, target triples

Then put every recommendation in one of four buckets and say which:

| Bucket | What to say |
| --- | --- |
| Usable now | Already in the lockfile, feature enabled, target supported. No change. |
| Needs a version bump | Name the current constraint, the version you need, and why. A changed `Cargo.lock` is a review item — never bump it silently. |
| Needs a feature or a target | Name the feature, or the target triple, and the cost (binary size, compile time). |
| Not usable | MSRV, platform, or an unsafe policy forbids it. Offer the alternative instead. |

Bridging choices are a fit question too: napi-rs versus wasm-bindgen depends on whether
the host is Node or a browser; PyO3 needs `abi3` or the exact interpreter; the generated
Java/Kotlin crate already pins `jni = "0.21"`.
