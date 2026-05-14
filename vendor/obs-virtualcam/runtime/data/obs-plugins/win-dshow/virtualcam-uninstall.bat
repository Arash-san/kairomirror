@echo off
@cd /d "%~dp0"
set "REGSVR32=%SystemRoot%\SysWOW64\regsvr32.exe"
set "REGSVR64=%SystemRoot%\System32\regsvr32.exe"
if exist "%SystemRoot%\Sysnative\regsvr32.exe" set "REGSVR64=%SystemRoot%\Sysnative\regsvr32.exe"
set "DLL32=%~dp0obs-virtualcam-module32.dll"
set "DLL64=%~dp0obs-virtualcam-module64.dll"
goto checkAdmin

:checkAdmin
	net session >nul 2>&1
	if %errorLevel% == 0 (
		echo.
	) else (
		echo Administrative rights are required, please re-run this script as Administrator.
		goto end
	)

:uninstallDLLs
	if exist "%DLL64%" "%REGSVR64%" /u /s "%DLL64%"
	if exist "%DLL32%" "%REGSVR32%" /u /s "%DLL32%"

:endSuccess
	echo Virtual Cam uninstalled!
	echo.

:end
	pause
	exit
