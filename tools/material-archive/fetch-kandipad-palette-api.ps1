param(
    [string[]]$Shape = @('square'),
    [string]$OutputRoot = 'D:\Workspace\PixelDoodle\data\external-materials\kandipad\palettes\api',
    [switch]$Force,
    [double]$DelaySeconds = 1
)

$ErrorActionPreference = 'Stop'
$endpoint = 'https://kandipad.com/project/get-palettes'
$requestHeaders = @{
    'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    'Referer' = 'https://kandipad.com/create'
    'Origin' = 'https://kandipad.com'
    'Accept' = 'application/json, text/javascript, */*; q=0.01'
    'X-Requested-With' = 'XMLHttpRequest'
}

function Write-AtomicBytes {
    param([string]$Path, [byte[]]$Bytes)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = "$Path.tmp-$PID"
    [IO.File]::WriteAllBytes($temporary, $Bytes)
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Write-AtomicJson {
    param([string]$Path, [object]$Value)
    $json = $Value | ConvertTo-Json -Depth 20
    Write-AtomicBytes -Path $Path -Bytes ([Text.UTF8Encoding]::new($false).GetBytes($json + "`n"))
}

function Get-Sha256 {
    param([byte[]]$Bytes)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
}

function Get-ResponseBytes {
    param([object]$Response)
    if ($null -ne $Response.RawContentStream) {
        $memory = [IO.MemoryStream]::new()
        try {
            if ($Response.RawContentStream.CanSeek) {
                $Response.RawContentStream.Position = 0
            }
            $Response.RawContentStream.CopyTo($memory)
            return $memory.ToArray()
        } finally {
            $memory.Dispose()
        }
    }
    return [Text.UTF8Encoding]::new($false).GetBytes([string]$Response.Content)
}

function Convert-Headers {
    param([object]$Headers)
    $result = [ordered]@{}
    foreach ($entry in $Headers.GetEnumerator()) {
        $headerName = [string]$entry.Key
        if ($headerName -match '^(?i:Set-Cookie|Cookie|Authorization|Proxy-Authorization)$') {
            $result[$headerName] = '[REDACTED]'
        } else {
            $result[$headerName] = [string]$entry.Value
        }
    }
    return $result
}

$shapes = @($Shape | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique)
$allSuccessful = $true
for ($index = 0; $index -lt $shapes.Count; $index++) {
    $shapeName = $shapes[$index]
    if ($shapeName -notmatch '^[a-z0-9_-]+$') {
        throw "Invalid shape: $shapeName"
    }
    if ($index -gt 0 -and $DelaySeconds -gt 0) {
        Start-Sleep -Milliseconds ([int]($DelaySeconds * 1000))
    }

    $rawPath = Join-Path $OutputRoot "get-palettes-$shapeName.json"
    $metadataPath = Join-Path $OutputRoot "get-palettes-$shapeName.http.json"
    if (-not $Force -and (Test-Path -LiteralPath $rawPath) -and (Test-Path -LiteralPath $metadataPath)) {
        $existingMetadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        $existingBytes = [IO.File]::ReadAllBytes($rawPath)
        if ((Get-Sha256 $existingBytes) -eq $existingMetadata.response.sha256) {
            "skip $shapeName`: archived response hash verified"
            continue
        }
    }

    $startedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $response = Invoke-WebRequest `
        -Uri $endpoint `
        -Method Post `
        -Body @{ shape = $shapeName } `
        -Headers $requestHeaders `
        -UseBasicParsing `
        -SkipHttpErrorCheck `
        -TimeoutSec 60
    $bodyBytes = Get-ResponseBytes $response
    $bodySha256 = Get-Sha256 $bodyBytes
    $bodyText = [Text.UTF8Encoding]::new($false, $true).GetString($bodyBytes)
    $parsed = $null
    $jsonError = $null
    try {
        $parsed = $bodyText | ConvertFrom-Json -Depth 100
    } catch {
        $jsonError = $_.Exception.Message
    }
    $successful = (
        [int]$response.StatusCode -ge 200 -and
        [int]$response.StatusCode -lt 300 -and
        $bodyText.Trim() -ne '' -and
        $bodyText.Trim() -ne 'bad' -and
        $null -eq $jsonError -and
        $null -ne $parsed
    )
    $topLevelKeys = @()
    if ($parsed -is [pscustomobject]) {
        $topLevelKeys = @($parsed.PSObject.Properties.Name)
    }
    $metadata = [ordered]@{
        schemaVersion = 1
        request = [ordered]@{
            url = $endpoint
            method = 'POST'
            form = @{ shape = $shapeName }
            headers = $requestHeaders
            startedAt = $startedAt
        }
        response = [ordered]@{
            status = [int]$response.StatusCode
            headers = Convert-Headers $response.Headers
            bytes = $bodyBytes.Length
            sha256 = $bodySha256
            topLevelKeys = $topLevelKeys
            successful = $successful
            jsonError = $jsonError
            completedAt = [DateTimeOffset]::UtcNow.ToString('o')
        }
    }

    if ($successful) {
        Write-AtomicBytes -Path $rawPath -Bytes $bodyBytes
        Write-AtomicJson -Path $metadataPath -Value $metadata
        "done $shapeName`: HTTP $([int]$response.StatusCode), $($bodyBytes.Length) bytes, sha256=$bodySha256"
    } else {
        $errorRoot = Join-Path $OutputRoot 'errors'
        Write-AtomicBytes -Path (Join-Path $errorRoot "get-palettes-$shapeName.body") -Bytes $bodyBytes
        Write-AtomicJson -Path (Join-Path $errorRoot "get-palettes-$shapeName.http.json") -Value $metadata
        "failed $shapeName`: HTTP $([int]$response.StatusCode), $($bodyBytes.Length) bytes, jsonError=$jsonError"
        $allSuccessful = $false
    }
}

if (-not $allSuccessful) {
    exit 1
}
