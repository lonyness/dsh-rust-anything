#requires -Version 7.3
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$Sha256,
    [string]$DesktopExe = $env:DSH_NODE_EXECUTABLE,
    [string]$Compiler = $(Join-Path ($env:RUSTUP_HOME ? $env:RUSTUP_HOME : (Join-Path $HOME '.rustup')) 'toolchains\stable-x86_64-pc-windows-msvc\bin\rustc.exe')
)
$ErrorActionPreference = 'Stop'
if (!$IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') { throw 'Requires Windows x64.' }
if ($Archive -notmatch '^[A-Za-z]:[\\/]' -or [IO.Path]::GetExtension($Archive) -ne '.tgz') { throw 'Give the final local, absolute .tgz path; no URL or directory.' }
$archiveFile = Get-Item -LiteralPath $Archive
if ($archiveFile.PSIsContainer -or (Get-FileHash -Algorithm SHA256 -LiteralPath $archiveFile.FullName).Hash -cne $Sha256.ToUpperInvariant()) { throw 'Candidate SHA-256 mismatch; no run started.' }
if (!$DesktopExe) { throw 'Specify -DesktopExe with the absolute path of the installed DeepSeek Harness.exe.' }
$desktop = (Get-Item -LiteralPath $DesktopExe).FullName
$rust = (Get-Item -LiteralPath $Compiler).FullName
if (!(Test-Path -LiteralPath (Join-Path (Split-Path (Split-Path $rust)) 'lib\rustlib') -PathType Container)) { throw '-Compiler must be a real installed toolchain compiler, not a rustup shim.' }
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
if (!$node) { throw 'Install/use a trusted native Node for the sample app first; no installer is run here.' }
$root = [IO.Directory]::CreateTempSubdirectory('dsh-ra-').FullName
"Retained run: $root"
$dirs = @('样例 é🦀','user','user\AppData\Local','user\AppData\Roaming','agents','tmp','npm','cache','pnpm')
foreach ($dir in $dirs) { [void][IO.Directory]::CreateDirectory((Join-Path $root $dir)) }
$p = [Diagnostics.ProcessStartInfo]::new($desktop)
$p.UseShellExecute = $false; $p.WorkingDirectory = Join-Path $root $dirs[0]
$p.RedirectStandardOutput = $true; $p.RedirectStandardError = $true
$p.StandardOutputEncoding = $p.StandardErrorEncoding = [Text.Encoding]::UTF8
# Do not clone today's environment, tokens, HOME, profile, provider routes, proxy or sandbox settings.
$p.Environment.Clear()
foreach ($key in @('SystemRoot','WINDIR','SystemDrive','ComSpec','OS','PATHEXT','ProgramFiles','ProgramFiles(x86)','ProgramW6432','CommonProgramFiles','CommonProgramFiles(x86)','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS')) {
    $value = [Environment]::GetEnvironmentVariable($key); if ($value) { $p.Environment[$key] = $value }
}
$p.Environment['PATH'] = @((Split-Path $node),(Split-Path $rust),(Join-Path $env:SystemRoot 'System32'),$env:SystemRoot,$PSHOME) -join ';'
$p.Environment['RA_RUN'] = $root; $p.Environment['RA_NODE'] = $node; $p.Environment['RA_RUSTC'] = $rust
$p.Environment['DSH_HOME'] = Join-Path $root 'home'; $p.Environment['DSH_AGENTS_HOME'] = Join-Path $root 'agents'
$p.Environment['USERPROFILE'] = $p.Environment['HOME'] = Join-Path $root 'user'
$p.Environment['APPDATA'] = Join-Path $root 'user\AppData\Roaming'; $p.Environment['LOCALAPPDATA'] = Join-Path $root 'user\AppData\Local'
$p.Environment['TMP'] = $p.Environment['TEMP'] = $p.Environment['TMPDIR'] = Join-Path $root 'tmp' # sibling, never below the sample workspace
$p.Environment['PNPM_HOME'] = Join-Path $root 'pnpm'; $p.Environment['XDG_CACHE_HOME'] = Join-Path $root 'cache'
$p.Environment['NPM_CONFIG_USERCONFIG'] = Join-Path $root 'npm\user.npmrc'; $p.Environment['NPM_CONFIG_GLOBALCONFIG'] = Join-Path $root 'npm\global.npmrc'
$p.Environment['NPM_CONFIG_CACHE'] = Join-Path $root 'npm\cache'; $p.Environment['NPM_CONFIG_OFFLINE'] = 'true'
$p.Environment['DSH_TELEMETRY_DISABLED'] = '1'; $p.Environment['RUSTUP_AUTO_INSTALL'] = '0'; $p.Environment['CI'] = 'true'
$p.Environment['CARGO_NET_OFFLINE'] = 'true' # dependency-free probe; the driver must not set CARGO_TARGET_DIR
$p.Environment['ELECTRON_RUN_AS_NODE'] = '1'
foreach ($arg in @('--expose-internals',(Join-Path $PSScriptRoot 'smoke.mjs'),$archiveFile.FullName,$Sha256.ToLowerInvariant())) { $p.ArgumentList.Add($arg) }
$child = [Diagnostics.Process]::Start($p)
try {
    $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
    if (!$child.WaitForExit(600000)) { $child.Kill($true); $child.WaitForExit(); throw '10 min deadline; owned process tree stopped. Evidence retained; do not retry in this directory.' }
    [IO.File]::WriteAllText((Join-Path $root 'driver.stdout'),$stdout.Result); [IO.File]::WriteAllText((Join-Path $root 'driver.stderr'),$stderr.Result)
    [Console]::Out.Write($stdout.Result); [Console]::Error.Write($stderr.Result)
    if ($child.ExitCode -ne 0) { throw "Failed (exit $($child.ExitCode)); evidence: $root" }
} finally { if (!$child.HasExited) { $child.Kill($true); $child.WaitForExit() }; $child.Dispose() }
