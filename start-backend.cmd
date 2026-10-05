@echo off
setlocal
wscript.exe //B //Nologo "%~dp0scripts\start-backend-hidden.vbs"
if errorlevel 1 (
  echo.
  echo Could not launch backend startup. Check backend-startup.log.
  pause
  exit /b 1
)
endlocal
