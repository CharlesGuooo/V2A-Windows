; V2A for Windows — Inno Setup installer script.
;
; Compiled by scripts/build-release.mjs, which passes the version and the
; staged payload directory in as /D defines. Don't run ISCC on this by hand
; unless you set those too.
;
; Design notes:
;   - PrivilegesRequired=lowest + a per-user install directory means no UAC
;     prompt at all. The app never needs machine-wide permissions.
;   - Uninstall deliberately asks before deleting %APPDATA%\V2A, because that
;     folder holds the user's API keys and transcript history.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef PayloadDir
  #define PayloadDir "..\dist\V2A"
#endif

#define AppName "V2A"
#define AppPublisher "Xiyuan Guo"
#define AppURL "https://github.com/CharlesGuooo/V2A-Windows"
#define AppExeName "V2A.vbs"

[Setup]
AppId={{8F3C1E42-9A77-4B21-9E5D-2C7A6B1F0D33}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
VersionInfoVersion={#AppVersion}
VersionInfoDescription=V2A - Voice to Agent

; Per-user install: no admin rights, no UAC prompt.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes

LicenseFile={#PayloadDir}\LICENSE
OutputDir=..\dist
OutputBaseFilename=V2A-Setup-{#AppVersion}
SetupIconFile={#PayloadDir}\web\icon.ico
UninstallDisplayIcon={app}\web\icon.ico
UninstallDisplayName={#AppName} {#AppVersion}

; node.exe is ~86 MB of mostly-compressible binary; lzma2/max + solid brings
; the whole installer down to roughly a third of that.
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=4

WizardStyle=modern
ShowLanguageDialog=auto

[Languages]
Name: "chinese"; MessagesFile: "ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
chinese.CreateDesktopIcon=创建桌面快捷方式
chinese.StartWithWindows=开机时自动启动 V2A（在后台待命，按快捷键即可录音）
chinese.LaunchApp=立即运行 V2A
chinese.AdditionalIcons=附加快捷方式：
chinese.StartupGroup=启动选项：
chinese.RemoveDataPrompt=是否同时删除你的 API key 和转录历史？%n%n它们保存在：%1%n%n选「否」的话，重新安装 V2A 后不用再填一次 key。
chinese.AppRunning=V2A 正在运行。%n%n请先右键点击右下角托盘里的 V2A 图标并选择「退出 V2A」，然后再继续安装。

english.CreateDesktopIcon=Create a desktop shortcut
english.StartWithWindows=Start V2A when Windows starts (waits in the tray; press the hotkey to dictate)
english.LaunchApp=Run V2A now
english.AdditionalIcons=Additional shortcuts:
english.StartupGroup=Startup options:
english.RemoveDataPrompt=Also delete your API keys and transcript history?%n%nThey are stored in:%n%1%n%nChoose No to keep them, so you don't have to re-enter your keys if you reinstall V2A.
english.AppRunning=V2A is currently running.%n%nRight-click the V2A icon in the notification area, choose "Quit V2A", then continue.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startup"; Description: "{cm:StartWithWindows}"; GroupDescription: "{cm:StartupGroup}"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Everything launches through wscript.exe so the Node process starts with no
; console window. The icon comes from the app's own .ico.
Name: "{group}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\{#AppExeName}"""; WorkingDir: "{app}"; IconFilename: "{app}\web\icon.ico"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\{#AppExeName}"""; WorkingDir: "{app}"; IconFilename: "{app}\web\icon.ico"; Tasks: desktopicon
Name: "{userstartup}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\{#AppExeName}"""; WorkingDir: "{app}"; IconFilename: "{app}\web\icon.ico"; Tasks: startup

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\{#AppExeName}"""; WorkingDir: "{app}"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Created at runtime inside the install directory, so Inno doesn't track them.
Type: filesandordirs; Name: "{app}\web\__pycache__"
Type: dirifempty; Name: "{app}"

[Code]
// V2A holds port 8731 while it runs; installing over a live copy would leave
// a stale process and locked files. Ask the user to quit first.
function IsV2ARunning(): Boolean;
var
  ResultCode: Integer;
begin
  // netstat is always present; findstr returns 0 only when the port is bound.
  Result := Exec(ExpandConstant('{cmd}'), '/C netstat -ano | findstr /C:"127.0.0.1:8731" | findstr LISTENING',
                 '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if IsV2ARunning() then
  begin
    // Suppressed (silent install) -> IDOK, i.e. carry on.
    if SuppressibleMsgBox(ExpandConstant('{cm:AppRunning}'), mbConfirmation,
                          MB_OKCANCEL, IDOK) = IDCANCEL then
      Result := False;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{userappdata}\V2A');
    if DirExists(DataDir) then
    begin
      // MUST be SuppressibleMsgBox, not MsgBox: under /SUPPRESSMSGBOXES a plain
      // MsgBox defaults to Yes, which would silently destroy the user's API
      // keys and history during an unattended uninstall. The final argument is
      // the answer returned when message boxes are suppressed — keep it IDNO so
      // the destructive branch can only ever be taken by an explicit click.
      if SuppressibleMsgBox(FmtMessage(ExpandConstant('{cm:RemoveDataPrompt}'), [DataDir]),
                            mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
