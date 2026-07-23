; AURORA ICU — hospital installer (Inno Setup, installer Option B)
; HOSPITAL_INSTALLER_RUNTIME_DESIGN.md. Double-click → next → next → finish:
; lays down a self-contained .NET server + a private PostgreSQL + the AI model,
; collects the production install decisions in the wizard, then invokes
; aurora-provision.ps1 to register the Windows services (Automatic + SCM
; recovery), init + seed the DB, run the backup-key ceremony, register the
; nightly backup, and open the firewall. No Docker, no PowerShell for the
; operator, no internet.
;
; BUILD: installer\build.ps1 stages the payload and runs ISCC on this file.
; 🔎 WINDOWS-ONLY — compiled + run on Windows (ISCC is Windows-only). This
;    script is CODE-REVIEWED here; verify the wizard + install on the machine.

#define AppName "Aurora ICU"
#define AppVer  "1.0.0"
#define Publisher "Aurora HIS"

[Setup]
AppName={#AppName}
AppVersion={#AppVer}
AppPublisher={#Publisher}
DefaultDirName=C:\Aurora
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; services + firewall + SCM require elevation
PrivilegesRequired=admin
; only 64-bit Windows (the payload — .NET win-x64, Postgres x64 — is 64-bit);
; Setup runs in 64-bit install mode automatically on a matching OS. (Inno 6.4+
; removed the old ArchitecturesInstall64Bit directive in favour of this one.)
ArchitecturesAllowed=x64compatible
OutputBaseFilename=AuroraSetup-{#AppVer}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; the installer must not run over a live older instance without stopping it
CloseApplications=yes

[Files]
; the build script stages everything under payload\ :
;   payload\server\  = self-contained dotnet publish (AuroraIcu.Api.exe + wwwroot)
;   payload\pgsql\   = private PostgreSQL binaries (bin\ + share\ + lib\)
;   payload\model\   = the AI model file(s) (4.7 GB)
;   payload\scripts\ = aurora-provision.ps1 + aurora-backup.ps1
Source: "payload\server\*";  DestDir: "{app}\server";        Flags: recursesubdirs createallsubdirs ignoreversion
Source: "payload\pgsql\*";   DestDir: "{app}\pgsql";         Flags: recursesubdirs createallsubdirs ignoreversion
Source: "payload\model\*";   DestDir: "{app}\model";         Flags: recursesubdirs createallsubdirs ignoreversion skipifsourcedoesntexist
;   payload\llama\  = the native AI runtime: llama-server.exe (+ CUDA DLLs) + nssm.exe (PR C).
;   Absent when the build had no -LlamaDir/-ModelDir; then provisioning leaves the AI disabled.
Source: "payload\llama\*";   DestDir: "{app}\llama";         Flags: recursesubdirs createallsubdirs ignoreversion skipifsourcedoesntexist
Source: "aurora-provision.ps1"; DestDir: "{app}\server\scripts"; Flags: ignoreversion
Source: "aurora-backup.ps1";    DestDir: "{app}\server\scripts"; Flags: ignoreversion
Source: "aurora-ai-service.ps1"; DestDir: "{app}\server\scripts"; Flags: ignoreversion
Source: "aurora-enable-ai.ps1";  DestDir: "{app}\server\scripts"; Flags: ignoreversion
Source: "aurora-autowire.ps1";   DestDir: "{app}\server\scripts"; Flags: ignoreversion

[Code]
var
  DataDirPage: TInputDirWizardPage;
  UrlPage:     TInputQueryWizardPage;
  PwPage:      TInputQueryWizardPage;
  FormPage:    TInputOptionWizardPage;
  DetectedTz:  String;
  GpuPresent:  Boolean;

{ ---- best-effort detection (reviewed; runs on the target Windows) ---- }

procedure DetectTzAndGpu();
var rc: Integer;
begin
  { GPU: any NVIDIA video controller present? AI needs it (server-side only). }
  GpuPresent := Exec('powershell.exe',
    '-NoProfile -Command "if (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match ''NVIDIA'' }) { exit 0 } else { exit 1 }"',
    '', SW_HIDE, ewWaitUntilTerminated, rc) and (rc = 0);
  DetectedTz := '';  { converted best-effort by provisioning; blank = server displays UTC, operator can edit aurora.env }
end;

procedure InitializeWizard();
begin
  DetectTzAndGpu();

  DataDirPage := CreateInputDirPage(wpSelectDir,
    'Data location', 'Where should patient data, the database and backups live?',
    'Aurora stores the database and encrypted backups here. Use a large, ideally separate, drive.',
    False, '');
  DataDirPage.Add('');
  DataDirPage.Values[0] := 'C:\Aurora\data';

  UrlPage := CreateInputQueryPage(DataDirPage.ID,
    'Access address', 'The address clinicians open in their browser',
    'Enter this server''s address on the hospital network (not localhost). Every device — nurse stations, doctor laptops, tablets — opens this URL.');
  UrlPage.Add('Access URL (e.g. http://192.168.1.50:8080):', False);
  UrlPage.Values[0] := 'http://SERVER-IP:8080';

  PwPage := CreateInputQueryPage(UrlPage.ID,
    'First administrator', 'Set the first administrator password',
    'This is the ''admin'' account (System Administrator). You will be required to change it at first sign-in. It cannot be the shared demo password.');
  PwPage.Add('Password:', True);
  PwPage.Add('Confirm password:', True);

  FormPage := CreateInputOptionPage(PwPage.ID,
    'Medication formulary', 'How should the drug formulary start?',
    'Choose how the medication list is seeded. Pharmacy reviews and activates drugs afterwards.',
    True, False);
  FormPage.Add('Starter list (a reference formulary, all drugs DEACTIVATED until pharmacy reviews)');
  FormPage.Add('Empty (build the formulary from scratch)');
  FormPage.SelectedValueIndex := 0;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var url, dir: String;
begin
  Result := True;
  if CurPageID = wpSelectDir then begin
    { Refuse to install ON TOP of a source/development checkout of Aurora. Setup
      defaults to C:\Aurora, which on a BUILD machine is the git clone (from
      'git clone … aurora'); installing there would overwrite the source tree and
      collide the payload's server\ with the source server\. Empty folder only. }
    dir := WizardDirValue;
    if FileExists(AddBackslash(dir) + 'package.json') or DirExists(AddBackslash(dir) + '.git') then begin
      MsgBox('That folder looks like a source-code / development copy of Aurora' + #13#10 +
             '(it contains package.json or a .git folder). Installing here would' + #13#10 +
             'overwrite your source tree.' + #13#10#13#10 +
             'Pick an EMPTY folder for the hospital install — for example C:\AuroraICU.', mbError, MB_OK);
      Result := False;
    end;
  end else if CurPageID = UrlPage.ID then begin
    url := Lowercase(Trim(UrlPage.Values[0]));
    if (url = '') or (Pos('localhost', url) > 0) or (Pos('127.0.0.1', url) > 0) then begin
      MsgBox('Enter a real network address (not localhost) — this is what other devices connect to.', mbError, MB_OK);
      Result := False;
    end;
  end else if CurPageID = PwPage.ID then begin
    if PwPage.Values[0] = '' then begin
      MsgBox('Set an administrator password.', mbError, MB_OK); Result := False;
    end else if PwPage.Values[0] <> PwPage.Values[1] then begin
      MsgBox('The passwords do not match.', mbError, MB_OK); Result := False;
    end else if PwPage.Values[0] = 'Aurora2026!' then begin
      MsgBox('That is the shared demo password — choose a real one.', mbError, MB_OK); Result := False;
    end;
  end;
end;

{ show the backup key EXACTLY ONCE (a standard message box — copyable with Ctrl+C) }
procedure ShowKeyOnce(keyFile: String);
var lines: TArrayOfString; body: String; i: Integer;
begin
  if not LoadStringsFromFile(keyFile, lines) then Exit;
  body := '';
  for i := 0 to GetArrayLength(lines)-1 do body := body + lines[i] + #13#10;
  DeleteFile(keyFile);   { never persists off the ACL-locked server copy }
  MsgBox('BACKUP ENCRYPTION KEY — RECORD IT NOW (shown only once).'#13#10#13#10 +
         'Record this key in ALL THREE places before continuing:'#13#10 +
         '  1. a sealed envelope in the hospital safe'#13#10 +
         '  2. the enterprise password manager'#13#10 +
         '  3. the hospital-management copy'#13#10#13#10 +
         body + #13#10 +
         'Without this key a backup cannot be restored. The server keeps its own'#13#10 +
         'copy for nightly backups, but the server''s death loses that copy.'#13#10#13#10 +
         '(Press Ctrl+C to copy this window''s text.)', mbInformation, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var pwFile, keyFile, args, tz, seed: String; rc: Integer;
begin
  if CurStep <> ssPostInstall then Exit;

  { hand the admin password to provisioning via a temp file (never a visible arg) }
  pwFile  := ExpandConstant('{tmp}\aurora-admin.txt');
  keyFile := ExpandConstant('{tmp}\aurora-key.txt');
  SaveStringToFile(pwFile, PwPage.Values[0], False);
  if FormPage.SelectedValueIndex = 1 then seed := 'empty' else seed := 'starter';
  tz := DetectedTz;

  args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\server\scripts\aurora-provision.ps1') + '"' +
    ' -InstallDir "' + ExpandConstant('{app}') + '"' +
    ' -DataDir "'    + DataDirPage.Values[0] + '"' +
    ' -Port 8080' +
    ' -AccessUrl "'  + Trim(UrlPage.Values[0]) + '"' +
    ' -FormularySeed ' + seed +
    ' -AdminPasswordFile "' + pwFile + '"' +
    ' -KeyOutFile "' + keyFile + '"';
  if tz <> '' then args := args + ' -TimeZone "' + tz + '"';
  if GpuPresent then args := args + ' -AiEnabled';

  WizardForm.StatusLabel.Caption := 'Setting up Aurora (database, services, first backup)…';
  { SW_SHOW (not SW_HIDE): provisioning runs in a VISIBLE console. A hidden
    window turned any stall (e.g. antivirus vetting initdb.exe on first launch)
    into a frozen wizard with no console to close - the operator saw progress
    lines nowhere and could not cancel. Visible: they see each step, any AV
    prompt is answerable, and closing the console releases Setup. A full log is
    also written to provision.log in the install folder regardless. }
  if not Exec('powershell.exe', args, '', SW_SHOW, ewWaitUntilTerminated, rc) or (rc <> 0) then begin
    DeleteFile(pwFile);
    MsgBox('Setup could not finish (code ' + IntToStr(rc) + ').'#13#10#13#10 +
           'A full log is at ' + ExpandConstant('{app}\provision.log') + ' — open it to see the last step, or send it for support.'#13#10 +
           'If it stopped at the database step, add ' + ExpandConstant('{app}') + ' to the machine''s antivirus exclusions and run Setup again.', mbCriticalError, MB_OK);
    Abort;
  end;
  DeleteFile(pwFile);
  if FileExists(keyFile) then ShowKeyOnce(keyFile);
end;

{ Finished-page message: the access URL + always-on confirmation }
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption :=
      'Aurora ICU is installed and running as a Windows service — it starts automatically on every boot and restarts itself if it stops. ' + #13#10#13#10 +
      'Open ' + Trim(UrlPage.Values[0]) + ' in a browser from any device on the hospital network. Sign in as ''admin'' with the password you set (you will change it at first sign-in).';
end;

[UninstallRun]
; stop + remove the services on uninstall (data is left in place deliberately)
Filename: "sc.exe"; Parameters: "stop AuroraAI";       Flags: runhidden; RunOnceId: "stopai"
Filename: "sc.exe"; Parameters: "delete AuroraAI";      Flags: runhidden; RunOnceId: "delai"
Filename: "sc.exe"; Parameters: "stop AuroraServer";   Flags: runhidden; RunOnceId: "stopsrv"
Filename: "sc.exe"; Parameters: "delete AuroraServer";  Flags: runhidden; RunOnceId: "delsrv"
Filename: "sc.exe"; Parameters: "stop AuroraPostgres";  Flags: runhidden; RunOnceId: "stoppg"
Filename: "sc.exe"; Parameters: "delete AuroraPostgres"; Flags: runhidden; RunOnceId: "delpg"
Filename: "schtasks.exe"; Parameters: "/Delete /TN AuroraBackup /F"; Flags: runhidden; RunOnceId: "delbk"
