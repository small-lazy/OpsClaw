$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$recordPath = Join-Path $projectRoot '.runtime\processes.json'
if (!(Test-Path -LiteralPath $recordPath)) { Write-Host 'No launcher-managed processes.'; exit 0 }
$records = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
foreach ($record in $records) {
    $process = Get-Process -Id $record.Pid -ErrorAction SilentlyContinue
    if (!$process) { continue }
    $details = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $record.Pid)
    $matchesWorkspace = $details.ExecutablePath.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or $details.CommandLine.Contains($projectRoot)
    $matchesStart = [Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTime]::Parse($record.StartedAt).ToUniversalTime()).TotalSeconds) -lt 2
    if ($matchesWorkspace -and $matchesStart) {
        # Windows venv redirectors spawn a second Python process. Stop only
        # descendants that still name this exact workspace in their command.
        $processSnapshot = @(Get-CimInstance Win32_Process)
        $pendingIds = @([int]$record.Pid)
        $descendantIds = @()
        for ($depth = 0; $depth -lt 5 -and $pendingIds.Count -gt 0; $depth++) {
            $children = @($processSnapshot | Where-Object { $pendingIds -contains [int]$_.ParentProcessId -and $_.CommandLine -and $_.CommandLine.Contains($projectRoot) })
            $pendingIds = @($children | ForEach-Object { [int]$_.ProcessId })
            $descendantIds = $pendingIds + $descendantIds
        }
        foreach ($childPid in $descendantIds) { Stop-Process -Id $childPid -ErrorAction SilentlyContinue }
        Stop-Process -Id $record.Pid -ErrorAction SilentlyContinue
        Write-Host ($record.Name + ' stopped.')
    }
}
Set-Content -LiteralPath $recordPath -Value '[]' -Encoding UTF8
