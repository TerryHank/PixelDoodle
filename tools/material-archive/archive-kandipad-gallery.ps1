param(
    [string]$OutputRoot = 'D:\Workspace\PixelDoodle\data\external-materials\kandipad',
    [int]$PageCount = 1065,
    [int]$StartPage = 1,
    [int]$EndPage = 0,
    [int]$ThrottleLimit = 6,
    [switch]$Refresh,
    [ValidateSet('trending', 'recent', 'popular')]
    [string]$Mode = 'trending'
)

$ErrorActionPreference = 'Stop'
$galleryRelative = if ($Mode -eq 'trending') {
    'raw\gallery-pages'
} else {
    "raw\gallery-pages-$Mode"
}
$galleryDirectory = Join-Path $OutputRoot $galleryRelative
New-Item -ItemType Directory -Path $galleryDirectory -Force | Out-Null

$resolvedEndPage = if ($EndPage -gt 0) { [Math]::Min($EndPage, $PageCount) } else { $PageCount }
if ($StartPage -lt 1 -or $StartPage -gt $resolvedEndPage) {
    throw "Invalid page range: $StartPage..$resolvedEndPage"
}
$pages = $StartPage..$resolvedEndPage
$pages | ForEach-Object -Parallel {
    $pageNumber = $_
    $galleryDirectory = $using:galleryDirectory
    $mode = $using:Mode
    $refresh = $using:Refresh
    $destination = Join-Path $galleryDirectory ('{0:D4}.html' -f $pageNumber)

    if (-not $refresh -and (Test-Path -LiteralPath $destination)) {
        $existing = Get-Item -LiteralPath $destination
        if ($existing.Length -gt 0) {
            "skip $pageNumber"
            return
        }
    }

    $baseUrl = if ($mode -eq 'trending') {
        'https://kandipad.com/fuse-bead-patterns'
    } else {
        "https://kandipad.com/fuse-bead-patterns/$mode"
    }
    $url = if ($pageNumber -eq 1) {
        $baseUrl
    } else {
        "$baseUrl/$pageNumber"
    }
    $headers = @{
        'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
        'Referer' = 'https://kandipad.com/fuse-bead-patterns'
        'Accept' = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }

    $lastError = $null
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        $temporary = "$destination.partial-$PID"
        try {
            Invoke-WebRequest -Uri $url -UseBasicParsing -Headers $headers -TimeoutSec 60 -OutFile $temporary -ProgressAction SilentlyContinue
            $downloaded = Get-Item -LiteralPath $temporary
            if ($downloaded.Length -le 0) {
                throw "Downloaded an empty response from $url"
            }
            Move-Item -LiteralPath $temporary -Destination $destination -Force
            "done $pageNumber $($downloaded.Length)"
            return
        } catch {
            $lastError = $_
            if (Test-Path -LiteralPath $temporary) {
                Remove-Item -LiteralPath $temporary -Force
            }
            Start-Sleep -Seconds ([Math]::Min(10, [Math]::Pow(2, $attempt - 1)))
        }
    }

    "failed $pageNumber $($lastError.Exception.Message)"
} -ThrottleLimit $ThrottleLimit
