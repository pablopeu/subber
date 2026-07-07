; Subber — Windows installer (per-user, no UAC).
;
; Built by scripts/package.mjs, which invokes:
;   makensis -DVER=<version> -DSRC=<built Subber dir> -DOUTPUT=<out exe> installer.nsi
;
; Installs Subber.exe + the web client + fonts into %LOCALAPPDATA%\Programs\Subber,
; adds Start Menu / Desktop shortcuts and an Add/Remove Programs entry, and a
; "Download FFmpeg" shortcut (FFmpeg is required for export). Fully uninstallable.

!ifndef VER
  !define VER "0.0.0"
!endif
!ifndef SRC
  !error "SRC must point at the built Subber folder (pass -DSRC=...)"
!endif
!ifndef OUTPUT
  !error "OUTPUT must name the installer .exe (pass -DOUTPUT=...)"
!endif

!define APPNAME "Subber"
!define APPFRIENDLY "Subber"
!define PUBLISHER "Subber"
!define APPURL "https://github.com/pablopeu/subber"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Subber"

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

Name "${APPFRIENDLY} ${VER}"
BrandingText "${APPFRIENDLY} ${VER}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
; Remember the install dir across reinstalls (per-user key, no admin).
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
ShowInstDetails show
ShowUnInstDetails show

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ABORTWARNING
; On the finish page, offer to fetch FFmpeg (needed for export). The box is
; opt-in; users can also run the "Download FFmpeg" shortcut later.
!define MUI_FINISHPAGE_RUN "$INSTDIR\Setup-FFmpeg.bat"
!define MUI_FINISHPAGE_RUN_TEXT "Download FFmpeg now (needed for export)"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Spanish"

;-----------------------------------------------------------------------------

Section "Subber" SecCore
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Everything from the built package (Subber.exe, web\, fonts\, Setup-FFmpeg.*).
  File /r "${SRC}\*.*"
  CreateDirectory "$INSTDIR\temp"

  WriteUninstaller "$INSTDIR\Uninstall ${APPFRIENDLY}.exe"

  ; Start Menu group: app, FFmpeg setup, uninstall.
  CreateDirectory "$SMPROGRAMS\${APPFRIENDLY}"
  CreateShortCut "$SMPROGRAMS\${APPFRIENDLY}\${APPFRIENDLY}.lnk" "$INSTDIR\Subber.exe"
  CreateShortCut "$SMPROGRAMS\${APPFRIENDLY}\Download FFmpeg.lnk" "$INSTDIR\Setup-FFmpeg.bat"
  CreateShortCut "$SMPROGRAMS\${APPFRIENDLY}\Uninstall ${APPFRIENDLY}.lnk" "$INSTDIR\Uninstall ${APPFRIENDLY}.exe"
  ; Desktop shortcut.
  CreateShortCut "$DESKTOP\${APPFRIENDLY}.lnk" "$INSTDIR\Subber.exe"

  ; Persist the install dir and register with Add/Remove Programs (per-user key).
  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPFRIENDLY}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\Subber.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "URLInfoAbout" "${APPURL}"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall ${APPFRIENDLY}.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall ${APPFRIENDLY}.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

  ; EstimatedSize (KB) for the Programs control panel.
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
SectionEnd

;-----------------------------------------------------------------------------

Section "Uninstall"
  ; App files (ffmpeg.exe only if the setup helper downloaded it here).
  Delete "$INSTDIR\Subber.exe"
  Delete "$INSTDIR\Uninstall ${APPFRIENDLY}.exe"
  Delete "$INSTDIR\Setup-FFmpeg.bat"
  Delete "$INSTDIR\Setup-FFmpeg.ps1"
  Delete "$INSTDIR\LEEME.txt"
  Delete "$INSTDIR\ffmpeg.exe"
  Delete "$INSTDIR\ffprobe.exe"
  RMDir /r "$INSTDIR\web"
  RMDir /r "$INSTDIR\fonts"
  RMDir /r "$INSTDIR\tmp"
  RMDir /r "$INSTDIR\temp"
  RMDir "$INSTDIR"

  ; Shortcuts.
  Delete "$SMPROGRAMS\${APPFRIENDLY}\${APPFRIENDLY}.lnk"
  Delete "$SMPROGRAMS\${APPFRIENDLY}\Download FFmpeg.lnk"
  Delete "$SMPROGRAMS\${APPFRIENDLY}\Uninstall ${APPFRIENDLY}.lnk"
  RMDir "$SMPROGRAMS\${APPFRIENDLY}"
  Delete "$DESKTOP\${APPFRIENDLY}.lnk"

  ; Registry.
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPNAME}"
SectionEnd
