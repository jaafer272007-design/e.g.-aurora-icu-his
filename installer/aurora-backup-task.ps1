# AURORA - the nightly-backup task + firewall registration. ONE implementation
# (backup ruling 3): aurora-provision.ps1 dot-sources these functions at
# install time, and CI's installer-powershell job runs THE SAME functions on a
# real Windows runner and asserts the task and the rule actually exist
# afterwards. The field finding behind all three backup rulings (2026-08-19):
# a production install's provision.log claimed both registrations, and the
# machine had neither. Ruling 1 made the script verify its own claims; this
# file exists so CI can verify the script - a copy of this logic inside the
# CI leg would drift from the shipped code, which is the fork the no-fork
# rule forbids.
#
# CONTRACT: both functions VERIFY AFTER CREATE and THROW when the created
# thing cannot be found - the caller renders the failure (provisioning wraps
# it in Fail with the operator message; CI prints and exits red).
# WINDOWS POWERSHELL 5.1 - parsed by the CI 5.1 gate like every installer
# script; no PS7-only syntax.

function Register-AuroraBackupTask {
  param(
    [Parameter(Mandatory=$true)][string]$BackupScript,
    [Parameter(Mandatory=$true)][string]$WorkingDir,
    [string]$TaskName = 'AuroraBackup',
    [string]$At = '02:00'
  )
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$BackupScript`"" -WorkingDirectory $WorkingDir
  $trigger = New-ScheduledTaskTrigger -Daily -At $At
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
  # VERIFY AFTER CREATE (ruling 1): the claim is a measurement or it is
  # nothing.
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) {
    throw ("scheduled task '$TaskName' NOT FOUND after Register-ScheduledTask returned - " +
      "the registration did not take (is the 'Schedule' service running?)")
  }
  return $task
}

function Register-AuroraFirewallRule {
  param(
    [Parameter(Mandatory=$true)][int]$Port,
    [string]$DisplayName = 'Aurora ICU'
  )
  # CREATE BEFORE REMOVE (ruling 1): Windows allows several rules with one
  # DisplayName, so the correct new rule is created FIRST and the older
  # instances are removed afterwards by instance id - the machine is never
  # ruleless, and re-provision converges on exactly one correct rule.
  $fwNew = New-NetFirewallRule -DisplayName $DisplayName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port -Profile Any
  Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue |
    Where-Object { $_.InstanceID -ne $fwNew.InstanceID } |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
  $rules = @(Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue)
  if ($rules.Count -eq 0) {
    throw ("firewall rule '$DisplayName' NOT FOUND after New-NetFirewallRule returned - " +
      "the rule did not take (is the Windows Firewall service running?)")
  }
  return $rules
}
