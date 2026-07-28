[CmdletBinding()]
param(
    [string]$ServerHost = "101.35.214.179",
    [int]$SshPort = 22,
    [string]$SshUser = "root",
    [string]$IdentityFile = "",
    [int]$KeepBackups = 5,
    [switch]$SkipTests,
    [switch]$SkipAudit,
    [switch]$StrictAudit,
    [switch]$PreflightOnly,
    [int]$BundleWarningKb = 500,
    [int]$BundleLimitKb = 2048
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

function Invoke-DependencyAudit {
    param(
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Component,
        [switch]$Strict
    )

    Write-Host "Auditing $Component production dependencies..."
    Push-Location $WorkingDirectory
    try {
        $auditOutput = & npm audit `
            --registry=https://registry.npmjs.org `
            --omit=dev `
            --audit-level=high `
            --json `
            --loglevel=error 2>&1
        $auditExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    $auditText = $auditOutput | Out-String
    $auditReport = $null
    try {
        $auditReport = $auditText | ConvertFrom-Json
    }
    catch {
        $message = "Dependency audit did not return a valid report (exit code $auditExitCode)."
        if ($Strict) {
            throw $message
        }
        Write-Warning "$message Deployment will continue; use -StrictAudit to fail closed."
        return
    }

    $metadataProperty = $auditReport.PSObject.Properties["metadata"]
    if ($null -eq $metadataProperty -or $null -eq $metadataProperty.Value.vulnerabilities) {
        $errorProperty = $auditReport.PSObject.Properties["error"]
        $detail = if ($null -ne $errorProperty) {
            ($errorProperty.Value | Out-String).Trim()
        }
        else {
            "Audit metadata is missing."
        }
        $message = "Dependency audit is unavailable: $detail"
        if ($Strict) {
            throw $message
        }
        Write-Warning "$message Deployment will continue; use -StrictAudit to fail closed."
        return
    }

    $counts = $metadataProperty.Value.vulnerabilities
    $summary = "critical=$($counts.critical), high=$($counts.high), moderate=$($counts.moderate), low=$($counts.low)"
    if ([int]$counts.critical -gt 0 -or [int]$counts.high -gt 0) {
        $message = "Production dependency audit found vulnerabilities: $summary."
        if ($Strict) {
            throw $message
        }
        Write-Warning "$message Deployment will continue in non-strict mode."
        return
    }

    if ($auditExitCode -ne 0) {
        $message = "Dependency audit exited with code $auditExitCode despite reporting no high-risk vulnerabilities."
        if ($Strict) {
            throw $message
        }
        Write-Warning "$message Deployment will continue in non-strict mode."
        return
    }

    Write-Host "Dependency audit passed: $summary"
}

function Resolve-MediaTool {
    param(
        [Parameter(Mandatory = $true)][string]$BackendDirectory,
        [Parameter(Mandatory = $true)][string]$ToolName,
        [Parameter(Mandatory = $true)][string]$EnvironmentVariable
    )

    $override = [Environment]::GetEnvironmentVariable($EnvironmentVariable)
    if ($override -and (Test-Path -LiteralPath $override -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $override).Path
    }

    $isWindowsHost = $env:OS -eq "Windows_NT"
    $executableName = if ($isWindowsHost) {
        "$ToolName.exe"
    } else {
        $ToolName
    }
    $bundled = Join-Path $BackendDirectory "tools/ffmpeg/$executableName"
    if (Test-Path -LiteralPath $bundled -PathType Leaf) {
        return (Resolve-Path -LiteralPath $bundled).Path
    }

    $command = Get-Command $ToolName -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    return $null
}

function Invoke-MediaToolPreflight {
    param(
        [Parameter(Mandatory = $true)][string]$BackendDirectory,
        [switch]$Strict
    )

    Write-Host "Checking FFmpeg media tools..."
    $missing = @()
    foreach ($tool in @(
        @{ Name = "ffmpeg"; Environment = "FFMPEG_PATH" },
        @{ Name = "ffprobe"; Environment = "FFPROBE_PATH" }
    )) {
        $resolved = Resolve-MediaTool `
            -BackendDirectory $BackendDirectory `
            -ToolName $tool.Name `
            -EnvironmentVariable $tool.Environment
        if (-not $resolved) {
            $missing += $tool.Name
            continue
        }
        & $resolved -version *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "$($tool.Name) exists but failed its version check: $resolved"
        }
        Write-Host "Media tool ready: $($tool.Name) ($resolved)"
    }

    if ($missing.Count -gt 0) {
        $message = "Missing media tools: $($missing -join ', '). Video merge, subtitles, dubbing, or media inspection may be unavailable."
        if ($Strict) {
            throw $message
        }
        Write-Warning $message
    }
}

function Test-FrontendBundleSize {
    param(
        [Parameter(Mandatory = $true)][string]$DistDirectory,
        [Parameter(Mandatory = $true)][int]$WarningKb,
        [Parameter(Mandatory = $true)][int]$LimitKb
    )

    $assetsDirectory = Join-Path $DistDirectory "assets"
    $largestBundle = Get-ChildItem $assetsDirectory -Recurse -File -Filter "*.js" |
        Sort-Object Length -Descending |
        Select-Object -First 1
    if ($null -eq $largestBundle) {
        throw "No JavaScript bundle was produced in $assetsDirectory."
    }

    $sizeKb = [Math]::Round($largestBundle.Length / 1KB, 1)
    Write-Host "Largest frontend JavaScript bundle: $($largestBundle.Name) ($sizeKb KiB)"
    if ($largestBundle.Length -gt ([long]$LimitKb * 1KB)) {
        throw "Frontend bundle exceeds the deployment limit of $LimitKb KiB."
    }
    if ($largestBundle.Length -gt ([long]$WarningKb * 1KB)) {
        Write-Warning "Frontend bundle exceeds $WarningKb KiB. Consider route-level dynamic imports or Rollup manualChunks."
    }
}

$previousConsoleInputEncoding = [Console]::InputEncoding
$previousConsoleOutputEncoding = [Console]::OutputEncoding
$previousOutputEncoding = $OutputEncoding
$utf8Encoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8Encoding
[Console]::OutputEncoding = $utf8Encoding
$OutputEncoding = $utf8Encoding

try {
if ($SkipAudit -and $StrictAudit) {
    throw "-SkipAudit and -StrictAudit cannot be used together."
}
if ($BundleWarningKb -le 0) {
    throw "-BundleWarningKb must be greater than zero."
}
if ($BundleLimitKb -lt $BundleWarningKb) {
    throw "-BundleLimitKb must be greater than or equal to -BundleWarningKb."
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

if (-not $SkipAudit) {
    Invoke-DependencyAudit $backend "backend" -Strict:$StrictAudit
    Invoke-DependencyAudit $frontend "frontend" -Strict:$StrictAudit
}

Invoke-MediaToolPreflight $backend -Strict:$StrictAudit

Write-Host "Building frontend..."
Invoke-Checked $frontend "npm" @("run", "build")
Test-FrontendBundleSize `
    -DistDirectory (Join-Path $frontend "dist") `
    -WarningKb $BundleWarningKb `
    -LimitKb $BundleLimitKb

if ($PreflightOnly) {
    Write-Host "Preflight completed successfully; no server changes were made."
    return
}

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
}
finally {
    [Console]::InputEncoding = $previousConsoleInputEncoding
    [Console]::OutputEncoding = $previousConsoleOutputEncoding
    $OutputEncoding = $previousOutputEncoding
}
