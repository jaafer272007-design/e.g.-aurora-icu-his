; AURORA ICU - app-only UPDATE package (Inno Setup). A small self-extracting
; AuroraUpdate-<ver>.exe: it lays the new server\ payload + the updater + a
; SHA256SUMS into a temp folder and runs aurora-update.ps1, which verifies the
; package, guards against version skew, takes a born-verified DB restore point,
; swaps the binaries (carrying aurora.env across), and rolls back on any failure.
; It does NOT touch pgsql / the model / aurora.env / the database on the happy path.
; See installer/UPDATE_AND_ENABLE_AI_DESIGN.md sec 2 and installer/aurora-update.ps1.
;
; BUILD: installer\build.ps1 -UpdateOnly stages payload\ and runs ISCC with
;   /DAppVer=<ver>. WINDOWS-ONLY - compiled + run on Windows; CODE-REVIEWED here.

#ifndef AppVer
  #define AppVer "0.0.0"
#endif
#define AppName "Aurora ICU Update"
#define Publisher "Aurora HIS"

[Setup]
AppName={#AppName}
AppVersion={#AppVer}
AppPublisher={#Publisher}
; the operator points this at their existing Aurora install (default C:\Aurora)
DefaultDirName=C:\Aurora
DisableProgramGroupPage=yes
Uninstallable=no
; stop/start of the service + the DB restore need elevation
PrivilegesRequired=admin
; only 64-bit Windows (Inno 6.4+ replaced ArchitecturesInstall64Bit with this)
ArchitecturesAllowed=x64compatible
OutputBaseFilename=AuroraUpdate-{#AppVer}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; the updater manages AuroraServer itself (stop -> swap -> start); Inno must not
; try to close the service as if it were a foreground app
CloseApplications=no

[Messages]
; reframe the dir page for an UPDATE (select the existing install, not a new one)
SelectDirDesc=Select your existing Aurora installation folder. The update is applied in place; your database, configuration and backups are preserved.

[Files]
; everything is transported into {tmp}\pkg and consumed by the updater; nothing is
; "installed" by Inno - the .ps1 performs the swap and can roll it back.
Source: "payload\server\*";      DestDir: "{tmp}\pkg\server"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "payload\SHA256SUMS";    DestDir: "{tmp}\pkg";        Flags: ignoreversion
Source: "payload\manifest.json"; DestDir: "{tmp}\pkg";        Flags: ignoreversion
Source: "aurora-update.ps1";     DestDir: "{tmp}\pkg";        Flags: ignoreversion

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var args, log: String; rc: Integer;
begin
  if CurStep <> ssPostInstall then Exit;

  args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\pkg\aurora-update.ps1') + '"' +
    ' -PackageDir "' + ExpandConstant('{tmp}\pkg') + '"' +
    ' -InstallDir "' + ExpandConstant('{app}') + '"';

  WizardForm.StatusLabel.Caption := 'Updating Aurora (backup -> swap -> verify)...';
  if not Exec('powershell.exe', args, '', SW_HIDE, ewWaitUntilTerminated, rc) then begin
    MsgBox('Could not launch the updater. Aurora was not changed.', mbCriticalError, MB_OK);
    Abort;
  end;

  { rc: 0 = updated (or a no-op skip); 1 = failed but ROLLED BACK to the prior
    version (system healthy); 2 = rollback could not complete - manual recovery
    (the updater printed and logged the exact steps to installer\update.log). }
  if rc = 0 then
    { success/no-op - the finished page speaks for it }
  else if rc = 1 then
    MsgBox('The update did not succeed and Aurora was rolled back to the previous version. It is running normally. See installer\update.log.', mbInformation, MB_OK)
  else begin
    log := ExpandConstant('{app}\update.log');
    MsgBox('CRITICAL: the update failed AND the automatic rollback could not complete.' + #13#10 +
           'Aurora may be between states - follow the recovery steps in:' + #13#10 + log + #13#10#13#10 +
           'The previous build (server.prev) and a verified pre-update backup are both intact.', mbCriticalError, MB_OK);
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption :=
      'The Aurora update has been applied. If it did not succeed, Aurora was automatically returned to the previous version - see the message shown and installer\update.log. ' + #13#10#13#10 +
      'Aurora continues to run as a Windows service; clinicians can reopen the access URL.';
end;
