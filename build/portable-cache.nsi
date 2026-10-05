!include "common.nsh"
!include "extractAppPackage.nsh"
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel user
Var CacheMutex
Function .onInit
  SetSilent silent
  !insertmacro check64BitAndSetRegView
FunctionEnd
Section
  InitPluginsDir
  ; Serialize extraction only. Release BEFORE launching/waiting for Electron.
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\MSQConverter-${MSQ_CACHE_ID}") p.r1'
  StrCpy $CacheMutex $1
  System::Call 'kernel32::WaitForSingleObject(p r1, i 120000) i.r2'
  ${If} $2 != 0
  ${AndIf} $2 != 128
    MessageBox MB_OK|MB_ICONEXCLAMATION "MSQ Converter: timed out waiting for runtime extraction."
    SetErrorLevel 1
    Quit
  ${EndIf}
  StrCpy $INSTDIR "$LOCALAPPDATA\MSQConverter\runtime\${MSQ_CACHE_ID}"
  IfFileExists "$INSTDIR\.ready" 0 extract
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 repair
  IfFileExists "$INSTDIR\resources\app.asar" 0 repair
  IfFileExists "$INSTDIR\resources\ffmpeg\ffmpeg.exe" 0 repair
  IfFileExists "$INSTDIR\resources\icons\icon-light.ico" 0 repair
  IfFileExists "$INSTDIR\resources\icons\icon-dark.ico" 0 repair
  IfFileExists "$INSTDIR\resources\icons\icon-light.png" 0 repair
  IfFileExists "$INSTDIR\resources\icons\icon-dark.png" 0 repair
  ClearErrors
  FileOpen $5 "$INSTDIR\resources\ffmpeg\ffmpeg.exe" r
  IfErrors repair
  FileSeek $5 0 END $6
  FileClose $5
  IntCmp $6 ${MSQ_FFMPEG_SIZE} launch repair repair
repair:
  ; Never remove/overwrite an already published runtime that may still be in use.
  System::Call 'kernel32::GetCurrentProcessId() i.r3'
  StrCpy $INSTDIR "$INSTDIR-repair-$3"
extract:
  SetOutPath $INSTDIR
  !ifdef APP_DIR_64
    File /r "${APP_DIR_64}\*.*"
  !else
    !insertmacro extractEmbeddedAppPackage
  !endif
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 failed
  IfFileExists "$INSTDIR\resources\app.asar" 0 failed
  IfFileExists "$INSTDIR\resources\ffmpeg\ffmpeg.exe" 0 failed
  IfFileExists "$INSTDIR\resources\icons\icon-light.ico" 0 failed
  IfFileExists "$INSTDIR\resources\icons\icon-dark.ico" 0 failed
  IfFileExists "$INSTDIR\resources\icons\icon-light.png" 0 failed
  IfFileExists "$INSTDIR\resources\icons\icon-dark.png" 0 failed
  ClearErrors
  FileOpen $5 "$INSTDIR\resources\ffmpeg\ffmpeg.exe" r
  IfErrors failed
  FileSeek $5 0 END $6
  FileClose $5
  IntCmp $6 ${MSQ_FFMPEG_SIZE} ready failed failed
ready:
  FileOpen $4 "$INSTDIR\.ready" w
  FileWrite $4 "${MSQ_CACHE_ID}"
  FileClose $4
launch:
  System::Call 'kernel32::ReleaseMutex(p $CacheMutex)'
  System::Call 'kernel32::CloseHandle(p $CacheMutex)'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("MSQ_RUNTIME_CACHED", "1").r0'
  ${StdUtils.GetAllParameters} $R0 0
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0
  SetErrorLevel $0
  ; Intentionally keep the immutable runtime cache; a second launcher cannot delete it.
  Goto end
failed:
  System::Call 'kernel32::ReleaseMutex(p $CacheMutex)'
  System::Call 'kernel32::CloseHandle(p $CacheMutex)'
  MessageBox MB_OK|MB_ICONEXCLAMATION "MSQ Converter: runtime extraction failed."
  SetErrorLevel 1
end:
SectionEnd
