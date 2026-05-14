@echo off
@cd /d "%~dp0"
set "REGSVR32=%SystemRoot%\SysWOW64\regsvr32.exe"
set "REGSVR64=%SystemRoot%\System32\regsvr32.exe"
if exist "%SystemRoot%\Sysnative\regsvr32.exe" set "REGSVR64=%SystemRoot%\Sysnative\regsvr32.exe"
set "REGEXE=%SystemRoot%\System32\reg.exe"
if exist "%SystemRoot%\Sysnative\reg.exe" set "REGEXE=%SystemRoot%\Sysnative\reg.exe"
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

:checkDLL
	if not exist "%DLL64%" (
		echo 64-bit Virtual Cam module missing: "%DLL64%"
		goto end
	)
	if not exist "%DLL32%" (
		echo 32-bit Virtual Cam module missing: "%DLL32%"
		goto end
	)
	goto install64DLL

:install32DLL
	echo Installing 32-bit Virtual Cam...
	"%REGSVR32%" /i /s "%DLL32%"
	"%REGEXE%" query "HKLM\SOFTWARE\Classes\CLSID\{7361F8BC-9373-43D4-B93D-ECCD403C7909}" /reg:32 >nul 2>&1
	if %errorLevel% == 0 (
		echo 32-bit Virtual Cam successfully installed
		echo.
	) else (
		echo 32-bit Virtual Cam installation failed
		echo.
		goto end
	)
	goto endSuccess

:install64DLL
	echo Installing 64-bit Virtual Cam...
	"%REGSVR64%" /i /s "%DLL64%"
	"%REGEXE%" query "HKLM\SOFTWARE\Classes\CLSID\{7361F8BC-9373-43D4-B93D-ECCD403C7909}" /reg:64 >nul 2>&1
	if %errorLevel% == 0 (
		echo 64-bit Virtual Cam successfully installed
		echo.
		goto install32DLL
	) else (
		echo 64-bit Virtual Cam installation failed
		echo.
		goto end
	)

:endSuccess
	echo Virtual Cam installed!
	echo.

:end
	pause
	exit
