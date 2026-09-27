; Vortex Client -- NSIS-Erweiterung fuer electron-builder.
; Nur Texte fuer Willkommens-/Abschlussseite; die Installation selbst ist Standard.

!macro customHeader
  !define MUI_FINISHPAGE_TITLE "Vortex Client ist bereit."
  !define MUI_FINISHPAGE_TEXT "Melde dich im Launcher mit deinem Microsoft-Konto an und klicke auf PLAY.$\r$\n$\r$\nKlicke auf Fertig stellen, um Vortex Client zu starten."
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Willkommen bei Vortex Client"
  !define MUI_WELCOMEPAGE_TEXT "Dieser Installer richtet den Vortex Client Launcher fuer dein Windows-Konto ein.$\r$\n$\r$\nDeine Minecraft-Instanzen, Welten, Mods und Resource Packs liegen getrennt vom Programmordner und bleiben bei Updates erhalten.$\r$\n$\r$\nKlicke auf Weiter, um fortzufahren."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Vortex Client entfernen"
  !define MUI_WELCOMEPAGE_TEXT "Der Launcher wird entfernt. Deine Minecraft-Instanzen, Welten, Mods und Resource Packs bleiben auf deinem Computer erhalten."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
