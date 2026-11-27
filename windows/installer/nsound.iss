; Instalador de Nsound para Windows (Inno Setup 6). Lo compila .github/workflows/build-windows.yml:
;   ISCC /DAppVersion=0.8.0-beta.12 /DArch=x64 /DSourceDir=out\pkg\app /DOutDir=out nsound.iss
; Instala solo para el usuario actual (no pide permisos de administrador), crea el acceso del menú Inicio y, si quieres, el del escritorio.
; La app instalada se actualiza sola: descarga el instalador nuevo y lo lanza con /SILENT /CLOSEAPPLICATIONS /RELAUNCH=1 /NORESTART.
; Arch: x64, arm64 o x86. Este archivo se guarda en UTF-8 CON BOM para que los acentos de los mensajes salgan bien.
; Los datos de la app (biblioteca, listas, ajustes) viven en %LOCALAPPDATA%\LibreStream y NO se borran al desinstalar ni al actualizar.

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef Arch
  #define Arch "x64"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\out\pkg\app"
#endif
#ifndef OutDir
  #define OutDir "..\..\out"
#endif

[Setup]
; Identificador fijo: una versión nueva se instala ENCIMA de la anterior (no queda duplicada)
AppId={{7E1B6F52-3C0A-4D6B-9A41-5F0E2B8C7D13}
AppName=Nsound
AppVersion={#AppVersion}
AppVerName=Nsound {#AppVersion}
AppPublisher=Nsound
AppPublisherURL=https://n1x0321.github.io/Nsound/
AppSupportURL=https://github.com/N1x0321/Nsound/issues
AppUpdatesURL=https://github.com/N1x0321/Nsound/releases
VersionInfoVersion=0.8.0.0
DefaultDirName={autopf}\Nsound
DefaultGroupName=Nsound
DisableProgramGroupPage=yes
; Siempre para el usuario actual: así las actualizaciones nunca piden permisos de administrador
PrivilegesRequired=lowest
; Windows 10 1809 o posterior
MinVersion=10.0.17763
OutputDir={#OutDir}
OutputBaseFilename=Nsound-{#AppVersion}-windows-{#Arch}-setup
SetupIconFile=..\LibreStream.App\Assets\icon.ico
UninstallDisplayIcon={app}\Nsound.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Si Nsound sigue abierto al actualizar, se cierra (a la fuerza si no responde)
CloseApplications=force
RestartApplications=no
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#elif Arch == "x86"
; 32 bits: para Windows 10 de 32 bits (en equipos de 64 bits también vale, en modo de 32)
ArchitecturesAllowed=x86compatible
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
spanish.WebView2Installing=Instalando Microsoft Edge WebView2 (lo necesita Nsound)…
english.WebView2Installing=Installing Microsoft Edge WebView2 (required by Nsound)…
spanish.WebView2Missing=Nsound necesita el componente gratuito «Microsoft Edge WebView2 Runtime» y no se ha podido instalar.%n%nDescárgalo en https://developer.microsoft.com/microsoft-edge/webview2/ (Evergreen Bootstrapper), instálalo y vuelve a abrir Nsound.
english.WebView2Missing=Nsound needs the free "Microsoft Edge WebView2 Runtime" and it could not be installed.%n%nGet it at https://developer.microsoft.com/microsoft-edge/webview2/ (Evergreen Bootstrapper), install it and open Nsound again.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Nsound"; Filename: "{app}\Nsound.exe"
Name: "{autodesktop}\Nsound"; Filename: "{app}\Nsound.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Nsound.exe"; Description: "{cm:LaunchProgram,Nsound}"; Flags: nowait postinstall skipifsilent
; «Actualizar ahora» desde la app: tras instalar en silencio se vuelve a abrir
Filename: "{app}\Nsound.exe"; Flags: nowait runasoriginaluser skipifnotsilent; Check: RelaunchRequested

[Code]
const
  WebView2Client = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Url = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';   // instalador oficial de Microsoft
  WebView2File = 'MicrosoftEdgeWebview2Setup.exe';

var
  DownloadPage: TDownloadWizardPage;
  WebView2Downloaded: Boolean;

function RelaunchRequested: Boolean;
begin
  Result := ExpandConstant('{param:relaunch|0}') = '1';
end;

function HasWebView2Version(RootKey: Integer; SubKey: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, SubKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
  if Result then Log('WebView2 Runtime ' + Version);
end;

// Instalado para todo el equipo (en 64 bits queda en la vista de 32 bits) o solo para este usuario
function WebView2Installed: Boolean;
begin
  Result := HasWebView2Version(HKLM32, 'SOFTWARE\' + WebView2Client) or HasWebView2Version(HKCU, 'Software\' + WebView2Client);
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), nil);
end;

// Si falta WebView2 se descarga al pulsar «Instalar» (en una instalación silenciosa también se pasa por aquí)
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID <> wpReady) or WebView2Installed then Exit;
  Log('Falta WebView2 Runtime: se descarga');
  DownloadPage.Clear;
  DownloadPage.Add(WebView2Url, WebView2File, '');
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
      WebView2Downloaded := True;
    except
      Log('No se pudo descargar WebView2: ' + GetExceptionMessage);   // se explica al instalar
    end;
  finally
    DownloadPage.Hide;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if (CurStep <> ssInstall) or WebView2Installed then Exit;
  if WebView2Downloaded then
  begin
    WizardForm.StatusLabel.Caption := CustomMessage('WebView2Installing');
    // Sin permisos de administrador se instala solo para este usuario
    if Exec(ExpandConstant('{tmp}\') + WebView2File, '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      Log('Instalador de WebView2: código ' + IntToStr(ResultCode))
    else
      Log('No se pudo ejecutar el instalador de WebView2: ' + SysErrorMessage(ResultCode));
  end;
  // Nsound se instala igualmente; se explica cómo conseguir lo que falta
  if not WebView2Installed then
    SuppressibleMsgBox(CustomMessage('WebView2Missing'), mbInformation, MB_OK, IDOK);
end;
