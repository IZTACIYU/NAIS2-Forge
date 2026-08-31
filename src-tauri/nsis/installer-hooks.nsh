!macro NSIS_HOOK_PREINSTALL
  ; Keep updates on the install root used before the publisher rename.
  ReadRegStr $R0 SHCTX "Software\sunakgo\NAIS2-Forge" ""
  ${If} $R0 != ""
    ${If} ${FileExists} "$R0\${MAINBINARYNAME}.exe"
      StrCpy $INSTDIR $R0
      SetOutPath $INSTDIR
    ${EndIf}
  ${EndIf}

  ; Kill any running tagger-server.exe processes before installation
  ; Use /T to kill child processes as well
  nsExec::ExecToLog 'taskkill /F /T /IM tagger-server.exe'
  ; Wait a moment for processes to fully terminate
  Sleep 500
  ; Also kill the main app if running (to ensure clean install/update)
  nsExec::ExecToLog 'taskkill /F /T /IM NAIS2.exe'
  ; Wait for file handles to be released
  Sleep 1500
  
  ; Disable reboot flag - prevent Windows from requesting restart
  SetRebootFlag false
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; After installation, ensure no reboot is triggered
  SetRebootFlag false
!macroend
