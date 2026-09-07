<#
  Native exit-code explanations for the installer scripts.

  WHY THIS FILE EXISTS. On 2026-09-05 a real install died at "Setting up
  Aurora" and provision.log carried exactly one reason: "initdb failed
  (-1073741515)". That number is 0xC0000135 = STATUS_DLL_NOT_FOUND: Windows
  could not START initdb.exe because a DLL it links against was missing - the
  Microsoft Visual C++ runtime, which is not part of Windows and which nothing
  had installed on that freshly imaged laptop. The number told the operator
  nothing (and the wizard's generic advice pointed at antivirus, which had
  nothing to do with it). This file turns such codes into a sentence naming
  what is missing and what to do.

  Windows reports a process that never got to run as an NTSTATUS. PowerShell
  shows it as a NEGATIVE 32-bit $LASTEXITCODE (0xC0000135 is -1073741515), so
  the mapping accepts either spelling.

  PURITY. Get-NativeExitReason takes a number and returns a string; it reads,
  writes and exits nothing. Test-NativeStart runs ONE child process and
  returns a string. Both are unit-tested by installer\test-exit-codes.ps1 on
  Windows PowerShell 5.1 (the installer-powershell CI job).

  POWERSHELL 5.1 ONLY - no ternaries, no '??', no '?.'. PURE ASCII: 5.1
  decodes this file with the machine's ANSI codepage.
#>

function Get-NativeExitReason {
  param([Parameter(Mandatory)][long]$Code)
  # A negative int32 is the unsigned NTSTATUS wrapped; unwrap it so both
  # spellings of the same code map to the same explanation.
  $u = [long]$Code
  if ($u -lt 0) { $u = $u + 4294967296 }
  $hex = ('0x{0:X8}' -f $u)
  switch ($u) {
    3221225781 {   # 0xC0000135
      return ("STATUS_DLL_NOT_FOUND ($hex): the program could not even start because a DLL it needs is missing. " +
              "On a Windows PC that has never had Microsoft Visual C++ software installed, that DLL is the Visual C++ " +
              "runtime (vcruntime140.dll, vcruntime140_1.dll, msvcp140.dll) - it is NOT part of Windows. Setup installs " +
              "it before this step; if you see this anyway, install 'Microsoft Visual C++ Redistributable 2015-2022 " +
              "(x64)' from Microsoft and run Setup again")
    }
    3221225785 {   # 0xC0000139
      return ("STATUS_ENTRYPOINT_NOT_FOUND ($hex): a DLL the program needs is present but too OLD for it. Install the " +
              "current 'Microsoft Visual C++ Redistributable 2015-2022 (x64)' from Microsoft and run Setup again")
    }
    3221225595 {   # 0xC000007B
      return ("STATUS_INVALID_IMAGE_FORMAT ($hex): a 32-bit/64-bit mismatch or a corrupt file among the bundled " +
              "binaries. Copy the installer folder again (the .exe AND every .bin slice) and run Setup again")
    }
    3221225477 {   # 0xC0000005
      return ("STATUS_ACCESS_VIOLATION ($hex): the program crashed as it started - typically antivirus interference " +
              "or a damaged file. Check the antivirus quarantine for files under the Aurora folders and run Setup again")
    }
    default { return "exit code $Code" }
  }
}

function Test-NativeStart {
  # Runs one native program and reports whether the PROCESS ITSELF could
  # start and finish: '' when it exited 0, otherwise a reason string from
  # Get-NativeExitReason. aurora-provision.ps1 runs it on initdb.exe
  # --version BEFORE the cluster is created, so a machine that cannot start
  # the bundled PostgreSQL is told what is missing instead of failing inside
  # a longer operation.
  param(
    [Parameter(Mandatory)][string]$Exe,
    [string[]]$Arguments = @()
  )
  if (-not (Test-Path -LiteralPath $Exe)) { return "not found: $Exe" }
  # Under $ErrorActionPreference = 'Stop', 5.1 turns a native command's
  # stderr into a TERMINATING NativeCommandError (the trap build.ps1 documents
  # for git), so relax the preference around this one call; the exit code
  # alone decides what happened.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $code = $null
  try {
    $null = & $Exe @Arguments 2>&1
    $code = $LASTEXITCODE
  } catch {
    return ("could not be launched: " + $_.Exception.Message)
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($null -eq $code) { return 'produced no exit code' }
  if ($code -eq 0) { return '' }
  return (Get-NativeExitReason -Code $code)
}
