@echo off
cd /d "%~dp0"
title GlitchX WhatsApp relay - setup
echo.
echo  =========================================
echo   GlitchX WhatsApp relay - one-click setup
echo  =========================================
echo.

rem 1) Node.js present?
where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed yet.
  echo      Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo  [OK] Node.js %%v

rem 2) config present?
if not exist .env (
  copy /y .env.example .env >nul
  echo  [!] Created .env from the example - check RELAY_TOKEN if sends fail.
) else (
  echo  [OK] config (.env) found
)

rem 3) dependencies (first run only)
if not exist node_modules (
  echo  [..] Installing dependencies, one moment...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo  [X] Install failed - check the internet connection and run again.
    pause
    exit /b 1
  )
  echo  [OK] dependencies installed
) else (
  echo  [OK] dependencies already installed
)

rem 4) auto-start whenever Windows starts (the "auto relay" command)
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /y "%~dp0start-relay.bat" "%STARTUP%\glitchx-whatsapp-relay.bat" >nul
echo  [OK] Auto-start installed - the relay starts itself whenever this PC starts.

echo.
echo  Starting the relay now. Keep this window open while the shop is open.
echo  Receipts send automatically. Status: Admin - WhatsApp on the website.
echo.
call start-relay.bat
