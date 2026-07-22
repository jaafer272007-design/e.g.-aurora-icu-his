<#
  AURORA ICU — native nightly backup (installer Option B). The Task Scheduler
  job the installer registers ('AuroraBackup', daily 02:00, SYSTEM) runs THIS.

  It is the Docker-free sibling of appliance/backup.ps1 (#164): that one runs
  `docker compose exec aurora dotnet AuroraIcu.Api.dll backup`; a native
  install has no Docker, so this runs the self-contained EXE directly. The
  BACKUP ENGINE is identical (BackupService.RunBackup) — same AES-256-GCM
  encryption, same born-restore-verified manifest, same primary target — so
  this changes only HOW the backup is triggered, never what a backup IS.

  The exe reads BACKUP_DIR / BACKUP_KEY_FILE / DATABASE_URL from aurora.env
  (beside the exe, via the PR-A AuroraEnvFile loader), so no arguments carry
  secrets. Off-site copy: set BACKUP_USB=E:\AuroraBackups in aurora.env and
  this mirrors the primary backup directory there (the true disaster copy),
  recording the USB outcome in the immutable audit — honestly, because the
  container/host split of #164 does not exist here (this runs on the host).

  🔎 WINDOWS-ONLY — CODE-REVIEWED, verify on the Windows machine.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot                       # scripts\ ; the exe is one level up in server\
$exe = Join-Path (Split-Path -Parent $PSScriptRoot) 'AuroraIcu.Api.exe'
if (-not (Test-Path $exe)) { $exe = Join-Path $PSScriptRoot '..\AuroraIcu.Api.exe' }

function Get-EnvVal([string]$key) {
  $ef = Join-Path (Split-Path -Parent $exe) 'aurora.env'
  if (-not (Test-Path $ef)) { return '' }
  $m = Select-String -Path $ef -Pattern "^$key=" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m) { return ($m.Line -replace "^$key=", '') } else { return '' }
}

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
Write-Host "[$stamp] Aurora backup starting…"

# 1 — the encrypted, restore-verified backup on the on-server primary target
& $exe backup --actor "scheduled-task"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backup FAILED (the engine reported an error). The Backup dashboard shows the failure and the 24h health alert; investigate before the RPO is breached."
}

# 2 — the off-site copy (the true disaster copy), when a USB path is configured
$usb = Get-EnvVal 'BACKUP_USB'
$dir = Get-EnvVal 'BACKUP_DIR'
if ($usb -and $dir) {
  Write-Host "Copying backups to the off-site USB: $usb"
  robocopy $dir $usb /E /R:2 /W:5 /NP | Out-Null
  $rc = $LASTEXITCODE
  $outcome = if ($rc -lt 8) { 'success' } else { 'failed' }
  $detail = "{`"target`":`"$($usb -replace '\\','/')`",`"robocopy`":$rc}"
  & $exe audit usb-copy $outcome --actor "scheduled-task" --file "$usb" --detail "$detail" | Out-Null
  if ($rc -lt 8) { Write-Host "USB copy OK (robocopy $rc)." }
  else { Write-Error "The on-server backup succeeded but the off-site USB copy failed (robocopy $rc). Rotate/replace the USB — the off-site copy is the real disaster recovery." }
} else {
  Write-Host "No BACKUP_USB configured — on-server primary only. Add BACKUP_USB=E:\AuroraBackups to aurora.env and rotate the disk off-site."
}

Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Aurora backup finished."
