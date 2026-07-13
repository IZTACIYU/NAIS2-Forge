[CmdletBinding()]
param(
    [string]$KeyPath = "$HOME\.tauri\nais2-forge.key",
    [string]$Repository = 'IZTACIYU/NAIS2-Forge',
    [string]$ReleaseNotesPath = '',
    [string]$UpdateNotes = 'See the GitHub release notes for changes in this version.',
    [switch]$Publish,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$previousSigningKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousSigningPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Set-Location $repoRoot

function Resolve-Executable {
    param([string]$Name, [string]$Fallback)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    if ($Fallback -and (Test-Path -LiteralPath $Fallback)) {
        return $Fallback
    }
    throw "Required command was not found: $Name"
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments)

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE."
    }
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
    throw "Tauri signing key was not found: $KeyPath"
}

$npm = Resolve-Executable 'npm.cmd' 'D:\NodeJS\npm.cmd'
$npx = Resolve-Executable 'npx.cmd' 'D:\NodeJS\npx.cmd'
$git = Resolve-Executable 'git.exe' ''
$null = Resolve-Executable 'cargo.exe' "$HOME\.cargo\bin\cargo.exe"

$password = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
if ([string]::IsNullOrEmpty($password)) {
    $securePassword = Read-Host 'Tauri signing key password' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
}

if ([string]::IsNullOrEmpty($password)) {
    throw 'The Tauri signing key password is empty.'
}

$probeDirectory = Join-Path ([IO.Path]::GetTempPath()) ("nais2-signing-" + [guid]::NewGuid().ToString('N'))
$probeFile = Join-Path $probeDirectory 'probe.txt'
New-Item -ItemType Directory -Path $probeDirectory | Out-Null
[IO.File]::WriteAllText($probeFile, 'NAIS2-Forge signing preflight', [Text.UTF8Encoding]::new($false))

try {
    Write-Host 'Validating the signing key before starting the build...'
    Invoke-Checked $npx @('tauri', 'signer', 'sign', '--private-key-path', $KeyPath, '--password', $password, $probeFile)

    if ($ValidateOnly) {
        Write-Host 'Release signing configuration is valid.'
        return
    }

    $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    $version = [string]$package.version
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw 'package.json does not contain a version.'
    }

    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $KeyPath -Raw
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password

    Write-Host "Building NAIS2-Forge $version..."
    Invoke-Checked $npm @('run', 'tauri:build')

    $nsisDirectory = Join-Path $repoRoot 'src-tauri\target\release\bundle\nsis'
    $msiDirectory = Join-Path $repoRoot 'src-tauri\target\release\bundle\msi'
    $setup = Join-Path $nsisDirectory "NAIS2-Forge_${version}_x64-setup.exe"
    $setupSignature = "$setup.sig"
    $msi = Join-Path $msiDirectory "NAIS2-Forge_${version}_x64_en-US.msi"
    $msiSignature = "$msi.sig"

    foreach ($artifact in @($setup, $setupSignature, $msi, $msiSignature)) {
        if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
            throw "Expected release artifact was not created: $artifact"
        }
    }

    $tag = "v$version"
    $signature = (Get-Content -LiteralPath $setupSignature -Raw).Trim()
    $manifest = [ordered]@{
        version = $version
        notes = $UpdateNotes
        pub_date = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        platforms = [ordered]@{
            'windows-x86_64' = [ordered]@{
                signature = $signature
                url = "https://github.com/$Repository/releases/download/$tag/$(Split-Path -Leaf $setup)"
            }
        }
    }
    $manifestPath = Join-Path $nsisDirectory 'latest.json'
    $manifestJson = $manifest | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($manifestPath, $manifestJson, [Text.UTF8Encoding]::new($false))

    if (-not $Publish) {
        Write-Host "Build complete: $setup"
        Write-Host "Updater manifest: $manifestPath"
        return
    }

    $gh = Resolve-Executable 'gh.exe' 'C:\Program Files\GitHub CLI\gh.exe'
    Invoke-Checked $git @('rev-parse', '--verify', "refs/tags/$tag")
    $assets = @($setup, $setupSignature, $manifestPath, $msi, $msiSignature)

    & $gh release view $tag --repo $Repository *> $null
    $releaseExists = $LASTEXITCODE -eq 0
    if ($releaseExists) {
        Invoke-Checked $gh (@('release', 'upload', $tag, '--repo', $Repository, '--clobber') + $assets)
        $editArguments = @('release', 'edit', $tag, '--repo', $Repository, '--title', "NAIS2-Forge $version")
        if ($ReleaseNotesPath) {
            $editArguments += @('--notes-file', $ReleaseNotesPath)
        }
        Invoke-Checked $gh $editArguments
    }
    else {
        $createArguments = @('release', 'create', $tag, '--repo', $Repository, '--verify-tag', '--title', "NAIS2-Forge $version")
        if ($ReleaseNotesPath) {
            $createArguments += @('--notes-file', $ReleaseNotesPath)
        }
        else {
            $createArguments += '--generate-notes'
        }
        Invoke-Checked $gh ($createArguments + $assets)
    }

    Write-Host "Published https://github.com/$Repository/releases/tag/$tag"
}
finally {
    if ($null -eq $previousSigningKey) {
        Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    }
    else {
        $env:TAURI_SIGNING_PRIVATE_KEY = $previousSigningKey
    }
    if ($null -eq $previousSigningPassword) {
        Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    }
    else {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousSigningPassword
    }
    if (Test-Path -LiteralPath $probeDirectory) {
        Remove-Item -LiteralPath $probeDirectory -Recurse -Force
    }
    $password = $null
}
