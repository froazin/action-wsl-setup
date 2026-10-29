# Checks the .wslconfig the action left, and whether an idle instance keeps running.
param(
    # "default", "absent" or the path of the file .wslconfig should match.
    [Parameter(Mandatory)] [string] $Expected,
    [string] $Instance = '',
    # "running" or "stopped": what an instance should be after it has been idle for a minute.
    [string] $Idle = ''
)

$ErrorActionPreference = 'Stop'
$env:WSL_UTF8 = '1'
$wsl = Join-Path $env:ProgramFiles 'WSL\wsl.exe'
$path = Join-Path $env:USERPROFILE '.wslconfig'

function Fail([string] $Message) {
    Write-Output "::error::$Message"
    throw $Message
}

$exists = Test-Path -LiteralPath $path
$content = if ($exists) { Get-Content -LiteralPath $path -Raw } else { '' }
switch ($Expected) {
    'absent' { if ($exists) { Fail ".wslconfig should be absent, but it holds: $content" } }
    'default' { if ($content -notmatch 'guiApplications=false') { Fail ".wslconfig isn't the action's default: $content" } }
    default {
        $want = Get-Content -LiteralPath $Expected -Raw
        if ($content -ne $want) { Fail ".wslconfig should match $Expected, but it holds: $content" }
    }
}

if ($Idle) {
    & $wsl -d $Instance -- true
    Start-Sleep -Seconds 60
    $running = & $wsl --list --running --quiet 2>$null | ForEach-Object { $_.Trim() }
    $state = if ($running -contains $Instance) { 'running' } else { 'stopped' }
    if ($state -ne $Idle) { Fail "$Instance is $state after a minute idle, not $Idle." }
}
Write-Output ".wslconfig is as expected."
