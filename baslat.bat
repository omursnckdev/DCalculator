@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun. & pause & exit /b 1)
if not exist node_modules (echo Ilk kurulum: paketler indiriliyor... & call npm install || (pause & exit /b 1))
echo Uygulama aciliyor: http://localhost:5173  (kapatmak icin bu pencereyi kapatin)
start "" http://localhost:5173
call npm run dev
