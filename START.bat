@echo off
REM One-click launcher for the Clone -> Edit local setup.
REM Double-click this file. It starts the engine, studio, and control panel,
REM then opens the dashboard at http://localhost:8090 in your browser.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0START.ps1"
