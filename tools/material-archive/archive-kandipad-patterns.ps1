param(
    [string]$OutputRoot = 'D:\Workspace\PixelDoodle\data\external-materials\kandipad',
    [int]$ThrottleLimit = 12,
    [ValidateSet('all', 'metadata', 'matrices', 'images')]
    [string]$Phase = 'all'
)

$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $OutputRoot 'manifest.jsonl'
$patternRoot = Join-Path $OutputRoot 'patterns'
$errorRoot = Join-Path $OutputRoot 'errors'

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Manifest not found: $manifestPath"
}

New-Item -ItemType Directory -Path $patternRoot, $errorRoot -Force | Out-Null

$rawEntries = Get-Content -LiteralPath $manifestPath | Where-Object { $_.Trim() }
$entries = for ($index = 0; $index -lt $rawEntries.Count; $index++) {
    $entry = $rawEntries[$index] | ConvertFrom-Json
    $entry | Add-Member -NotePropertyName archiveIndex -NotePropertyValue ($index + 1)
    $entry | Add-Member -NotePropertyName archiveTotal -NotePropertyValue $rawEntries.Count
    $entry
}

$entries | ForEach-Object -Parallel {
    $entry = $_
    $outputRoot = $using:OutputRoot
    $patternRoot = $using:patternRoot
    $errorRoot = $using:errorRoot
    $phase = $using:Phase
    $shard = '{0:D2}' -f ([int]$entry.pid % 100)
    $directory = Join-Path (Join-Path $patternRoot $shard) ([string]$entry.pid)
    New-Item -ItemType Directory -Path $directory -Force | Out-Null

    $headers = @{
        'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
        'Referer' = [string]$entry.detailUrl
        'Accept' = '*/*'
    }

    function Save-ResponseFile {
        param(
            [string]$Url,
            [string]$Destination,
            [string]$Method = 'Get',
            [hashtable]$Body = $null,
            [hashtable]$ExtraHeaders = @{}
        )

        if (Test-Path -LiteralPath $Destination) {
            $existing = Get-Item -LiteralPath $Destination
            if ($existing.Length -gt 0) { return }
        }

        $requestHeaders = @{} + $headers
        foreach ($key in $ExtraHeaders.Keys) {
            $requestHeaders[$key] = $ExtraHeaders[$key]
        }

        $lastError = $null
        for ($attempt = 1; $attempt -le 5; $attempt++) {
            $temporary = "$Destination.partial-$PID"
            try {
                $params = @{
                    Uri = $Url
                    Method = $Method
                    UseBasicParsing = $true
                    Headers = $requestHeaders
                    TimeoutSec = 60
                    OutFile = $temporary
                    ProgressAction = 'SilentlyContinue'
                }
                if ($null -ne $Body) { $params.Body = $Body }
                Invoke-WebRequest @params
                $downloaded = Get-Item -LiteralPath $temporary
                if ($downloaded.Length -le 0) {
                    throw "Downloaded an empty response from $Url"
                }
                Move-Item -LiteralPath $temporary -Destination $Destination -Force
                return
            } catch {
                $lastError = $_
                if (Test-Path -LiteralPath $temporary) {
                    Remove-Item -LiteralPath $temporary -Force
                }
                Start-Sleep -Seconds ([Math]::Min(10, [Math]::Pow(2, $attempt - 1)))
            }
        }
        throw $lastError
    }

    try {
        $metadataPath = Join-Path $directory 'metadata.json'
        if ($phase -in @('all', 'metadata', 'matrices')) {
            $metadata = $entry.PSObject.Copy()
            $metadata.PSObject.Properties.Remove('archiveIndex')
            $metadata.PSObject.Properties.Remove('archiveTotal')
            $metadataJson = $metadata | ConvertTo-Json -Depth 10
            $metadataChanged = -not (Test-Path -LiteralPath $metadataPath)
            if (-not $metadataChanged) {
                $metadataChanged = [System.IO.File]::ReadAllText($metadataPath) -ne $metadataJson
            }
            if ($metadataChanged) {
                [System.IO.File]::WriteAllText(
                    $metadataPath,
                    $metadataJson,
                    [System.Text.UTF8Encoding]::new($false)
                )
            }
        }

        if ($phase -in @('all', 'matrices')) {
            $matrixPath = Join-Path $directory 'matrix.json'
            Save-ResponseFile `
                -Url 'https://kandipad.com/pattern/get-matrix' `
                -Destination $matrixPath `
                -Method 'Post' `
                -Body @{ pid = [string]$entry.pid } `
                -ExtraHeaders @{ 'X-Requested-With' = 'XMLHttpRequest' }

            $matrixText = [System.IO.File]::ReadAllText($matrixPath)
            if ($matrixText.Trim() -eq 'bad') {
                throw 'Matrix endpoint returned bad'
            }
            $null = $matrixText | ConvertFrom-Json
        }

        if ($phase -in @('all', 'images')) {
            if ($entry.thumbnailUrl) {
                $thumbnailName = [System.IO.Path]::GetFileName(([Uri]$entry.thumbnailUrl).AbsolutePath)
                Save-ResponseFile `
                    -Url ([string]$entry.thumbnailUrl) `
                    -Destination (Join-Path $directory $thumbnailName)
            }
            if ($entry.fullImageUrl) {
                $fullName = 'full-' + [System.IO.Path]::GetFileName(([Uri]$entry.fullImageUrl).AbsolutePath)
                Save-ResponseFile `
                    -Url ([string]$entry.fullImageUrl) `
                    -Destination (Join-Path $directory $fullName)
            }
        }

        $existingError = Join-Path $errorRoot ("$phase-$($entry.pid).txt")
        if (Test-Path -LiteralPath $existingError) {
            Remove-Item -LiteralPath $existingError -Force
        }
    } catch {
        $errorPath = Join-Path $errorRoot ("$phase-$($entry.pid).txt")
        [System.IO.File]::WriteAllText(
            $errorPath,
            "pid=$($entry.pid)`nslug=$($entry.slug)`nphase=$phase`nerror=$($_.Exception.Message)`n",
            [System.Text.UTF8Encoding]::new($false)
        )
    }

    if (($entry.archiveIndex % 250) -eq 0 -or $entry.archiveIndex -eq $entry.archiveTotal) {
        "patterns $($entry.archiveIndex)/$($entry.archiveTotal)"
    }
} -ThrottleLimit $ThrottleLimit
