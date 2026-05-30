# Write .cursor/hooks.json with Git Bash paths for Windows Cursor hook execution.
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$HooksJsonPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $HooksJsonPath) {
    $HooksJsonPath = Join-Path $ProjectRoot ".cursor\hooks.json"
}

function Get-GitBashExe {
    $cmd = Get-Command bash -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -match 'bash\.exe$') {
        return $cmd.Source
    }
    $candidates = @(
        (Join-Path ${env:ProgramFiles} "Git\bin\bash.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Git\bin\bash.exe"),
        "C:\Program Files\Git\bin\bash.exe"
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            return $c
        }
    }
    return "bash"
}

$bashExe = Get-GitBashExe

function New-HookCommand {
    param([string]$ScriptRel)
    if ($bashExe -eq "bash") {
        return "bash $ScriptRel"
    }
    $escaped = $bashExe -replace '\\', '\\'
    return "`"\`"$escaped\`"`" $ScriptRel"
}

$sessionCmd = New-HookCommand ".cursor/hooks/session-start-load-state.sh"
$blockCmd = New-HookCommand ".cursor/hooks/block-danger.sh"
$missionCmd = New-HookCommand ".cursor/hooks/require-mission.sh"
$stopCmd = New-HookCommand ".cursor/hooks/stop-session-note-reminder.sh"

$content = @"
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "command": "$sessionCmd"
      }
    ],
    "beforeShellExecution": [
      {
        "command": "$blockCmd",
        "failClosed": true
      }
    ],
    "preToolUse": [
      {
        "command": "$missionCmd",
        "matcher": "Write|Edit|MultiEdit|NotebookEdit",
        "failClosed": false
      }
    ],
    "stop": [
      {
        "command": "$stopCmd"
      }
    ]
  }
}
"@

$dir = Split-Path -Parent $HooksJsonPath
if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

Set-Content -Path $HooksJsonPath -Value $content -Encoding UTF8
Write-Host "Wrote $HooksJsonPath"
Write-Host "  bash: $bashExe"
