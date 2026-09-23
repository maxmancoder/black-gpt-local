@echo off
chcp 65001 >nul
title Black GPT Chat
if not exist ".env" copy ".env.example" ".env" >nul
if not exist "node_modules" call npm install
echo Starting Black GPT Chat on http://localhost:3000
node server/server.js
pause
