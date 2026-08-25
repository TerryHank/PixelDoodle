[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$FrontendOutputRoot = 'dist-h5-apk'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-RequiredDirectory {
    param(
        [AllowNull()][string]$ConfiguredPath,
        [Parameter(Mandatory)][string]$FallbackPath,
        [Parameter(Mandatory)][string]$Label
    )

    $candidate = if ($ConfiguredPath) { $ConfiguredPath } else { $FallbackPath }
    if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
        throw "$Label directory was not found: $candidate"
    }
    return (Resolve-Path -LiteralPath $candidate).Path
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$ArgumentList
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Sync-TauriBleGradlePlugin {
    param(
        [Parameter(Mandatory)][string]$AndroidDirectory,
        [Parameter(Mandatory)][string]$CargoHome
    )

    $registrySourceRoot = Join-Path $CargoHome 'registry\src'
    $pluginAndroidDir = Get-ChildItem -LiteralPath $registrySourceRoot -Directory |
        ForEach-Object { Join-Path $_.FullName 'tauri-plugin-blec-0.12.0\android' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
        Select-Object -First 1
    if (-not $pluginAndroidDir) {
        throw 'tauri-plugin-blec 0.12.0 Android library was not found in the Cargo registry'
    }

    $settingsPath = Join-Path $AndroidDirectory 'tauri.settings.gradle'
    $buildPath = Join-Path $AndroidDirectory 'app\tauri.build.gradle.kts'
    $settings = Get-Content -LiteralPath $settingsPath -Raw
    if ($settings -notmatch "include ':tauri-plugin-blec'") {
        $escapedPluginPath = $pluginAndroidDir.Replace('\', '\\')
        $settings = $settings.TrimEnd() + [Environment]::NewLine +
            "include ':tauri-plugin-blec'" + [Environment]::NewLine +
            "project(':tauri-plugin-blec').projectDir = new File(`"$escapedPluginPath`")" +
            [Environment]::NewLine
        [System.IO.File]::WriteAllText($settingsPath, $settings, [System.Text.UTF8Encoding]::new($false))
    }

    $build = Get-Content -LiteralPath $buildPath -Raw
    if ($build -notmatch 'implementation\(project\(\":tauri-plugin-blec\"\)\)') {
        $anchor = '  implementation(project(":tauri-android"))'
        if (-not $build.Contains($anchor)) {
            throw "Tauri Android dependency anchor was not found: $buildPath"
        }
        $build = $build.Replace(
            $anchor,
            "$anchor$([Environment]::NewLine)  implementation(project(`":tauri-plugin-blec`"))"
        )
        [System.IO.File]::WriteAllText($buildPath, $build, [System.Text.UTF8Encoding]::new($false))
    }
}

$frontendDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$tauriDir = Join-Path $frontendDir 'src-tauri'
$androidDir = Join-Path $tauriDir 'gen\android'
$tauriConfigPath = Join-Path $tauriDir 'tauri.conf.json'
$packageJsonPath = Join-Path $frontendDir 'package.json'
$tauriPropertiesPath = Join-Path $androidDir 'app\tauri.properties'
$frontendOutputDir = Join-Path $frontendDir $FrontendOutputRoot

$env:RUSTUP_HOME = Resolve-RequiredDirectory $env:RUSTUP_HOME 'D:\ProgramData\Rustup' 'RUSTUP_HOME'
$env:CARGO_HOME = Resolve-RequiredDirectory $env:CARGO_HOME 'D:\ProgramData\Cargo' 'CARGO_HOME'
$env:ANDROID_HOME = Resolve-RequiredDirectory $env:ANDROID_HOME 'D:\ProgramData\AndroidSdk' 'ANDROID_HOME'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:NDK_HOME = Resolve-RequiredDirectory $env:NDK_HOME (Join-Path $env:ANDROID_HOME 'ndk\29.0.13846066') 'NDK_HOME'
$preferredJavaHome = 'D:\ProgramData\Java\jdk-17.0.20.1+1'
$javaHome = if (Test-Path -LiteralPath $preferredJavaHome -PathType Container) {
    $preferredJavaHome
}
else {
    $env:JAVA_HOME
}
$env:JAVA_HOME = Resolve-RequiredDirectory $javaHome $preferredJavaHome 'JAVA_HOME'
$env:GRADLE_USER_HOME = Resolve-RequiredDirectory $env:GRADLE_USER_HOME 'D:\ProgramData\Gradle' 'GRADLE_USER_HOME'
$env:PATH = "$(Join-Path $env:CARGO_HOME 'bin');$(Join-Path $env:ANDROID_HOME 'platform-tools');$env:PATH"

