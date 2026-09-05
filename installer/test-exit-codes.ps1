<#
  Unit tests for installer\aurora-exit-codes.ps1 - the native exit-code
  explanations aurora-provision.ps1 prints instead of raw numbers.

  These run under Windows PowerShell 5.1 in CI (the installer-powershell
  job), the same engine aurora.iss launches provisioning with. The mapping
  tests touch nothing. The Test-NativeStart tests run ONE real child process
  (cmd.exe on Windows; /bin/sh for a local run elsewhere) so the exit-code
  plumbing is exercised for real rather than mocked.

  The first block pins the field failure of 2026-09-05 by its exact number.

  Run:  powershell -ExecutionPolicy Bypass -File .\installer\test-exit-codes.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'aurora-exit-codes.ps1')

$script:pass = 0
$script:fail = 0
function Assert([bool]$cond, [string]$what) {
  if ($cond) { $script:pass++; Write-Host "  ok   $what" }
  else { $script:fail++; Write-Host "  FAIL $what" -ForegroundColor Red }
}
function Section([string]$t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }

# ---------------------------------------------- the field failure, by number
Section 'Get-NativeExitReason - initdb failed (-1073741515), 2026-09-05'
$r = Get-NativeExitReason -Code -1073741515
Assert ($r -like '*STATUS_DLL_NOT_FOUND*') 'the negative int32 -1073741515 is recognised as STATUS_DLL_NOT_FOUND'
Assert ($r -like '*0xC0000135*') 'the NTSTATUS is named in hex'
Assert ($r -like '*Visual C++*') 'the remedy names the Visual C++ runtime'
Assert ($r -like '*vcruntime140.dll*') 'the missing DLL is named'
Assert ($r -like '*run Setup again*') 'the operator is told what to do next'
Assert ((Get-NativeExitReason -Code 3221225781) -eq $r) 'the unsigned spelling 3221225781 gives the identical explanation'

# ---------------------------------------------- the other loader failures
Section 'Get-NativeExitReason - the other ways a program fails to start'
Assert ((Get-NativeExitReason -Code -1073741511) -like '*STATUS_ENTRYPOINT_NOT_FOUND*') '-1073741511 (0xC0000139) -> entry point not found (runtime too old)'
Assert ((Get-NativeExitReason -Code -1073741701) -like '*STATUS_INVALID_IMAGE_FORMAT*') '-1073741701 (0xC000007B) -> invalid image format'
Assert ((Get-NativeExitReason -Code -1073741819) -like '*STATUS_ACCESS_VIOLATION*') '-1073741819 (0xC0000005) -> access violation'

# ---------------------------------------------- ordinary codes stay plain
Section 'Get-NativeExitReason - ordinary codes are reported as themselves'
Assert ((Get-NativeExitReason -Code 1) -eq 'exit code 1') '1 -> "exit code 1"'
Assert ((Get-NativeExitReason -Code 0) -eq 'exit code 0') '0 -> "exit code 0" (callers decide that 0 is success)'
Assert ((Get-NativeExitReason -Code 3010) -eq 'exit code 3010') '3010 (an installer reboot code) is not mislabelled as a loader failure'

# ---------------------------------------------- real child processes
Section 'Test-NativeStart - real child processes'
if ($env:OS -eq 'Windows_NT') {
  $sh = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $okArgs = @('/c', 'exit 0'); $failArgs = @('/c', 'exit 7')
} else {
  $sh = '/bin/sh'
  $okArgs = @('-c', 'exit 0'); $failArgs = @('-c', 'exit 7')
}
Assert ((Test-NativeStart -Exe $sh -Arguments $okArgs) -eq '') 'a program that exits 0 gives an empty reason'
Assert ((Test-NativeStart -Exe $sh -Arguments $failArgs) -eq 'exit code 7') 'a program that exits 7 gives "exit code 7"'
Assert ((Test-NativeStart -Exe (Join-Path $PSScriptRoot 'no-such-program.exe')) -like 'not found:*') 'a missing program is reported as not found, without throwing'
Assert ($ErrorActionPreference -eq 'Stop') 'Test-NativeStart restores $ErrorActionPreference afterwards'

Write-Host ""
Write-Host "passed $script:pass, failed $script:fail"
if ($script:fail -gt 0) { exit 1 }
exit 0
