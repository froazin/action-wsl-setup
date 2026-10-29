# Checks what the ok.user-data fixture set up in an instance, and that the seed files are gone.
param(
    [Parameter(Mandatory)] [string] $Instance
)

$ErrorActionPreference = 'Stop'
$env:WSL_UTF8 = '1'
$wsl = Join-Path $env:ProgramFiles 'WSL\wsl.exe'

function Fail([string] $Message) {
    Write-Output "::error::$Message"
    throw $Message
}

$user = (& $wsl -d $Instance -- id -un | Select-Object -Last 1).Trim()
if ($user -ne 'tester') { Fail "The default user is '$user', not tester." }

$marker = & $wsl -d $Instance -u root -- cat /var/tmp/provisioned
if ($LASTEXITCODE -ne 0 -or $marker -ne 'provisioned') { Fail "runcmd didn't write /var/tmp/provisioned." }

$state = (& $wsl -d $Instance -u root -- systemctl is-system-running | Select-Object -Last 1).Trim()
if ($state -ne 'running') { Fail "systemd is '$state', not running." }

foreach ($extension in 'user-data', 'meta-data') {
    $seed = Join-Path $env:USERPROFILE ".cloud-init\$Instance.$extension"
    if (Test-Path -LiteralPath $seed) { Fail "The action left $seed behind." }
}
Write-Output "$Instance was provisioned as expected."