$cargo = Join-Path $env:CARGO_HOME 'bin\cargo.exe'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$gradlew = Join-Path $androidDir 'gradlew.bat'
$ndkBin = Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$llvmAr = Join-Path $ndkBin 'llvm-ar.exe'
$llvmStrip = Join-Path $ndkBin 'llvm-strip.exe'
$manifest = Join-Path $tauriDir 'Cargo.toml'

foreach ($requiredFile in @($cargo, $gradlew, $llvmAr, $llvmStrip, $manifest, $tauriConfigPath, $packageJsonPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required build file was not found: $requiredFile"
    }
}

$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$packageConfig = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$version = [string]$tauriConfig.version
$packageVersion = [string]$packageConfig.version
$androidVersionCode = [int]$tauriConfig.bundle.android.versionCode
if (-not $version -or $version -ne $packageVersion) {
    throw "package.json version ($packageVersion) does not match tauri.conf.json version ($version)"
}
if ($androidVersionCode -le 0) {
    throw "tauri.conf.json contains an invalid Android versionCode: $androidVersionCode"
}

$tauriPropertiesContent = @(
    '# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.'
    "tauri.android.versionName=$version"
    "tauri.android.versionCode=$androidVersionCode"
) -join [Environment]::NewLine
[System.IO.File]::WriteAllText(
    $tauriPropertiesPath,
    "$tauriPropertiesContent$([Environment]::NewLine)",
    [System.Text.UTF8Encoding]::new($false)
)
Write-Host "Synchronized Android version metadata: $version ($androidVersionCode)"

$targets = @(
    @{ Triple = 'aarch64-linux-android'; Clang = 'aarch64-linux-android26'; Abi = 'arm64-v8a' },
    @{ Triple = 'armv7-linux-androideabi'; Clang = 'armv7a-linux-androideabi26'; Abi = 'armeabi-v7a' },
    @{ Triple = 'i686-linux-android'; Clang = 'i686-linux-android26'; Abi = 'x86' },
    @{ Triple = 'x86_64-linux-android'; Clang = 'x86_64-linux-android26'; Abi = 'x86_64' }
)

