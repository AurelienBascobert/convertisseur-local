$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$binaryDirectory = Join-Path $projectRoot "src-tauri\binaries"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("convertisseur-documents-" + [guid]::NewGuid().ToString("N"))

$engines = @(
    @{
        Name = "Pandoc"
        Url = "https://github.com/jgm/pandoc/releases/download/3.11/pandoc-3.11-windows-x86_64.zip"
        Sha256 = "2ab72baf2399450e148ddf7a2a8689806c42e1bba71862b57e220fd9b8456d3d"
        Executable = "pandoc.exe"
        Destination = "pandoc-x86_64-pc-windows-msvc.exe"
    },
    @{
        Name = "Typst"
        Url = "https://github.com/typst/typst/releases/download/v0.15.1/typst-x86_64-pc-windows-msvc.zip"
        Sha256 = "19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736"
        Executable = "typst.exe"
        Destination = "typst-x86_64-pc-windows-msvc.exe"
    }
)

New-Item -ItemType Directory -Force -Path $binaryDirectory, $temporaryRoot | Out-Null

try {
    foreach ($engine in $engines) {
        $destinationPath = Join-Path $binaryDirectory $engine.Destination
        if (Test-Path -LiteralPath $destinationPath) {
            Write-Host "$($engine.Name) est déjà prêt."
            continue
        }

        $archivePath = Join-Path $temporaryRoot "$($engine.Name).zip"
        $extractedPath = Join-Path $temporaryRoot $engine.Name
        Write-Host "Téléchargement de $($engine.Name)…"
        Invoke-WebRequest -UseBasicParsing -Uri $engine.Url -OutFile $archivePath

        $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
        if ($actualHash -ne $engine.Sha256) {
            throw "L’empreinte SHA-256 de $($engine.Name) ne correspond pas."
        }

        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractedPath
        $executable = Get-ChildItem -LiteralPath $extractedPath -Recurse -Filter $engine.Executable | Select-Object -First 1
        if ($null -eq $executable) {
            throw "$($engine.Executable) est absent de l’archive téléchargée."
        }
        Copy-Item -LiteralPath $executable.FullName -Destination $destinationPath
        Write-Host "$($engine.Name) est prêt."
    }
}
finally {
    if ((Test-Path -LiteralPath $temporaryRoot) -and $temporaryRoot.StartsWith([System.IO.Path]::GetTempPath())) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
