$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
python (Join-Path $PSScriptRoot "install-cursor-adapter.py") @args
exit $LASTEXITCODE
