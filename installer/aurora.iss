; AURORA ICU - hospital installer (Inno Setup, installer Option B)
; HOSPITAL_INSTALLER_RUNTIME_DESIGN.md. Double-click -> next -> next -> finish:
; lays down a self-contained .NET server + a private PostgreSQL + the AI model,
; collects the production install decisions in the wizard, then invokes
; aurora-provision.ps1 to register the Windows services (Automatic + SCM
; recovery), init + seed the DB, run the backup-key ceremony, register the
; nightly backup, and open the firewall. No Docker, no PowerShell for the
; operator, no internet.
;
; BUILD: installer\build.ps1 stages the payload and runs ISCC on this file.
; WINDOWS-ONLY - compiled + run on Windows (ISCC is Windows-only). This
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
; only 64-bit Windows (the payload - .NET win-x64, Postgres x64 - is 64-bit);
; Setup runs in 64-bit install mode automatically on a matching OS. (Inno 6.4+
; removed the old ArchitecturesInstall64Bit directive in favour of this one.)
ArchitecturesAllowed=x64compatible
; ---- install-password wiring (two encrypted paths, one plain) ----
; CONFIGURED PATH (owner's decision 2026-07-25): the SINGLE COMPANY password.
; build-protected.ps1 places it in ISCC's process ENVIRONMENT (never on the
; command line), and this file adopts it here at preprocess time. DORMANT
; at-scale alternative: per-hospital builds - build-hospitals.ps1 passes
; /DHospitalId + /DInstallPassword explicitly and wins over the environment.
; Protection state is IN the output filename by construction: -PROTECTED
; only ever names an encrypted build, -UNPROTECTED (plain build.ps1, smoke
; tests only) never ships.
#ifndef InstallPassword
  #if GetEnv("AURORA_INSTALL_PASSWORD") != ""
    #define InstallPassword GetEnv("AURORA_INSTALL_PASSWORD")
  #endif
#endif
#ifdef HospitalId
  #ifndef InstallPassword
    #error "Per-hospital builds must be encrypted - use build-hospitals.ps1, which passes /DInstallPassword"
  #endif
