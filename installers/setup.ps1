#!/usr/bin/env pwsh
# Mission Control — PowerShell wrapper. Thin: it finds node and runs setup.mjs.
# The real installer is setup.mjs (cross-platform). All args are forwarded.
#
#   .\installers\setup.ps1            # preflight + install, print next steps
#   .\installers\setup.ps1 --launch   # also launch the cockpit
#   .\installers\setup.ps1 --check    # preflight only (CI)

$ErrorActionPreference = 'Stop'

$setup = Join-Path $PSScriptRoot 'setup.mjs'

$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Host 'error: Node.js was not found on your PATH.' -ForegroundColor Red
    Write-Host '  The Mission Control cockpit requires Node 22.13+ (npm ships with it).'
    Write-Host '  Install from https://nodejs.org/ then re-run: .\installers\setup.ps1'
    exit 1
}

# Forward all arguments verbatim to the Node installer.
& $node.Source $setup @args
exit $LASTEXITCODE
