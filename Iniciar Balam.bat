@echo off
REM ====================================================================
REM  Balam POS - Iniciar sistema (servidor local + navegador)
REM  Doble-click este archivo. Cierra la ventana del servidor para detener.
REM ====================================================================
title Balam POS

REM Carpeta del proyecto = carpeta de este .bat
cd /d "%~dp0"

set PORT=8777
set URL=http://127.0.0.1:%PORT%/POS%%20Balam.html

REM Detecta Python (python o py)
set PYEXE=
where python >nul 2>nul && set PYEXE=python
if "%PYEXE%"=="" ( where py >nul 2>nul && set PYEXE=py )

if "%PYEXE%"=="" (
  echo.
  echo  [ERROR] No se encontro Python.
  echo  Instalalo desde https://www.python.org/downloads/  ^(marca "Add to PATH"^)
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo   Balam POS
echo  ============================================
echo   Carpeta : %CD%
echo   URL     : %URL%
echo.
echo   Abriendo navegador...
echo   Deja la ventana del SERVIDOR abierta.
echo   Cierrala para apagar el sistema.
echo  ============================================
echo.

REM Arranca el servidor en una ventana propia
start "Balam POS - Servidor (no cerrar para usar)" %PYEXE% -m http.server %PORT% --bind 127.0.0.1

REM Espera a que el servidor levante y abre el navegador
timeout /t 2 >nul
start "" "%URL%"

exit /b 0
