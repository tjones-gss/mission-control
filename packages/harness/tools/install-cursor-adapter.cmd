@echo off
setlocal
python "%~dp0install-cursor-adapter.py" %*
exit /b %ERRORLEVEL%
