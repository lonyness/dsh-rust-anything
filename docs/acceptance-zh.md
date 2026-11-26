# 中文技能验收场景

用于验收 `rust-anything` 技能在真实对话里的表现：把下面每条"用户提问"原样发给装了本插件的 DSH，
对照"应识别 / 应给出的结论"打分，命中"不合格判据"任一条即为不通过。

判据只依赖三样东西：技能注入的正文（`lib/index.js` 注入的 `SKILL.md` + `playbook.md`）、
工具返回的结构化字段（`analyze` 的 `units[].bridge`、`app_replay` 的 `passed/total/skipped/failures/fallback`）、
以及本机实际存在的工具链。任何一条判据都不要求 DSH 编造没跑过的结果。

---

## 场景 1：PHP 单元迁移（语言能力边界）

**用户提问**：「这个 PHP 项目里 `src/Calc.php` 的 `raAdd` 最慢，帮我迁到 Rust。」

**DSH 应识别**
- PHP 是被支持的语言：桥接是 `php-ffi`（C ABI + `php/src_rs.php`），CLI 侧 `analyze --lang php` 可以跑。
- 先 `analyze` 再 `bridge`，不要先写 Rust 代码。
- 原文里"`bridge` does not take PHP units yet"是过时说明，不能复述。

**应给出的结论**
- 能做的三步：分析（定位单元与桥接）、生成桥接（产出 C ABI crate 与 PHP 包装）、写 `port.rs`。
- 两条硬限制：桥接只接受**顶层函数**，静态/实例方法会报 `the PHP bridge takes top-level functions for now`；PHP 不支持 `--batch`。
- 回放要看机器：本机没有 `php` 时只能做到"构建 + 单元检查"，必须直说"没有 PHP 回放证据"，不能声称端到端通过。

**不合格判据**
- 说 PHP 不支持或只能留在 PHP（与实跑相反）。
- 承诺批量加速（PHP 无 `--batch`）。
- 声称"已回放通过"但机器上不存在 `php`。

---

## 场景 2：所有权编译错误（诊断规则，不是猜修法）

**用户提问**：「迁移后编译报 `E0382: borrow of moved value`，我直接加了 `.clone()` 就好了，继续吗？」

**DSH 应识别**
- 这是端口签名与原程序所有权契约不一致，不是"缺一个 clone"。
- 需要先回答四个问题：谁创建、调用后谁还要用、谁可改、哪个线程。

**应给出的结论**
- 判定原语义：PHP 数组按值（copy-on-write）→ 值语义，边界处 `clone` 合法；JS/Python 共享同一对象 → 共享可变，`Rc<RefCell<..>>`/`Arc<Mutex<..>>`；只读 → `&T`。
- `clone` 只能放在端口边界，不能放进热循环；放错位置 `diff` 仍通过、`bench` 会变慢。
- 给出验证路径：`diff` 比对输出，`bench` 看是否真的更快，`gate` 收口。

**不合格判据**
- 只说"加 clone 就行"或"报错就 clone"，不区分共享可变与值语义。
- 未提 `bench`（clone 进热循环是这套工具里唯一能抓到的代价）。
- 建议 `unsafe`、`transmute`、`static mut` 绕过借用检查。

---

## 场景 3：FFI 缓冲区审查（结论必须交代"谁保证"）

**用户提问**：「生成的 C ABI 包装里 `rust_anything_call` 返回的字符串，我在 C# 里用 `Marshal.FreeHGlobal` 释放了，可以吗？」

**DSH 应识别**
- 返回值是 `CString::into_raw` 分配的，只能由 `rust_anything_free` 释放；`Marshal.FreeHGlobal` 是宿主分配器，属堆不匹配（UB）。
- 输入侧相反：入口用 `CStr::from_ptr(..).to_string_lossy()` 立即复制，调用方保留所有权且**不需要**释放。

