@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Vortex Client Launcher - EXE bauen

echo.
echo   ============================================
echo     VORTEX CLIENT LAUNCHER  -  EXE bauen
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [FEHLER] Node.js ist nicht installiert.
  echo          Lade die LTS-Version von https://nodejs.org herunter,
  echo          installiere sie und starte build.bat danach neu.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo Node.js %NODEVER% gefunden.
echo.

rem Kein Code-Signing-Zertifikat suchen (haben wir nicht).
set CSC_IDENTITY_AUTO_DISCOVERY=false

echo [1/2] Lade Abhaengigkeiten (beim ersten Mal ein paar Minuten) ...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail

echo.
echo [2/2] Baue Setup-EXE und Portable-EXE ...
call npm run dist
if errorlevel 1 goto fail

echo.
echo   ============================================
echo     FERTIG!  Die EXE-Dateien liegen im Ordner:
echo     %~dp0release
echo.
echo     Vortex-Client-Setup-*.exe     = Installer
echo     Vortex-Client-Portable-*.exe  = ohne Installation
echo   ============================================
echo.
start "" "%~dp0release"
pause
exit /b 0

:fail
echo.
echo [FEHLER] Der Build ist fehlgeschlagen. Die Meldung steht oben.
echo.
echo Haeufige Ursache: "Cannot create symbolic link"
echo   -^> CMD als Administrator starten ODER in Windows den
echo      Entwicklermodus einschalten (Einstellungen - System - Fuer Entwickler)
echo      und build.bat erneut ausfuehren.
echo.
pause
exit /b 1
