@echo off
title Madrid Pacman Traffic
cd /d "%~dp0"

echo ========================================
echo   Madrid Pacman Traffic
echo ========================================
echo.

:: Verificar si node_modules existe
if not exist "node_modules\" (
    echo Instalando dependencias...
    call npm install
    echo.
)

echo Iniciando servidor de desarrollo...
echo.
call npm run dev

pause