**应给出的结论**（逐项，缺项即不完整）
1. 所有权与释放方：输入归调用方，输出归 Rust，释放走 `rust_anything_free`。
2. 指针有效期：输入缓冲必须在调用期间有效且 NUL 结尾；引擎不跨调用保存裸指针（用户自己加的句柄/批量索引除外，必须有 close）。
3. 长度单位：C ABI 传 NUL 结尾字符串；C#/Java 是 UTF-16、PHP 是字节序列，长度不能从宿主 `.Length` 直接搬，非 ASCII 用例才能暴露截断。
4. 线程与回调：入口没有 `Send`/`Sync` 约束，JNI 在调用线程执行；共享状态用 `Mutex`/`OnceLock`，不用 `static mut`；回调 trampoline 要 `catch_unwind(AssertUnwindSafe)` 并让闭包在 guard 里活到调用结束。
5. 错误与 panic 跨边界：返回 `{"ok"}`/`{"error"}`/`{"panic"}` 三态，宿主两种错误都要处理；panic 不作为控制流。
6. 每条写明安全前提由哪一侧保证（Rust / 宿主包装 / 调用方协议），无归属的前提算 blocker。

**不合格判据**
- 认可 `Marshal.FreeHGlobal`、`free()` 或 GC 终结器释放返回值。
- 只说"要小心内存"而不给释放方与释放函数。
- 漏掉长度单位或线程约束。
- 用"应该没问题"代替"谁保证 + 证据在哪"。

---

## 场景 4：回放全部通过但全部回退（最容易被误报的失败）

**用户提问**：「`app_replay` 显示 `Passed: 6/6`，是不是已经迁移完了？」

**DSH 应识别**
- 六个数字必须一起读：`build`、`passed`/`total`、`skipped`、`failures`、`fallback`。
- `fallback` 为 `null` = 该构建没有报告回退率，不能当作 0。
- 全回退（`fallback.rate == 1.0`，或前端统计全部走原实现）时，2/2、6/6 都**不是** Rust 的结果——Rust 只是被编译进去了。

**应给出的结论**
- 先报字段原值，再下判断：`passed 6/6, skipped 0, failures [], fallback null` → "行为一致，但这次构建没报回退率，无法据此证明 6 个用例都走了 Rust"。
- 若 `fallback` 有值且 `rate` 为 1：直接说"这是原程序的结果"，然后给排查方向：`app_wire`/`app_enable` 是否切到单元、前门是否仍在代理、单元绑定是否被 `RUST_ANYTHING_UNIT_<NAME>=original` 覆盖。
- 合格结论必须显式排除"这不是 Rust 结果"这一可能，或给出证明它确实是 Rust 的证据。

**不合格判据**
- 只看 `Passed 6/6` 就宣布迁移完成。
- 把 `fallback: null` 说成"0 回退"。
- 忽略回退率，或看到 100% 回退后仍称"已验证 Rust 实现"。

---

## 场景 5：Kotlin / C# 桥接边界（补充场景）

**用户提问**：「这个 Kotlin 的 `object` 单例方法能迁吗？生成的 Java 文件是什么关系？」

**DSH 应识别**
- Kotlin 走 JNI，产物就是 Java 产物（`codegen_kotlin.rs` 复用 `codegen_java`），类名变成 `<File>Kt`，方法带 `@JvmStatic`。
- 检测规则：Gradle Kotlin 模块且源码全为 `.kt` 才判 Kotlin；有 `pom.xml` 或 `.kt/.java` 混放仍是 Java，除非显式 `--lang kotlin`。
- C# 走 P/Invoke + C ABI，同样不支持 `--batch`。

**不合格判据**
- 声称 Kotlin 有独立于 Java 的桥接产物。
- 把 `--batch` 说成 PHP/C# 也支持。
- 未说明"能否回放取决于本机是否有 `kotlinc`/`dotnet`"。

---

## 复核方式

```powershell
# 技能正文与实际注入文本
node -e "const s=require('fs').readFileSync('skills/rust-anything/playbook.md','utf8'); console.log(s.includes('rust_anything_free'))"

# 语言能力（本机可复现）
runtime/win32-x64/rust-anything.exe analyze <repo> --lang php --json
runtime/win32-x64/rust-anything.exe bridge <repo>

# 回放字段与回退率
runtime/win32-x64/rust-anything.exe app_replay <repo>
```

回放与桥接的实跑证据见仓库 `test/` 与 `skills/rust-anything/playbook.md` 第 1 节的表格；
本机上 `php`、`dotnet`、`kotlinc` 不存在时，场景 1、5 的"回放"一栏必须判为未验证。