OutputBaseFilename=AuroraSetup-{#AppVer}-{#HospitalId}
#elif defined(InstallPassword)
OutputBaseFilename=AuroraSetup-{#AppVer}-PROTECTED
#else
OutputBaseFilename=AuroraSetup-{#AppVer}-UNPROTECTED
#endif
#ifdef InstallPassword
; ENCRYPTED build. The whole payload is XChaCha20-encrypted (built into
; Inno Setup since 6.4.0; the key is PBKDF2-HMAC-SHA256-derived from this
; password), so a copied AuroraSetup.exe without the install password
; cannot be installed and its PAYLOAD (server, database engine, AI model,
; scripts) cannot be extracted. Honest limit: the setup METADATA - file
; names, paths, messages and this compiled [Code] wizard, including the
; reinstall-guard logic - is NOT encrypted and is readable with standard
; Inno tools; only the file data is protected. Custody model of the
; configured path: the company password is held by the vendor's engineer
; ALONE and typed on site at every install - the hospital never receives
; or stores it, and a reinstall therefore always involves the vendor. It
; is a DIFFERENT secret from the backup encryption key (which the HOSPITAL
; must hold, in three places): a lost install password is reissued by
; rebuilding; a lost backup key is unrecoverable.
Password={#InstallPassword}
Encryption=yes
#endif
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
  DetectedIp:  String;
  GpuPresent:  Boolean;
  { reinstall guard state (see the REINSTALL GUARD block below) }
  ExistingDetected: Boolean;
  ExistingRoot, ExistingPgData, ExistingDataDir, ExistingBackupDir: String;
  ExistingKeyFile, ExistingKeyId, ExistingKeyHex: String;
  ExistingUsb, ExistingPort, ExistingTz: String;
  GuardPage: TWizardPage;
  GuardMemo: TNewMemo;
  GuardOptExit, GuardOptContinue: TNewRadioButton;
  GuardKeyLabel: TNewStaticText;
  GuardKeyEdit: TNewEdit;
  GuardAbort: Boolean;

{ ---- best-effort detection (reviewed; runs on the target Windows) ---- }

{ Detect this server's LAN IPv4 so the wizard can PRE-FILL the access address -
  the operator usually does not know the server's IP, and a typed/stale value is
  exactly what stranded the first install. Prefer the interface with the default
  route; skip loopback + APIPA. Best-effort: on any failure the field stays a
  placeholder and provisioning still derives the authoritative URL for the finish
  page. PowerShell cannot return a value to Inno directly, so it writes the IP to
  a temp file we read back. }
procedure DetectPrimaryIp();
var rc: Integer; tmp: String; lines: TArrayOfString;
begin
  DetectedIp := '';
  tmp := ExpandConstant('{tmp}\aurora-ip.txt');
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "try { $r = Get-NetRoute -DestinationPrefix ''0.0.0.0/0'' -EA SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1; $a = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $r.InterfaceIndex -EA SilentlyContinue | Where-Object { $_.IPAddress -notmatch ''^(127\.|169\.254\.)'' } | Select-Object -First 1; if ($a) { Set-Content -Encoding ascii -Path ''' + tmp + ''' -Value $a.IPAddress } } catch {}"',
    '', SW_HIDE, ewWaitUntilTerminated, rc);
  if LoadStringsFromFile(tmp, lines) and (GetArrayLength(lines) > 0) then DetectedIp := Trim(lines[0]);
  DeleteFile(tmp);
end;

procedure DetectTzAndGpu();
var rc: Integer;
begin
  { GPU: any NVIDIA video controller present? AI needs it (server-side only). }
  GpuPresent := Exec('powershell.exe',
    '-NoProfile -Command "if (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match ''NVIDIA'' }) { exit 0 } else { exit 1 }"',
    '', SW_HIDE, ewWaitUntilTerminated, rc) and (rc = 0);
  DetectedTz := '';  { converted best-effort by provisioning; blank = server displays UTC, operator can edit aurora.env }
  DetectPrimaryIp();
end;

{ ---- REINSTALL GUARD ----------------------------------------------------
  The risk that actually materialised in production: Setup re-run on a machine
  that already runs Aurora, pointed at NEW locations, re-registers the services
  elsewhere and orphans the live database - and, because a fresh secrets folder
  gets a fresh key, orphans every existing backup with it. This installer is
  for FIRST installs; upgrades are AuroraUpdate's job.

  So: detect the registered Aurora services BEFORE any wizard page, state what
  exists, default to closing Setup, and let an operator continue ONLY after
  proving the current backup key was recorded (typing its key id or the full
  key from the sealed envelope). On continue, every location field is steered
  to the EXISTING install so the default outcome is an in-place repair, not a
  second install elsewhere. A machine with no Aurora services (fresh hardware,
  a disaster rebuild) never sees any of this. }

function SvcImagePath(svc: String): String;
begin
  Result := '';
  if not RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Services\' + svc,
    'ImagePath', Result) then Result := '';
end;

{ the executable path out of a service ImagePath - quoted or bare }
function ExeOfImagePath(ip: String): String;
var p: Integer;
begin
  ip := Trim(ip);
  if (Length(ip) > 0) and (ip[1] = '"') then begin
    ip := Copy(ip, 2, Length(ip));
    p := Pos('"', ip);
    if p > 0 then ip := Copy(ip, 1, p - 1);
  end else begin
    p := Pos('.exe', Lowercase(ip));
    if p > 0 then ip := Copy(ip, 1, p + 3);
  end;
  Result := Trim(ip);
end;

{ the -D <datadir> argument out of the AuroraPostgres ImagePath }
function PgDataOfImagePath(ip: String): String;
var p, q: Integer; rest: String;
begin
  Result := '';
  p := Pos(' -D ', ip);
  if p = 0 then Exit;
  rest := Trim(Copy(ip, p + 4, Length(ip)));
  if (Length(rest) > 0) and (rest[1] = '"') then begin
    rest := Copy(rest, 2, Length(rest));
    q := Pos('"', rest);
    if q > 0 then Result := Copy(rest, 1, q - 1);
  end else begin
    q := Pos(' ', rest);
    if q > 0 then Result := Copy(rest, 1, q - 1) else Result := rest;
  end;
end;

function EnvValueOf(envFile, key: String): String;
var lines: TArrayOfString; i: Integer;
begin
  Result := '';
  if not LoadStringsFromFile(envFile, lines) then Exit;
  for i := 0 to GetArrayLength(lines) - 1 do
    if Pos(key + '=', lines[i]) = 1 then begin
      Result := Trim(Copy(lines[i], Length(key) + 2, Length(lines[i])));
      Exit;
    end;
end;

function FirstLineLower(f: String): String;
var lines: TArrayOfString;
begin
  Result := '';
  if LoadStringsFromFile(f, lines) and (GetArrayLength(lines) > 0) then
    Result := Lowercase(Trim(lines[0]));
end;

{ The key id EXACTLY as the server computes it (BackupService.KeyIdOf): the key
  file holds 64 hex chars; the id is the first 8 hex of SHA256 over the DECODED
  32 raw bytes. Pascal Script cannot hash raw bytes, so PowerShell runs the
  identical computation and relays the id through a temp file. Best-effort: on
  any failure the guard falls back to the typed-REPLACE confirmation. }
function ComputeKeyId(keyFile: String): String;
var rc: Integer; tmp, cmd: String; lines: TArrayOfString;
begin
  Result := '';
  if (keyFile = '') or (not FileExists(keyFile)) then Exit;
  tmp := ExpandConstant('{tmp}\aurora-keyid.txt');
  cmd := '-NoProfile -ExecutionPolicy Bypass -Command "try { ' +
    '$hex = (Get-Content -Raw ''' + keyFile + ''').Trim(); ' +
    '$b = New-Object byte[] ($hex.Length / 2); ' +
    'for ($i = 0; $i -lt $b.Length; $i++) { $b[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }; ' +
    '$h = [System.Security.Cryptography.SHA256]::Create().ComputeHash($b); ' +
    '$id = -join ($h[0..3] | ForEach-Object { $_.ToString(''x2'') }); ' +
    'Set-Content -Encoding ascii -Path ''' + tmp + ''' -Value $id } catch {}"';
  Exec('powershell.exe', cmd, '', SW_HIDE, ewWaitUntilTerminated, rc);
  if LoadStringsFromFile(tmp, lines) and (GetArrayLength(lines) > 0) then
    Result := Lowercase(Trim(lines[0]));
  DeleteFile(tmp);
end;

procedure DetectExistingInstall();
var ipSrv, ipPg, exePath: String;
begin
  ExistingDetected := False;
  ipSrv := SvcImagePath('AuroraServer');
  ipPg  := SvcImagePath('AuroraPostgres');
  if (ipSrv = '') and (ipPg = '') then Exit;
  ExistingDetected := True;
  exePath := ExeOfImagePath(ipSrv);
  if exePath <> '' then ExistingRoot := ExtractFileDir(ExtractFileDir(exePath));
  ExistingPgData := PgDataOfImagePath(ipPg);
  if ExistingPgData <> '' then ExistingDataDir := ExtractFileDir(ExistingPgData);
  if ExistingRoot <> '' then begin
    ExistingBackupDir := EnvValueOf(ExistingRoot + '\server\aurora.env', 'BACKUP_DIR');
    ExistingKeyFile   := EnvValueOf(ExistingRoot + '\server\aurora.env', 'BACKUP_KEY_FILE');
    { carried into the wizard on continue, so an in-place repair does not
      silently drop the off-site mirror, the port or the hospital clock }
    ExistingUsb  := EnvValueOf(ExistingRoot + '\server\aurora.env', 'BACKUP_USB');
    ExistingPort := EnvValueOf(ExistingRoot + '\server\aurora.env', 'PORT');
    ExistingTz   := EnvValueOf(ExistingRoot + '\server\aurora.env', 'TZ');
  end;
  { historical installs put secrets under <DataDir>\secrets - the fallback when
    the env file is missing or does not name the key file }
  if (ExistingKeyFile = '') and (ExistingDataDir <> '') then
    ExistingKeyFile := ExistingDataDir + '\secrets\backup.key';
  ExistingKeyId  := ComputeKeyId(ExistingKeyFile);
  ExistingKeyHex := FirstLineLower(ExistingKeyFile);
end;

procedure GuardOptClick(Sender: TObject);
begin
  GuardKeyEdit.Enabled  := GuardOptContinue.Checked;
  GuardKeyLabel.Enabled := GuardOptContinue.Checked;
end;

procedure CreateGuardPage();
var s, shown, dbState, keyState: String;
begin
  GuardPage := CreateCustomPage(wpWelcome, 'Aurora is ALREADY INSTALLED on this machine',
    'Read this before going any further');

  if ExistingPgData <> '' then begin
    if FileExists(AddBackslash(ExistingPgData) + 'PG_VERSION') then
      dbState := ExistingPgData + '  (database files PRESENT)'
    else
      dbState := ExistingPgData + '  (files NOT FOUND at the registered location)';
  end else dbState := '(could not read the registered database location)';
  if ExistingKeyFile <> '' then begin
    if FileExists(ExistingKeyFile) then keyState := ExistingKeyFile + '  (present)'
    else keyState := ExistingKeyFile + '  (MISSING)';
  end else keyState := '(unknown)';
  if ExistingRoot <> '' then shown := ExistingRoot else shown := '(unknown)';

  s := 'Setup found Aurora ICU services already registered on this machine:' + #13#10#13#10 +
       '  Install folder:   ' + shown + #13#10 +
       '  Database:         ' + dbState + #13#10 +
       '  Backups:          ' + ExistingBackupDir + #13#10 +
       '  Backup key file:  ' + keyState + #13#10#13#10 +
       'This installer is for FIRST installs and disaster rebuilds. Running it' + #13#10 +
       'again is NOT how Aurora is upgraded:' + #13#10#13#10 +
       '  - Upgrades: run AuroraUpdate-<version>.exe instead. It keeps the' + #13#10 +
       '    database, the backup key and every setting.' + #13#10 +
       '  - If you continue, the install and database locations are LOCKED to' + #13#10 +
       '    the existing install shown above. This machine''s Aurora services' + #13#10 +
       '    can only point at ONE place, so Setup will not create a second copy' + #13#10 +
       '    elsewhere. Moving Aurora to different disks or another machine is a' + #13#10 +
       '    support operation, not a reinstall. (The BACKUP locations may be' + #13#10 +
       '    changed - they are settings, not services.)' + #13#10 +
       '  - Continuing re-runs setup IN PLACE: the existing database and backup' + #13#10 +
       '    key are KEPT. If the database files above are missing (a wiped data' + #13#10 +
       '    disk), a FRESH database and a NEW backup key are created at the same' + #13#10 +
       '    locations - backups already made still need the OLD recorded key.' + #13#10 +
       '  - Existing sign-ins keep working. The administrator password typed' + #13#10 +
       '    later in this wizard takes effect ONLY on a brand-new database.';

  GuardMemo := TNewMemo.Create(GuardPage);
  GuardMemo.Parent := GuardPage.Surface;
  GuardMemo.Left := 0;
  GuardMemo.Top := 0;
  GuardMemo.Width := GuardPage.SurfaceWidth;
  GuardMemo.Height := GuardPage.SurfaceHeight - ScaleY(96);
  GuardMemo.ReadOnly := True;
  GuardMemo.ScrollBars := ssVertical;
  GuardMemo.Text := s;

  GuardOptExit := TNewRadioButton.Create(GuardPage);
  GuardOptExit.Parent := GuardPage.Surface;
  GuardOptExit.Left := 0;
  GuardOptExit.Top := GuardMemo.Top + GuardMemo.Height + ScaleY(6);
  GuardOptExit.Width := GuardPage.SurfaceWidth;
  GuardOptExit.Caption := 'Close Setup (recommended) - I will use AuroraUpdate or ask for support';
  GuardOptExit.Checked := True;
  GuardOptExit.OnClick := @GuardOptClick;

  GuardOptContinue := TNewRadioButton.Create(GuardPage);
  GuardOptContinue.Parent := GuardPage.Surface;
  GuardOptContinue.Left := 0;
  GuardOptContinue.Top := GuardOptExit.Top + ScaleY(18);
  GuardOptContinue.Width := GuardPage.SurfaceWidth;
  GuardOptContinue.Caption := 'Continue anyway - I have read the warning above';
  GuardOptContinue.OnClick := @GuardOptClick;

  GuardKeyLabel := TNewStaticText.Create(GuardPage);
  GuardKeyLabel.Parent := GuardPage.Surface;
  GuardKeyLabel.Left := 0;
  GuardKeyLabel.Top := GuardOptContinue.Top + ScaleY(20);
  GuardKeyLabel.Width := GuardPage.SurfaceWidth;
  GuardKeyLabel.AutoSize := False;
  GuardKeyLabel.WordWrap := True;
  GuardKeyLabel.Height := ScaleY(28);
  { The gate is the KEY FILE's readability, not the id-relay's success: as long
    as the key was read, the operator must prove custody of the recorded copy
    (the relay only adds the short-id convenience). REPLACE is accepted ONLY
    when the key file itself is missing/unreadable - then there is truly
    nothing to check against. }
  if ExistingKeyHex <> '' then begin
    if ExistingKeyId <> '' then
      GuardKeyLabel.Caption :=
        'Prove the current backup key was recorded: type its 8-character key id (or the full 64-character key) from the sealed envelope:'
    else
      GuardKeyLabel.Caption :=
        'Prove the current backup key was recorded: type the FULL 64-character key from the sealed envelope (the short key id cannot be verified on this machine):';
  end else
    GuardKeyLabel.Caption :=
      'The current backup key file could NOT be read, so there is nothing to check the envelope against. Type REPLACE to accept the risk:';
  GuardKeyLabel.Enabled := False;

  GuardKeyEdit := TNewEdit.Create(GuardPage);
  GuardKeyEdit.Parent := GuardPage.Surface;
  GuardKeyEdit.Left := 0;
  GuardKeyEdit.Top := GuardKeyLabel.Top + GuardKeyLabel.Height + ScaleY(2);
  GuardKeyEdit.Width := GuardPage.SurfaceWidth;
  GuardKeyEdit.Enabled := False;
end;

procedure InitializeWizard();
var pwDesc: String;
begin
  DetectExistingInstall();
  if ExistingDetected then CreateGuardPage();
  DetectTzAndGpu();

  { Three separate locations, because putting them on ONE disk is the single
    biggest recoverability mistake: if the database and its backups share a
    drive, one failure destroys both at the same instant. The wizard now asks
    for the backup target separately (and warns on a same-drive choice), plus
    an optional OFF-SITE disk that the nightly job mirrors to. }
  DataDirPage := CreateInputDirPage(wpSelectDir,
    'Data and backup locations', 'Where should the database, the backups and the off-site copy live?',
    'The DATABASE and the BACKUPS should be on DIFFERENT physical disks - otherwise one disk failure '
    + 'destroys the patient record AND every backup of it together. The off-site disk is a removable '
    + 'drive you rotate away from the building; leave it blank if you do not have one yet.',
    False, '');
  DataDirPage.Add('Database + data location:');
  DataDirPage.Add('Backup location (use a DIFFERENT drive):');
  DataDirPage.Add('Off-site copy - removable/second disk (OPTIONAL, leave blank if none):');
  DataDirPage.Values[0] := 'C:\Aurora\data';
  { Deliberately NOT a subfolder of the data location: the default must not
    quietly put the backups on the same disk as the database. D: is the common
    second drive; if this machine has no D:, the operator changes it and the
    same-drive warning fires on Next, which is exactly the conversation we want
    them to have BEFORE the hospital depends on it. }
  DataDirPage.Values[1] := 'D:\AuroraBackups';
  DataDirPage.Values[2] := '';

  UrlPage := CreateInputQueryPage(DataDirPage.ID,
    'Access address', 'The address clinicians open in their browser',
    'This server''s address on the hospital network - every device (nurse stations, doctor laptops, tablets) opens http://<this address>. It is filled in automatically from this machine; change it only if you use a fixed hostname. Do not use localhost.');
  UrlPage.Add('Server address (IP or hostname, not localhost):', False);
  UrlPage.Add('Port (8080 is the default; enter 80 so staff can leave the port off):', False);
  if DetectedIp <> '' then UrlPage.Values[0] := DetectedIp else UrlPage.Values[0] := 'SERVER-IP';
  UrlPage.Values[1] := '8080';

  pwDesc := 'This is the ''admin'' account (System Administrator). You will be required to change it at first sign-in. It cannot be the shared demo password.';
  { Honesty on a reinstall: the server applies this bootstrap password ONLY
    when the database has no user accounts yet. Over an existing database the
    typed value changes nothing - say so HERE, not after the fact. }
  if ExistingDetected then
    pwDesc := pwDesc + ' NOTE: this machine already has an Aurora database - existing sign-ins keep working, and this password takes effect ONLY if the database is brand-new or empty (for example after a wiped data disk).';
  PwPage := CreateInputQueryPage(UrlPage.ID,
    'First administrator', 'Set the first administrator password', pwDesc);
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

{ Drive letter of a path ('D:' from 'D:\Aurora\backups'), uppercased; '' when
  the path is a UNC/network share, which we treat as a different device. }
function DriveOf(path: String): String;
begin
  Result := '';
  path := Trim(path);
  if (Length(path) >= 2) and (path[2] = ':') then Result := Uppercase(Copy(path, 1, 2));
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var url, dir, dbDrv, bkDrv, usbDrv, t: String; p: Integer;
begin
  Result := True;
  if ExistingDetected then begin
    if CurPageID = GuardPage.ID then begin
      if GuardOptExit.Checked then begin
        GuardAbort := True;
        WizardForm.Close;
        Result := False;
        Exit;
      end;
      t := Lowercase(Trim(GuardKeyEdit.Text));
      if ExistingKeyHex <> '' then begin
        { never echo the expected id or key - the typed value must come from
          the operator's own record, or this proves nothing. The full key is
          always accepted; the short id only when the relay could verify it. }
        if (t <> ExistingKeyHex) and ((ExistingKeyId = '') or (t <> ExistingKeyId)) then begin
          if ExistingKeyId <> '' then
            MsgBox('That does not match this machine''s current backup key.'#13#10#13#10 +
                   'Type the 8-character key id (or the full key) exactly as recorded in the sealed ' +
                   'envelope. If the envelope cannot be found, STOP: without the recorded key, every ' +
                   'existing backup is unreadable anywhere but this machine.', mbError, MB_OK)
          else
            MsgBox('That does not match this machine''s current backup key.'#13#10#13#10 +
                   'Type the FULL 64-character key exactly as recorded in the sealed envelope. ' +
                   'If the envelope cannot be found, STOP: without the recorded key, every ' +
                   'existing backup is unreadable anywhere but this machine.', mbError, MB_OK);
          Result := False;
          Exit;
        end;
      end else begin
        if Trim(GuardKeyEdit.Text) <> 'REPLACE' then begin
          MsgBox('Type REPLACE (capitals) to continue, or choose Close Setup.', mbError, MB_OK);
          Result := False;
          Exit;
        end;
      end;
      { A continue with UNKNOWN existing locations cannot be made safe: the
        registered services cannot be re-pointed by this installer, so Setup
        must not guess where they live. }
      if (ExistingRoot = '') or (ExistingDataDir = '') then begin
        MsgBox('Setup could not determine the existing install''s locations from the registered ' +
               'services, so it cannot safely re-run setup in place.'#13#10#13#10 +
               'Use AuroraUpdate for upgrades, or contact support for repair.', mbError, MB_OK);
        Result := False;
        Exit;
      end;
      { LOCK the rest of the wizard to the EXISTING install. The services can
        only point at one place; the location pages below enforce the same
        lock if these values are edited. Backup targets + port + TZ are
        carried from the live aurora.env so a repair keeps them. }
      WizardForm.DirEdit.Text := ExistingRoot;
      DataDirPage.Values[0] := ExistingDataDir;
      if ExistingBackupDir <> '' then DataDirPage.Values[1] := ExistingBackupDir;
      if ExistingUsb <> '' then DataDirPage.Values[2] := ExistingUsb;
      if StrToIntDef(Trim(ExistingPort), 0) > 0 then UrlPage.Values[1] := Trim(ExistingPort);
      if ExistingTz <> '' then DetectedTz := ExistingTz;
      Exit;
    end;
  end;
  if CurPageID = DataDirPage.ID then begin
    { LOCKED on a continue-anyway, same reason as the install folder: the
      AuroraPostgres service's -D argument cannot be re-pointed by Setup.
      The BACKUP fields stay editable - they are settings, not services. }
    if ExistingDetected and (CompareText(Trim(DataDirPage.Values[0]), ExistingDataDir) <> 0) then begin
      MsgBox('The database location is locked to the existing install:'#13#10 +
             '    ' + ExistingDataDir + #13#10#13#10 +
             'The registered database service points there and Setup cannot re-point it. ' +
             'The backup locations below MAY be changed.', mbError, MB_OK);
      DataDirPage.Values[0] := ExistingDataDir;
      Result := False;
      Exit;
    end;
    dbDrv  := DriveOf(DataDirPage.Values[0]);
    bkDrv  := DriveOf(DataDirPage.Values[1]);
    usbDrv := DriveOf(DataDirPage.Values[2]);
    if Trim(DataDirPage.Values[1]) = '' then begin
      MsgBox('Choose a backup location.', mbError, MB_OK);
      Result := False;
    end else if (dbDrv <> '') and (dbDrv = bkDrv) then begin
      { Warn, do not block: some hospitals genuinely have one disk today. They
        must SEE the consequence and choose it deliberately. }
      Result := MsgBox('The database and the backups are both on drive ' + dbDrv + '.'#13#10#13#10 +
        'If that disk fails, you lose the patient record AND every backup of it AT THE SAME TIME.'#13#10#13#10 +
        'Strongly recommended: put the backups on a different physical disk, and set an off-site copy.'#13#10#13#10 +
        'Continue anyway with both on ' + dbDrv + ' ?', mbConfirmation, MB_YESNO) = IDYES;
    end;
    if Result and (Trim(DataDirPage.Values[2]) <> '') and (usbDrv <> '') and (usbDrv = dbDrv) then begin
      MsgBox('The off-site copy is on the SAME drive (' + usbDrv + ') as the database, so it is not an '
        + 'off-site copy at all - it dies with the same disk.'#13#10#13#10 +
        'Pick a removable/second disk, or leave it blank.', mbError, MB_OK);
      Result := False;
    end;
    { An ORPHANED database at the chosen location (services gone - e.g. after an
      uninstall - but the data deliberately left in place): say out loud that it
      is adopted, not wiped - and be honest about the condition. Provisioning
      skips initdb when PG_VERSION exists, but it can only adopt the cluster
      when the original aurora.env (beside the old server exe) survived to
      reuse its credentials; without it, Setup stops SAFELY at the database
      step rather than guess - the database files are not touched either way. }
    if Result and (not ExistingDetected) and
       FileExists(AddBackslash(Trim(DataDirPage.Values[0])) + 'pg\PG_VERSION') then
      MsgBox('An existing Aurora database was found at ' + Trim(DataDirPage.Values[0]) + '\pg.'#13#10#13#10 +
        'It is NEVER wiped or reseeded. If the original install folder (with its aurora.env '
        + 'configuration file) still exists, the install adopts the database and continues on top of it. '
        + 'If that folder is gone, Setup will STOP SAFELY at the database step - restore the original '
        + 'aurora.env or contact support; the database files are not touched either way.',
        mbInformation, MB_OK);
  end;
  if CurPageID = wpSelectDir then begin
    dir := WizardDirValue;
    if ExistingDetected then begin
      { LOCKED on a continue-anyway: the registered services point here and
        this installer cannot re-point them, so any other folder would produce
        a broken second copy while the old install keeps running. }
      if CompareText(Trim(dir), ExistingRoot) <> 0 then begin
        MsgBox('Aurora is already installed at'#13#10 + '    ' + ExistingRoot + #13#10#13#10 +
               'and this machine''s services can only point at ONE install, so the install ' +
               'folder is locked to that location. Moving Aurora is a support operation, ' +
               'not a reinstall.', mbError, MB_OK);
        WizardForm.DirEdit.Text := ExistingRoot;
        Result := False;
      end;
      { the source-checkout test below is skipped when locked-equal: if the
        existing install already lives inside a checkout, re-running in place
        maintains the status quo - blocking here would leave NO valid path }
    end else begin
      { Refuse to install ON TOP of a source/development checkout of Aurora. Setup
        defaults to C:\Aurora, which on a BUILD machine is the git clone (from
        'git clone ... aurora'); installing there would overwrite the source tree and
        collide the payload's server\ with the source server\. Empty folder only. }
      if FileExists(AddBackslash(dir) + 'package.json') or DirExists(AddBackslash(dir) + '.git') then begin
        MsgBox('That folder looks like a source-code / development copy of Aurora' + #13#10 +
               '(it contains package.json or a .git folder). Installing here would' + #13#10 +
               'overwrite your source tree.' + #13#10#13#10 +
               'Pick an EMPTY folder for the hospital install - for example C:\AuroraICU.', mbError, MB_OK);
        Result := False;
      end;
    end;
  end else if CurPageID = UrlPage.ID then begin
    url := Lowercase(Trim(UrlPage.Values[0]));
    if (url = '') or (Pos('localhost', url) > 0) or (Pos('127.0.0.1', url) > 0) or (Pos('server-ip', url) > 0) then begin
      MsgBox('Enter this server''s real network address (not localhost) - this is what other devices connect to.', mbError, MB_OK);
      Result := False;
    end else begin
      p := StrToIntDef(Trim(UrlPage.Values[1]), -1);
      if (p < 1) or (p > 65535) then begin
        MsgBox('Enter a valid port number (1-65535). The default is 8080.', mbError, MB_OK);
        Result := False;
      end else if (p = 5432) or (p = 8081) then begin
        MsgBox('Port ' + IntToStr(p) + ' is reserved by Aurora (5432 = database, 8081 = AI).' + #13#10 +
               'Choose another - 8080 is the default, or 80 so staff can omit the port.', mbError, MB_OK);
        Result := False;
      end;
    end;
  end else if CurPageID = PwPage.ID then begin
    if PwPage.Values[0] = '' then begin
      MsgBox('Set an administrator password.', mbError, MB_OK); Result := False;
    end else if PwPage.Values[0] <> PwPage.Values[1] then begin
      MsgBox('The passwords do not match.', mbError, MB_OK); Result := False;
    end else if PwPage.Values[0] = 'Aurora2026!' then begin
      MsgBox('That is the shared demo password - choose a real one.', mbError, MB_OK); Result := False;
    end;
  end;
end;

{ the guard's Close-Setup choice already confirmed intent - skip the exit prompt }
procedure CancelButtonClick(CurPageID: Integer; var Cancel, Confirm: Boolean);
begin
  if GuardAbort then Confirm := False;
end;

{ On a continue-anyway over a live install, the running services hold locks on
  the very files [Files] is about to replace (CloseApplications only covers
  interactive applications, not services). Stop them first; Stop-Service waits
  for the stop to complete. Fresh machines skip this entirely. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var rc: Integer;
begin
  Result := '';
  if not ExistingDetected then Exit;
  WizardForm.StatusLabel.Caption := 'Stopping the existing Aurora services...';
  Exec('powershell.exe',
    '-NoProfile -Command "Stop-Service -Name AuroraAI,AuroraServer,AuroraPostgres -Force -ErrorAction SilentlyContinue"',
    '', SW_HIDE, ewWaitUntilTerminated, rc);
end;

{ show the backup key EXACTLY ONCE (a standard message box - copyable with Ctrl+C) }
procedure ShowKeyOnce(keyFile: String);
var lines: TArrayOfString; body: String; i: Integer;
begin
  if not LoadStringsFromFile(keyFile, lines) then Exit;
  body := '';
  for i := 0 to GetArrayLength(lines)-1 do body := body + lines[i] + #13#10;
  DeleteFile(keyFile);   { never persists off the ACL-locked server copy }
  MsgBox('BACKUP ENCRYPTION KEY - RECORD IT NOW (shown only once).'#13#10#13#10 +
         'Record this key in ALL THREE places before continuing:'#13#10 +
         '  1. a sealed envelope in the hospital safe'#13#10 +
         '  2. the enterprise password manager'#13#10 +
         '  3. the hospital-management copy'#13#10#13#10 +
         body + #13#10 +
         'Without this key a backup cannot be restored. The server keeps its own'#13#10 +
         'copy for nightly backups, but the server''s death loses that copy.'#13#10#13#10 +
         '(Press Ctrl+C to copy this window''s text.)', mbInformation, MB_OK);
end;

{ Quote a value as ONE powershell.exe argument. A path chosen as a drive root
  (e.g. D:\) or any value ending in '\' would, inside "...", let the trailing
  backslash ESCAPE the closing quote (the CommandLineToArgvW rule) - swallowing
  the next parameter (that is why -Port got eaten and provisioning prompted for
  it). Doubling a trailing backslash makes it a literal '\' and closes the quote
  cleanly. }
function QArg(s: String): String;
begin
  if (Length(s) > 0) and (s[Length(s)] = '\') then s := s + '\';
  Result := '"' + s + '"';
end;

function ChosenPort(): Integer;
begin
  Result := StrToIntDef(Trim(UrlPage.Values[1]), 8080);
end;

{ Build the access URL from the address + port fields. Tolerates the operator
  pasting a scheme/path/inline-port into the address box (the Port field is
  authoritative). Port 80 is written WITHOUT ':80' so staff type just the host. }
function BuildAccessUrl(): String;
var host: String; port: Integer;
begin
  host := Trim(UrlPage.Values[0]);
  if Pos('://', host) > 0 then host := Copy(host, Pos('://', host) + 3, Length(host));
  if Pos('/', host) > 0 then host := Copy(host, 1, Pos('/', host) - 1);
  if Pos(':', host) > 0 then host := Copy(host, 1, Pos(':', host) - 1);
  port := ChosenPort();
  if port = 80 then Result := 'http://' + host
  else Result := 'http://' + host + ':' + IntToStr(port);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var pwFile, keyFile, urlFile, args, tz, seed: String; rc: Integer;
begin
  if CurStep <> ssPostInstall then Exit;

  { hand the admin password to provisioning via a temp file (never a visible arg) }
  pwFile  := ExpandConstant('{tmp}\aurora-admin.txt');
  keyFile := ExpandConstant('{tmp}\aurora-key.txt');
  urlFile := ExpandConstant('{tmp}\aurora-url.txt');   { provisioning writes the REAL access URL + DHCP flag here }
  SaveStringToFile(pwFile, PwPage.Values[0], False);
  if FormPage.SelectedValueIndex = 1 then seed := 'empty' else seed := 'starter';
  tz := DetectedTz;

  args := '-NoProfile -ExecutionPolicy Bypass -File ' + QArg(ExpandConstant('{app}\server\scripts\aurora-provision.ps1')) +
    ' -InstallDir ' + QArg(ExpandConstant('{app}')) +
    ' -DataDir '    + QArg(DataDirPage.Values[0]) +
    ' -BackupDir '  + QArg(DataDirPage.Values[1]) +
    (' -BackupUsb ' + QArg(Trim(DataDirPage.Values[2]))) +
    ' -Port ' + IntToStr(ChosenPort()) +
    ' -AccessUrl '  + QArg(BuildAccessUrl()) +
    ' -FormularySeed ' + seed +
    ' -AdminPasswordFile ' + QArg(pwFile) +
    ' -KeyOutFile ' + QArg(keyFile) +
    ' -UrlOutFile ' + QArg(urlFile);
  if tz <> '' then args := args + ' -TimeZone ' + QArg(tz);
  if GpuPresent then args := args + ' -AiEnabled';

  WizardForm.StatusLabel.Caption := 'Setting up Aurora (database, services, first backup)...';
  { SW_SHOW (not SW_HIDE): provisioning runs in a VISIBLE console. A hidden
    window turned any stall (e.g. antivirus vetting initdb.exe on first launch)
    into a frozen wizard with no console to close - the operator saw progress
    lines nowhere and could not cancel. Visible: they see each step, any AV
    prompt is answerable, and closing the console releases Setup. A full log is
    also written to provision.log in the install folder regardless. }
  if not Exec('powershell.exe', args, '', SW_SHOW, ewWaitUntilTerminated, rc) or (rc <> 0) then begin
    DeleteFile(pwFile);
    MsgBox('Setup could not finish (code ' + IntToStr(rc) + ').'#13#10#13#10 +
           'A full log is at ' + ExpandConstant('{app}\provision.log') + ' - open it to see the last step, or send it for support.'#13#10 +
           'If it stopped at the database step, add ' + ExpandConstant('{app}') + ' to the machine''s antivirus exclusions and run Setup again.', mbCriticalError, MB_OK);
    Abort;
  end;
  DeleteFile(pwFile);
  if FileExists(keyFile) then ShowKeyOnce(keyFile);
end;

{ Finished-page message: the REAL, working access URL (derived by provisioning
  from this server's live interface + the bound port, not the typed value which
  can be portless or DHCP-stale), plus a DHCP warning and copyable artifacts. }
procedure CurPageChanged(CurPageID: Integer);
var lines: TArrayOfString; i: Integer; realUrl, dhcp, alt, body, warn: String;
begin
  if CurPageID <> wpFinished then Exit;

  realUrl := ''; dhcp := '0'; alt := '';
  if LoadStringsFromFile(ExpandConstant('{tmp}\aurora-url.txt'), lines) then begin
    for i := 0 to GetArrayLength(lines) - 1 do begin
      if Pos('URL=', lines[i]) = 1 then realUrl := Copy(lines[i], 5, Length(lines[i]));
      if Pos('DHCP=', lines[i]) = 1 then dhcp := Copy(lines[i], 6, Length(lines[i]));
      if Pos('ALT=', lines[i]) = 1 then begin
        if alt <> '' then alt := alt + '   or   ';
        alt := alt + Copy(lines[i], 5, Length(lines[i]));
      end;
    end;
  end;
  if realUrl = '' then realUrl := BuildAccessUrl();   { fallback to the typed value if the relay is missing }

  warn := '';
  if dhcp = '1' then
    warn := #13#10#13#10 +
      'IMPORTANT - this server''s address is assigned automatically (DHCP) and will' + #13#10 +
      'CHANGE when the machine reboots, which breaks every saved link. Ask hospital IT' + #13#10 +
      'to give this machine a FIXED (static) address or a DHCP reservation before rollout.';

  { copyable artifacts so nobody has to retype the URL: a double-clickable
    desktop shortcut (also copyable to other machines) + a plain-text file. }
  SaveStringToFile(ExpandConstant('{commondesktop}\Aurora ICU.url'),
    '[InternetShortcut]' + #13#10 + 'URL=' + realUrl + #13#10, False);
  body := 'Aurora ICU - access address' + #13#10 +
          '===========================' + #13#10#13#10 +
          'Open this in a browser from any device on the hospital network:' + #13#10#13#10 +
          '    ' + realUrl + #13#10;
  if alt <> '' then body := body + #13#10 + 'Also reachable at:  ' + alt + #13#10;
  if dhcp = '1' then body := body + #13#10 +
          'NOTE: this address is DHCP-assigned and will change on reboot -' + #13#10 +
          'ask IT for a static IP or a DHCP reservation.' + #13#10;
  SaveStringToFile(ExpandConstant('{app}\ACCESS.txt'), body, False);

  { on a reinstall over an existing database the typed admin password does NOT
    take effect (the server only bootstraps it into an EMPTY database) - the
    finish page must not promise a credential that will not work }
  if ExistingDetected then
    alt := 'Sign in with the hospital''s EXISTING accounts - the password typed during Setup only applies to a brand-new database. '
  else
    alt := 'Sign in as ''admin'' with the password you set (you will change it at first sign-in). ';
  WizardForm.FinishedLabel.Caption :=
    'Aurora ICU is installed and running as a Windows service - it starts automatically on every boot and restarts itself if it stops.' + #13#10#13#10 +
    'Open this address in a browser from any device on the hospital network:' + #13#10 +
    '        ' + realUrl + #13#10#13#10 + alt +
    'A desktop shortcut ("Aurora ICU") opens it, and the address is saved in ' + ExpandConstant('{app}\ACCESS.txt') + '.' + warn;
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

[UninstallDelete]
; runtime-created (not [Files]) artifacts: the desktop access shortcut + the saved URL
Type: files; Name: "{commondesktop}\Aurora ICU.url"
Type: files; Name: "{app}\ACCESS.txt"
Type: files; Name: "{app}\provision.log"
