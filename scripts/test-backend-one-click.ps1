$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'start-backend.cmd'
if (-not (Test-Path -LiteralPath $launcher)) { throw 'Launcher is missing from project root' }

$timer = [Diagnostics.Stopwatch]::StartNew()
& cmd.exe /c "`"$launcher`""
$timer.Stop()
if ($LASTEXITCODE -ne 0) { throw "Launcher failed with exit code $LASTEXITCODE" }
if ($timer.ElapsedMilliseconds -gt 2000) { throw "Launcher stayed in foreground for $($timer.ElapsedMilliseconds) ms" }

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $task = Get-ScheduledTask -TaskName 'JingyiReservationBackend' -ErrorAction Stop
    if ($task.State -eq 'Running' -and [IO.Path]::GetFileName($task.Actions[0].Execute) -ieq 'wscript.exe') {
        try {
            $probe = Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 2
            if ($probe.data.status -eq 'alive') { break }
        } catch {}
    }
    Start-Sleep -Milliseconds 500
}

$task = Get-ScheduledTask -TaskName 'JingyiReservationBackend' -ErrorAction Stop
if (@($task.Triggers | Where-Object { $null -ne $_ }).Count -ne 0) { throw 'Automatic trigger remains' }
if ($task.State -ne 'Running') { throw "Backend task state: $($task.State)" }
if ([IO.Path]::GetFileName($task.Actions[0].Execute) -ine 'wscript.exe') { throw 'Backend still launches Node directly in a visible console' }
$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop | Select-Object -First 1
$backendProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
$parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($backendProcess.ParentProcessId)"
$grandparentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($parentProcess.ParentProcessId)"
if ($grandparentProcess.Name -ine 'wscript.exe') { throw "Backend is not hosted by a hidden script: $($grandparentProcess.Name)" }

$first = Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 5
Start-Sleep -Seconds 2
$second = Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 5
$ready = Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/ready' -TimeoutSec 10
if ($first.data.status -ne 'alive' -or $second.data.status -ne 'alive' -or $ready.data.status -ne 'ready') { throw 'Backend health check failed' }
if ($second.data.uptimeSeconds -lt $first.data.uptimeSeconds) { throw 'Backend restarted after launcher closed' }

for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
        $page = Invoke-WebRequest 'http://127.0.0.1:5173/' -TimeoutSec 2 -UseBasicParsing
        if ($page.StatusCode -eq 200) { break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
$adminTask = Get-ScheduledTask -TaskName 'JingyiReservationAdmin' -ErrorAction Stop
if (@($adminTask.Triggers | Where-Object { $null -ne $_ }).Count -ne 0) { throw 'Admin task has an automatic trigger' }
if ($adminTask.State -ne 'Running') { throw "Admin task state: $($adminTask.State)" }
if ([IO.Path]::GetFileName($adminTask.Actions[0].Execute) -ine 'wscript.exe') { throw 'Admin task uses a visible console' }
$page = Invoke-WebRequest 'http://127.0.0.1:5173/' -TimeoutSec 5 -UseBasicParsing
$apiViaAdmin = Invoke-RestMethod 'http://127.0.0.1:5173/api/v1/health' -TimeoutSec 5
if ($page.StatusCode -ne 200 -or $page.Content -notmatch '<html' -or $apiViaAdmin.data.status -ne 'alive') { throw 'Admin page or API proxy failed' }
Write-Output 'PASS: backend and admin start manually in background, page and API healthy'
