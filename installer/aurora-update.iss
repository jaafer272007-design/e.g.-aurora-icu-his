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
; The update targets the EXISTING install. It must NEVER ask.
;
; Until 2026-08-05 this had DefaultDirName but no DisableDirPage, so the wizard
; showed a folder picker. Picking anything other than the real install sends
; -InstallDir at a directory with no Aurora in it, the updater refuses in
; preflight, and the operator was told the update "did not succeed and Aurora
; was rolled back" - when nothing had even been looked at. An update is not a
; place to re-choose where the product lives; the answer is already on disk.
;
; Note this package is a DIFFERENT Inno application from the full installer
; ("Aurora ICU Update" vs "Aurora ICU"), so UsePreviousAppDir cannot inherit the
; full installer's directory - it would silently find nothing. The real
; resolution therefore happens in aurora-update.ps1, which reads the install
; location from the REGISTERED AuroraServer SERVICE. {app} below is only the
; fallback handed to it - passed as -FallbackInstallDir, never as -InstallDir.
;
; Until 2026-08-06 it WAS passed as -InstallDir, which the script treated as a
; supervised override and therefore never consulted the service at all. The
; folder page had been disabled but its value still won, so the whole point of
; resolving from the service was defeated: an install at D:\Aurora was refused
; with "no installed server\version.json" and its log went to C:\Aurora.
DefaultDirName=C:\Aurora
DisableDirPage=yes
DisableProgramGroupPage=yes
Uninstallable=no
; stop/start of the service + the DB restore need elevation
PrivilegesRequired=admin
; only 64-bit Windows (Inno 6.4+ replaced ArchitecturesInstall64Bit with this)
ArchitecturesAllowed=x64compatible
; ---- install-password wiring (owner's ruling 2026-07-25: update packages
; get the SAME company password, SAME machinery as the full installer -
; an unprotected update exe would hand out the newest server binaries and
; defeat the point of protecting AuroraSetup). build-protected.ps1
; -UpdateOnly places the password in ISCC's ENVIRONMENT (never the command
; line); adopted here at preprocess time exactly as in aurora.iss. The
; output name carries the protection state by construction; -UNPROTECTED
; (plain build.ps1 -UpdateOnly) is for build-machine smoke tests only.
#ifndef InstallPassword
  #if GetEnv("AURORA_INSTALL_PASSWORD") != ""
    #define InstallPassword GetEnv("AURORA_INSTALL_PASSWORD")
  #endif
#endif
#ifdef InstallPassword
  #if VER < EncodeVer(6,4,0)
    #error "Inno Setup 6.4+ is required for an encrypted build - older compilers do not implement Encryption=yes as XChaCha20"
  #endif
OutputBaseFilename=AuroraUpdate-{#AppVer}-PROTECTED
; XChaCha20 over the whole payload, key PBKDF2-derived from the password
; (same honest limit as aurora.iss: metadata + this [Code] are readable;
; only file data is protected). The wizard asks for the password up front;
; the [Code] update logic runs at ssPostInstall, after that gate.
Password={#InstallPassword}
Encryption=yes
#else
OutputBaseFilename=AuroraUpdate-{#AppVer}-UNPROTECTED
#endif
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
{ Where the updater ACTUALLY wrote its transcript. We cannot compute it: {app} is
  only DefaultDirName, while the script resolves the real install directory from
  the AuroraServer service. So the script writes the path it used into
  {tmp}\aurora-update-log.txt and we read it back - the same relay aurora.iss uses
  for {tmp}\aurora-url.txt. Falls back to the old guess if the file is absent
  (e.g. PowerShell never started), which is the only case where it is right. }
function ResolvedLogPath(): String;
var lines: TArrayOfString;
begin
  Result := ExpandConstant('{app}\update.log');
  if LoadStringsFromFile(ExpandConstant('{tmp}\aurora-update-log.txt'), lines) then
    if GetArrayLength(lines) > 0 then
      if Trim(lines[0]) <> '' then
        Result := Trim(lines[0]);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var args, log: String; rc: Integer;
begin
  if CurStep <> ssPostInstall then Exit;

  { -FallbackInstallDir, NOT -InstallDir. {app} here is only DefaultDirName (the
    folder page is disabled), so it is a GUESS. Passing a guess as -InstallDir is
    exactly what broke this: aurora-update.ps1 treated any supplied -InstallDir as
    a supervised override and skipped the AuroraServer service lookup entirely, so
    every install not at C:\Aurora was refused at the version.json preflight and
    its update.log was written into the guessed folder. The script now asks the
    service first and uses this value only if the service cannot be read. }
  args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\pkg\aurora-update.ps1') + '"' +
    ' -PackageDir "' + ExpandConstant('{tmp}\pkg') + '"' +
    ' -FallbackInstallDir "' + ExpandConstant('{app}') + '"';

  WizardForm.StatusLabel.Caption := 'Updating Aurora (backup -> swap -> verify)...';
  if not Exec('powershell.exe', args, '', SW_HIDE, ewWaitUntilTerminated, rc) then begin
    MsgBox('Could not launch the updater. Aurora was not changed.', mbCriticalError, MB_OK);
    Abort;
  end;

  { Each code means exactly ONE thing - see the EXIT CODES block in
    aurora-update.ps1. Until 2026-08-05 every failure exited 1 and this told the
    operator "rolled back ... running normally" even when NOTHING had happened,
    or when the swap had died with the service stopped. Two real field failures
    were reported that way. A message the code cannot vouch for is exactly what
    the no-reassuring-default rule forbids.
      0 = applied, or a deliberate no-op
      1 = REFUSED before any change - the system is untouched
      2 = between states - manual recovery
      3 = failed, and successfully rolled back - healthy on the old build
    Anything else is an UNKNOWN outcome (e.g. PowerShell itself failed to run,
    or the process was killed): say so honestly rather than assert a
    catastrophe, which would push someone into a needless database restore. }
  log := ResolvedLogPath();
  if rc = 0 then
    { success/no-op - the finished page speaks for it }
  else if rc = 1 then
    MsgBox('The update was NOT applied - it stopped before changing anything, so Aurora is exactly as it was and is still running the previous version.' + #13#10#13#10 +
           'Nothing needs to be recovered. The reason is in:' + #13#10 + log, mbInformation, MB_OK)
  else if rc = 3 then
    MsgBox('The update did not succeed and Aurora was rolled back to the previous version. It is running normally.' + #13#10#13#10 +
           'See ' + log, mbInformation, MB_OK)
  else if rc = 2 then
    MsgBox('CRITICAL: the update failed AND the automatic rollback could not complete.' + #13#10 +
           'Aurora may be between states - follow the recovery steps in:' + #13#10 + log + #13#10#13#10 +
           'The previous build (server.prev) and a verified pre-update backup are both intact.', mbCriticalError, MB_OK)
  else
    MsgBox('The updater ended unexpectedly (code ' + IntToStr(rc) + ') - the outcome is UNKNOWN.' + #13#10#13#10 +
           'This usually means the updater could not run at all, in which case nothing was changed. Do NOT restore anything yet.' + #13#10#13#10 +
           'Check ' + log + ' and the state of the AuroraServer service before doing anything else.', mbError, MB_OK);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption :=
      'The Aurora update has been applied. If it did not succeed, Aurora was automatically returned to the previous version - see the message shown and installer\update.log. ' + #13#10#13#10 +
      'Aurora continues to run as a Windows service; clinicians can reopen the access URL.';
end;
