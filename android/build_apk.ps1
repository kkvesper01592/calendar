# 予定表(WebCalendar)の Android 版 APK を作る。
# 1. Web 版の画面をビルドする(npm run build)
# 2. できた dist を APK の中に入れる
# 3. 署名の鍵が無ければ作る(初回だけ。keystore フォルダ。なくすと更新できなくなるので必ず控える)
# 4. 署名済みの APK を out フォルダに作る
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$webRoot = Split-Path -Parent $here

# ---- 道具の場所(Android Studio に入っている JDK と、Android SDK) ----
$jbr = @("$env:ProgramFiles\Android\Android Studio\jbr", "$env:LOCALAPPDATA\Programs\Android Studio\jbr") | Where-Object { Test-Path "$_\bin\java.exe" } | Select-Object -First 1
if (-not $jbr) { throw 'Android Studio の JDK(jbr)が見つかりません。Android Studio を入れてください' }
$env:JAVA_HOME = $jbr
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
if (-not (Test-Path "$sdk\platforms")) { throw "Android SDK が見つかりません: $sdk(Android Studio を一度起動して SDK を入れてください)" }
$env:ANDROID_HOME = $sdk
Set-Content -Path "$here\local.properties" -Value ("sdk.dir=" + ($sdk -replace '\\', '/')) -Encoding ASCII
$keytool = "$jbr\bin\keytool.exe"

# ---- 1. Web 版の画面をビルド ----
Write-Host '== 画面をビルドしています(npm run build) =='
Push-Location $webRoot
try {
    if (-not (Test-Path 'node_modules')) { npm ci; if ($LASTEXITCODE) { throw 'npm ci に失敗しました' } }
    npm run build
    if ($LASTEXITCODE) { throw 'npm run build に失敗しました' }
} finally { Pop-Location }
$version = (Get-Content "$webRoot\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version

# 同じ版の上書きはしない(直したら package.json の version を上げ、変更履歴.txt に書いてから作る)
if (Test-Path "$here\out\WebCalendar_$version.apk") {
    throw "ver $version の APK はもうあります。package.json の version を上げてから作り直してください"
}
$history = "$here\変更履歴.txt"
if (-not ((Test-Path $history) -and (Select-String -Path $history -Pattern "^$([regex]::Escape($version))\s" -Encoding UTF8 -Quiet))) {
    throw "変更履歴.txt に ver $version の行がありません。何を変えたかを書いてから作り直してください"
}

# ---- 2. dist を APK の中へ(assets\web\calendar) ----
$assets = "$here\app\src\main\assets\web"
if (Test-Path $assets) { Remove-Item -Recurse -Force $assets }
New-Item -ItemType Directory -Force "$assets\calendar" | Out-Null
Copy-Item -Recurse -Force "$webRoot\dist\*" "$assets\calendar"

# ---- 3. 署名の鍵(初回だけ作る) ----
$ksDir = "$here\keystore"
$ksProps = "$ksDir\keystore.properties"
if (-not (Test-Path $ksProps)) {
    Write-Host '== 署名の鍵を作っています(初回だけ) =='
    New-Item -ItemType Directory -Force $ksDir | Out-Null
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $pass = ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x')
    & $keytool -genkeypair -keystore "$ksDir\webcalendar-release.jks" -storetype PKCS12 -alias webcalendar `
        -keyalg RSA -keysize 2048 -validity 36500 -storepass $pass -keypass $pass -dname 'CN=WebCalendar, O=Personal, C=JP'
    if ($LASTEXITCODE) { throw '署名の鍵を作れませんでした' }
    @(
        'storeFile=webcalendar-release.jks'
        "storePassword=$pass"
        'keyAlias=webcalendar'
        "keyPassword=$pass"
    ) | Set-Content -Path $ksProps -Encoding ASCII
}
$p = @{}
Get-Content $ksProps | ForEach-Object { if ($_ -match '^(\w+)=(.*)$') { $p[$Matches[1]] = $Matches[2] } }
$certInfo = & $keytool -list -v -keystore "$ksDir\$($p.storeFile)" -alias $p.keyAlias -storepass $p.storePassword 2>$null
$sha1 = ($certInfo | Select-String 'SHA1:\s*([0-9A-F:]+)').Matches[0].Groups[1].Value

# ---- 4. APK を作る ----
Write-Host '== APK を作っています(gradlew assembleRelease) =='
Push-Location $here
try {
    & .\gradlew.bat assembleRelease --no-daemon
    if ($LASTEXITCODE) { throw 'APK を作れませんでした' }
} finally { Pop-Location }

$out = "$here\out"
New-Item -ItemType Directory -Force $out | Out-Null
# 古い版の APK は out\旧版 へ移す(out には最新版だけを置く)
Get-ChildItem "$out\WebCalendar_*.apk" | ForEach-Object {
    New-Item -ItemType Directory -Force "$out\旧版" | Out-Null
    Move-Item -Force $_.FullName "$out\旧版\"
}
$apk = "$out\WebCalendar_$version.apk"
Copy-Item -Force "$here\app\build\outputs\apk\release\app-release.apk" $apk
@(
    "パッケージ名: io.github.kkvesper01592.calendar"
    "SHA-1 証明書フィンガープリント: $sha1"
    "(Google Cloud の Android 用 OAuth クライアントに、この2つを登録します。鍵を作り直さない限り変わりません)"
) | Set-Content -Path "$out\Google登録用.txt" -Encoding UTF8

Write-Host ''
Write-Host "できました: $apk"
Write-Host "パッケージ名: io.github.kkvesper01592.calendar"
Write-Host "SHA-1: $sha1"
