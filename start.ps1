param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$backendDir = Join-Path $projectRoot 'backend'
$webDir = Join-Path $projectRoot 'web'
$runtimeDir = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$pythonExe = Join-Path $backendDir '.venv\Scripts\python.exe'
$nodeExe = (Get-Command node -ErrorAction Stop).Source
if (!(Test-Path -LiteralPath $pythonExe)) {
    throw 'Python environment missing. See README.md installation instructions.'
}
$buildId = Join-Path $webDir '.next\BUILD_ID'
$buildInputs = @((Join-Path $webDir 'src'), (Join-Path $webDir 'package.json'), (Join-Path $webDir 'pnpm-lock.yaml'), (Join-Path $webDir 'next.config.ts'))
$latestInput = $buildInputs | ForEach-Object {
    if (Test-Path -LiteralPath $_ -PathType Container) {
        Get-ChildItem -LiteralPath $_ -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    } else { Get-Item -LiteralPath $_ }
} | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (!(Test-Path -LiteralPath $buildId) -or $latestInput.LastWriteTimeUtc -gt (Get-Item -LiteralPath $buildId).LastWriteTimeUtc) {
    Push-Location $webDir
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
}
$recordPath = Join-Path $runtimeDir 'processes.json'
$records = @()
if (Test-Path -LiteralPath $recordPath) {
    $decodedRecords = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    foreach ($savedRecord in $decodedRecords) { $records += $savedRecord }
}
function Test-LocalService([string]$Address) {
    try {
        $response = Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch { return $false }
}
$definitions = @(
    @{Name='crm'; Port=8101; Health='http://127.0.0.1:8101/health'; Exe=$pythonExe; Args=@('-m','uvicorn','opsweaver.crm:app','--host','127.0.0.1','--port','8101'); Directory=$backendDir},
    @{Name='api'; Port=8100; Health='http://127.0.0.1:8100/api/v1/health'; Exe=$pythonExe; Args=@('-m','uvicorn','opsweaver.api:app','--host','127.0.0.1','--port','8100'); Directory=$backendDir},
    @{Name='web'; Port=3100; Health='http://127.0.0.1:3100/overview'; Exe=$nodeExe; Args=@(('"' + (Join-Path $webDir 'node_modules\next\dist\bin\next') + '"'),'start','--hostname','127.0.0.1','--port','3100'); Directory=$webDir}
)
foreach ($definition in $definitions) {
    if (Test-LocalService $definition.Health) {
        Write-Host ($definition.Name + ' is already running.')
        continue
    }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $definition.Port -ErrorAction SilentlyContinue
    if ($listener) { throw ('Port ' + $definition.Port + ' is occupied by another service.') }
    $process = Start-Process -FilePath $definition.Exe -ArgumentList $definition.Args -WorkingDirectory $definition.Directory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir ($definition.Name + '.log')) -RedirectStandardError (Join-Path $runtimeDir ($definition.Name + '.error.log'))
    $records += @{Name=$definition.Name; Pid=$process.Id; StartedAt=$process.StartTime.ToUniversalTime().ToString('o')}
    $records | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-LocalService $definition.Health) { $ready = $true; break }
        if ($process.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    if (!$ready) { throw ($definition.Name + ' did not start. Check logs in .runtime.') }
    Write-Host ($definition.Name + ' ready.')
}
Write-Host 'OpsClaw ready: http://127.0.0.1:3100/overview'
if (!$NoBrowser) { Start-Process 'http://127.0.0.1:3100/overview' }
