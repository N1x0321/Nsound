; Instalador de Nsound para Windows (Inno Setup 6). Lo compila .github/workflows/build-windows.yml:
;   ISCC /DAppVersion=0.8.0-beta.12 /DArch=x64 /DSourceDir=out\pkg\app /DOutDir=out nsound.iss
; Instala solo para el usuario actual (no pide permisos de administrador), crea el acceso del menú Inicio y, si quieres, el del escritorio.
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
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#OutDir}
OutputBaseFilename=Nsound-{#AppVersion}-windows-{#Arch}-setup
SetupIconFile=..\LibreStream.App\Assets\icon.ico
UninstallDisplayIcon={app}\Nsound.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Nsound"; Filename: "{app}\Nsound.exe"
Name: "{autodesktop}\Nsound"; Filename: "{app}\Nsound.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Nsound.exe"; Description: "{cm:LaunchProgram,Nsound}"; Flags: nowait postinstall skipifsilent