Push-Location $frontendDir
$previousTaroOutputRoot = $env:TARO_OUTPUT_ROOT
$previousTauriConfig = $env:TAURI_CONFIG
$previousTauriAndroidProjectPath = $env:TAURI_ANDROID_PROJECT_PATH
$previousWryAndroidPackage = $env:WRY_ANDROID_PACKAGE
$previousTauriAndroidPackage = $env:TAURI_ANDROID_PACKAGE_UNESCAPED
$previousWryAndroidLibrary = $env:WRY_ANDROID_LIBRARY
$previousWryKotlinOutput = $env:WRY_ANDROID_KOTLIN_FILES_OUT_DIR
try {
    Write-Host 'Building the Taro H5 frontend...'
    $resolvedFrontendDir = (Resolve-Path -LiteralPath $frontendDir).Path
    $resolvedOutputParent = [System.IO.Path]::GetFullPath(
        [System.IO.Path]::GetDirectoryName($frontendOutputDir)
    )
    if (-not $resolvedOutputParent.Equals($resolvedFrontendDir, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Frontend output must stay directly inside the frontend workspace: $frontendOutputDir"
    }
    if (Test-Path -LiteralPath $frontendOutputDir) {
        Remove-Item -LiteralPath $frontendOutputDir -Recurse -Force
    }
    $env:TARO_OUTPUT_ROOT = $FrontendOutputRoot
    $env:TAURI_CONFIG = (@{
        build = @{
            frontendDist = "../$FrontendOutputRoot"
        }
    } | ConvertTo-Json -Compress)
    $env:TAURI_ANDROID_PROJECT_PATH = $androidDir
    $generatedKotlinDir = Join-Path $androidDir 'app\src\main\java\com\terry\pixeldoodle\generated'
    New-Item -ItemType Directory -Path $generatedKotlinDir -Force | Out-Null
    $env:WRY_ANDROID_PACKAGE = [string]$tauriConfig.identifier
    $env:TAURI_ANDROID_PACKAGE_UNESCAPED = [string]$tauriConfig.identifier
    $env:WRY_ANDROID_LIBRARY = 'pixeldoodle_lib'
    $env:WRY_ANDROID_KOTLIN_FILES_OUT_DIR = $generatedKotlinDir
    Invoke-Checked $npm @('run', 'sync:local-wasm')
    Invoke-Checked $npm @('exec', '--', 'taro', 'build', '--type', 'h5')
    Invoke-Checked $cargo @(
        'clean',
        '--package', 'pixeldoodle',
        '--manifest-path', $manifest
    )

    foreach ($target in $targets) {
        $triple = $target.Triple
        $clang = Join-Path $ndkBin "$($target.Clang)-clang.cmd"
        $clangxx = Join-Path $ndkBin "$($target.Clang)-clang++.cmd"
        foreach ($compiler in @($clang, $clangxx)) {
            if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
                throw "NDK compiler was not found: $compiler"
            }
        }

        $cargoTarget = $triple.ToUpperInvariant().Replace('-', '_')
        $env:ANDROID_NATIVE_API_LEVEL = '26'
        $env:TARGET_AR = $llvmAr
        $env:TARGET_CC = $clang
        $env:TARGET_CXX = $clangxx
        [Environment]::SetEnvironmentVariable("CARGO_TARGET_${cargoTarget}_LINKER", $clang, 'Process')
        [Environment]::SetEnvironmentVariable(
            "CARGO_TARGET_${cargoTarget}_RUSTFLAGS",
            '-Clink-arg=-landroid -Clink-arg=-llog -Clink-arg=-lOpenSLES',
            'Process'
        )

        Write-Host "Building Rust library for $triple..."
        Invoke-Checked $cargo @(
            'build',
            '--package', 'pixeldoodle',
            '--manifest-path', $manifest,
            '--target', $triple,
            '--features', 'tauri/custom-protocol',
            '--lib'
        )

        $sourceLibrary = Join-Path $tauriDir "target\$triple\debug\libpixeldoodle_lib.so"
        if (-not (Test-Path -LiteralPath $sourceLibrary -PathType Leaf)) {
            throw "Rust output was not found: $sourceLibrary"
        }
        $jniDirectory = Join-Path $androidDir "app\src\main\jniLibs\$($target.Abi)"
        New-Item -ItemType Directory -Path $jniDirectory -Force | Out-Null
        $jniLibrary = Join-Path $jniDirectory 'libpixeldoodle_lib.so'
        Copy-Item -LiteralPath $sourceLibrary -Destination $jniLibrary -Force
        Invoke-Checked $llvmStrip @('--strip-debug', $jniLibrary)
    }

    Sync-TauriBleGradlePlugin -AndroidDirectory $androidDir -CargoHome $env:CARGO_HOME

    Write-Host 'Packaging and debug-signing the universal APK...'
    $builtApk = Join-Path $androidDir 'app\build\outputs\apk\universal\debug\app-universal-debug.apk'
    if (Test-Path -LiteralPath $builtApk -PathType Leaf) {
        Remove-Item -LiteralPath $builtApk -Force
    }
    Push-Location $androidDir
    try {
        Invoke-Checked $gradlew @(
            ':app:assembleUniversalDebug',
            '-x', ':app:rustBuildArm64Debug',
            '-x', ':app:rustBuildArmDebug',
            '-x', ':app:rustBuildX86Debug',
            '-x', ':app:rustBuildX86_64Debug',
            '--no-daemon'
        )
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path -LiteralPath $builtApk -PathType Leaf)) {
        throw "Gradle APK output was not found: $builtApk"
    }

    $outputDir = Join-Path $frontendDir 'dist-apk'
    $outputApk = Join-Path $outputDir "DIY-Pindou-$version-debug-universal.apk"
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    Copy-Item -LiteralPath $builtApk -Destination $outputApk -Force
    $hash = Get-Sha256Hex $outputApk

    Write-Host "APK: $outputApk"
    Write-Host "SHA256: $hash"
}
finally {
    $env:TARO_OUTPUT_ROOT = $previousTaroOutputRoot
    $env:TAURI_CONFIG = $previousTauriConfig
    $env:TAURI_ANDROID_PROJECT_PATH = $previousTauriAndroidProjectPath
    $env:WRY_ANDROID_PACKAGE = $previousWryAndroidPackage
    $env:TAURI_ANDROID_PACKAGE_UNESCAPED = $previousTauriAndroidPackage
    $env:WRY_ANDROID_LIBRARY = $previousWryAndroidLibrary
    $env:WRY_ANDROID_KOTLIN_FILES_OUT_DIR = $previousWryKotlinOutput
    Pop-Location
}
