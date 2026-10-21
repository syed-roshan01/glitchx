@echo off
rem GlitchX WhatsApp relay — double-click to start (also runs at Windows login)
cd /d "%~dp0"
title GlitchX WhatsApp relay (keep this window open)
node --env-file-if-exists=.env index.js
pause
