$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$binaryDirectory = Join-Path $projectRoot "src-tauri\binaries"
$binaryPath = Join-Path $binaryDirectory "ffmpeg-x86_64-pc-windows-msvc.exe"
$downloadUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$hashUrl = "$downloadUrl.sha256"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("convertisseur-ffmpeg-" + [guid]::NewGuid().ToString("N"))

if (Test-Path -LiteralPath $binaryPath) {
    Write-Host "FFmpeg est déjà prêt."
    exit 0
}

New-Item -ItemType Directory -Force -Path $binaryDirectory, $temporaryRoot | Out-Null
$archivePath = Join-Path $temporaryRoot "ffmpeg.zip"
$hashPath = Join-Path $temporaryRoot "ffmpeg.zip.sha256"
$extractedPath = Join-Path $temporaryRoot "extracted"

try {
    Write-Host "Téléchargement de FFmpeg Essentials…"
    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath
    Invoke-WebRequest -UseBasicParsing -Uri $hashUrl -OutFile $hashPath

    $expectedHash = (Get-Content -Raw -LiteralPath $hashPath).Trim().ToLowerInvariant()
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "L’empreinte SHA-256 de l’archive FFmpeg ne correspond pas."
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractedPath
    $ffmpeg = Get-ChildItem -LiteralPath $extractedPath -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
    if ($null -eq $ffmpeg) {
        throw "ffmpeg.exe est absent de l’archive téléchargée."
    }
    Copy-Item -LiteralPath $ffmpeg.FullName -Destination $binaryPath
    Write-Host "FFmpeg est prêt : $binaryPath"
}
finally {
    if ((Test-Path -LiteralPath $temporaryRoot) -and $temporaryRoot.StartsWith([System.IO.Path]::GetTempPath())) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
