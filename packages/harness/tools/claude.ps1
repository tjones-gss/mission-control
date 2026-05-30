# Quick Claude Code harness setup (Windows PowerShell)
# Usage from project root:
#   .\tools\claude.ps1
#   .\tools\claude.ps1 check

param(
    [ValidateSet("install", "setup", "check")]
    [string]$Action = "setup"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Error "python not found on PATH. Install Python 3.10+ and pip install pyyaml"
}

switch ($Action) {
    "setup" {
        & python "$Root\tools\harness" setup
    }
    "install" {
        & python "$Root\tools\install-claude-adapter.py" --root $Root
    }
    "check" {
        & python "$Root\tools\harness" check
    }
}
