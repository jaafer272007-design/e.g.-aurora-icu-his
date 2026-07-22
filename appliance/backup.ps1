# AURORA appliance — automatic backup (BACKUP_DR_DESIGN.md).
#
# TWO uses:
#   .\backup.ps1 -Install     register the nightly Windows Scheduled Task
#   .\backup.ps1              run ONE backup now (what the task invokes)
#
# The backup engine lives in the aurora container (ONE implementation,
# shared with the in-app Backup area and restore.ps1). This script is the
# Windows glue the design's §1 "fully automatic via Task Scheduler"
# decision needs: it triggers the encrypted daily backup on the on-server
# primary target, copies it to the off-site USB (design's true DR copy),
# and records the USB outcome in the immutable audit — honestly, because
# the container cannot see the host's USB disk itself.
[CmdletBinding()]
param(
  [switch]$Install,     # register the scheduled task instead of running
  [string]$Time         # HH:mm override for -Install (else from BACKUP_SCHEDULE)
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Get-EnvVal([string]$key) {
  if (-not (Test-Path ".env")) { return "" }
  $line = Select-String -Path ".env" -Pattern "^$key=" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($line) { return ($line.Line -replace "^$key=", "") } else { return "" }
}

# ---------------------------------------------------------------------------
if ($Install) {
  # parse the run time from BACKUP_SCHEDULE ("daily HH:mm") unless overridden
  $sched = Get-EnvVal "BACKUP_SCHEDULE"
  if (-not $Time) {
    if ($sched -match 'daily\s+(\d{2}:\d{2})') { $Time = $Matches[1] } else { $Time = "02:00" }
  }
  $script = Join-Path $PSScriptRoot "backup.ps1"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $PSScriptRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $Time
  # run whether or not the operator is logged in; highest privileges so it
  # can reach Docker and the ACL-locked key file
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName "AuroraBackup" -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host "Registered scheduled task 'AuroraBackup' — daily at $Time (RPO 24h)."
  Write-Host "It runs: $script"
  Write-Host "Confirm success on the Backup dashboard (/backup) or with: .\backup.ps1  (a manual run now)."
  Write-Host "REMINDER: keep BACKUP_SCHEDULE in appliance\.env in step with this time (the dashboard's"
  Write-Host "          'next scheduled' is computed from it)."
  return
}

# ---------------------------------------------------------------------------
# ONE backup run (the scheduled task's body).
$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Write-Host "[$stamp] Aurora backup starting…"

# 1 — the encrypted, restore-verified backup on the on-server primary target
docker compose exec -T aurora dotnet AuroraIcu.Api.dll backup --actor "scheduled-task"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backup FAILED (the engine reported an error). The Backup dashboard will show the failure and the 24h health alert; investigate before the RPO is breached."
}

# 2 — the off-site copy (design's TRUE disaster copy). BACKUP_USB in .env is
#     the mounted USB path (e.g. E:\AuroraBackups); absent = primary only,
#     and the dashboard says the USB copy has never been recorded.
$usb = Get-EnvVal "BACKUP_USB"
if ($usb) {
  Write-Host "Copying backups to the off-site USB: $usb"
  # robocopy mirrors the on-server backup directory to the USB; /R and /W
  # keep a flaky drive from hanging the task. Exit codes 0–7 are success
  # (files copied / already current); >=8 is a real failure.
  robocopy ".\backups" $usb /E /R:2 /W:5 /NP | Out-Null
  $rc = $LASTEXITCODE
  if ($rc -lt 8) {
    Write-Host "USB copy OK (robocopy $rc)."
    docker compose exec -T aurora dotnet AuroraIcu.Api.dll audit usb-copy success `
      --actor "scheduled-task" --file "$usb" `
      --detail "{`"target`":`"$($usb -replace '\\','/')`",`"robocopy`":$rc}" | Out-Null
  } else {
    Write-Host "USB copy FAILED (robocopy $rc)." -ForegroundColor Red
    docker compose exec -T aurora dotnet AuroraIcu.Api.dll audit usb-copy failed `
      --actor "scheduled-task" --file "$usb" `
      --detail "{`"target`":`"$($usb -replace '\\','/')`",`"robocopy`":$rc}" | Out-Null
    Write-Error "The on-server backup succeeded but the off-site USB copy failed. Rotate/replace the USB disk — the off-site copy is the real disaster recovery."
  }
} else {
  Write-Host "No BACKUP_USB configured — on-server primary only. Set BACKUP_USB=E:\AuroraBackups in"
  Write-Host "appliance\.env and rotate the disk off-site (the on-server copy dies with the server)."
}

Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Aurora backup finished."
