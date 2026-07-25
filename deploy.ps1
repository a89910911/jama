[CmdletBinding()]
param(
    [string]$ServerHost = "101.35.214.179",
    [int]$SshPort = 22,
    [string]$SshUser = "root",
    [string]$IdentityFile = "",
    [int]$KeepBackups = 5,
    [switch]$SkipTests
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $workspace "backend-node"
$frontend = Join-Path $workspace "frontweb"
$helper = Join-Path $workspace "tools\deploy_jama.py"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Program,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    Push-Location $WorkingDirectory
    try {
        & $Program @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Program failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found in PATH."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found in PATH."
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python was not found in PATH."
}

if (-not (Test-Path (Join-Path $backend "node_modules"))) {
    Write-Host "Installing backend dependencies..."
    Invoke-Checked $backend "npm" @("ci")
}
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    Invoke-Checked $frontend "npm" @("ci")
}

if (-not $SkipTests) {
    Write-Host "Running backend tests..."
    $backendTests = @(
        Get-ChildItem (Join-Path $backend "test") -Filter "*.test.js" |
            ForEach-Object { $_.FullName }
    )
    Invoke-Checked $backend "node" (@("--test") + $backendTests)
    Write-Host "Running frontend tests..."
    $frontendTests = @(
        Get-ChildItem (Join-Path $frontend "test") -Filter "*.test.js" |
            ForEach-Object { $_.FullName }
    )
    Invoke-Checked $frontend "node" (@("--test") + $frontendTests)
}

Write-Host "Building frontend..."
Invoke-Checked $frontend "npm" @("run", "build")

$pythonPackageRoot = Join-Path $env:LOCALAPPDATA "JamaDeploy\python"
$paramikoProbe = @"
import sys
sys.path.insert(0, r'$pythonPackageRoot')
import paramiko
"@
$savedErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
& python -c $paramikoProbe 2>$null
$paramikoProbeExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorActionPreference
if ($paramikoProbeExitCode -ne 0) {
    Write-Host "Installing the isolated SSH deployment dependency..."
    New-Item -ItemType Directory -Force -Path $pythonPackageRoot | Out-Null
    & python -m pip install --quiet --disable-pip-version-check --target $pythonPackageRoot "paramiko>=3.5,<5"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install the SSH deployment dependency."
    }
}

$previousPythonPath = $env:PYTHONPATH
$plainPassword = $null
$passwordPointer = [IntPtr]::Zero
$passwordWasPrompted = $false
try {
    $env:PYTHONPATH = if ($previousPythonPath) {
        "$pythonPackageRoot;$previousPythonPath"
    }
    else {
        $pythonPackageRoot
    }

    if (-not $IdentityFile -and -not $env:JAMA_DEPLOY_SSH_PASSWORD) {
        $securePassword = Read-Host "SSH password for $SshUser@$ServerHost" -AsSecureString
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        $env:JAMA_DEPLOY_SSH_PASSWORD = $plainPassword
        $passwordWasPrompted = $true
    }

    $arguments = @(
        $helper,
        "--workspace", $workspace,
        "--host", $ServerHost,
        "--port", "$SshPort",
        "--user", $SshUser,
        "--keep-backups", "$KeepBackups"
    )
    if ($IdentityFile) {
        $arguments += @("--identity-file", (Resolve-Path $IdentityFile).Path)
    }

    & python @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Deployment failed with exit code $LASTEXITCODE"
    }
}
finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $plainPassword = $null
    if ($passwordWasPrompted) {
        Remove-Item Env:JAMA_DEPLOY_SSH_PASSWORD -ErrorAction SilentlyContinue
    }
    if ($null -eq $previousPythonPath) {
        Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    }
    else {
        $env:PYTHONPATH = $previousPythonPath
    }
}

Write-Host "Deployment completed successfully: https://jama.artisoul.top"
