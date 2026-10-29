# Checks a WSL instance exists with the expected WSL version and can run a command.
param(
    [Parameter(Mandatory)] [string] $Instance,
    [Parameter(Mandatory)] [ValidateSet('1', '2')] [string] $WslVersion
)

$ErrorActionPreference = 'Stop'
$env:WSL_UTF8 = '1'
$wsl = Join-Path $env:ProgramFiles 'WSL\wsl.exe'

# Throws rather than exits: exit would end only this script, and a step that calls it twice
# would carry on to the second call.
function Fail([string] $Message) {
    Write-Output "::error::$Message"
    throw $Message
}

$list = & $wsl --list --verbose
Write-Output $list
$line = $list | Where-Object { ($_ -replace '^\s*\*', '').Trim() -match "^$([regex]::Escape($Instance))\s" }
if (-not $line) { Fail "$Instance isn't in wsl --list." }
$version = ($line.Trim() -split '\s+')[-1]
if ($version -ne $WslVersion) { Fail "$Instance is WSL $version, not WSL $WslVersion." }

$kernel = & $wsl -d $Instance -u root -- uname -r
if ($LASTEXITCODE -ne 0) { Fail "Running a command in $Instance failed with $LASTEXITCODE." }
Write-Output "$Instance runs kernel $kernel"
# WSL 2 runs its own Linux kernel. WSL 1 reports Windows' build with "Microsoft".
$isWsl2 = $kernel -match 'WSL2'
if (($WslVersion -eq '2') -ne $isWsl2) { Fail "$Instance's kernel $kernel doesn't look like WSL $WslVersion." }

& $wsl -d $Instance -u root -- cat /etc/os-release
if ($LASTEXITCODE -ne 0) { Fail "Reading /etc/os-release in $Instance failed with $LASTEXITCODE." }
