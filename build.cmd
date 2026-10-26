@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
call pnpm package:vsix
set "buildResult=%errorlevel%"
popd
exit /b %buildResult%
