@echo off
setlocal
cd /d "%~dp0"
title Vortex Client Launcher - Testen
where node >nul 2>nul
if errorlevel 1 (
  echo [FEHLER] Node.js ist nicht installiert: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Lade Abhaengigkeiten ...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( pause & exit /b 1 )
)
call npm start
