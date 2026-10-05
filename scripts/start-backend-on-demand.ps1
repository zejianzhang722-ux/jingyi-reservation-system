$ErrorActionPreference = 'Stop'

try {
    $root = Split-Path -Parent $PSScriptRoot
    $serverDir = Join-Path $root 'server'
    $adminDir = Join-Path $root 'admin'
    $node = Join-Path $root 'nodejs\node.exe'
    $app = Join-Path $serverDir 'src\app.js'
    $vite = Join-Path $adminDir 'node_modules\vite\bin\vite.js'
    $runner = Join-Path $PSScriptRoot 'run-backend-hidden.vbs'
    $adminRunner = Join-Path $PSScriptRoot 'run-admin-hidden.vbs'
    $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
    $taskName = 'JingyiReservationBackend'
    $adminTaskName = 'JingyiReservationAdmin'
    $healthUrl = 'http://127.0.0.1:3000/api/v1/health'
    $adminUrl = 'http://127.0.0.1:5173/'

    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Node runtime not found: $node" }
    if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw "Backend entry not found: $app" }
    if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw "Hidden runner not found: $runner" }
    if (-not (Test-Path -LiteralPath $vite -PathType Leaf)) { throw "Web admin dependencies not found: $vite" }
    if (-not (Test-Path -LiteralPath $adminRunner -PathType Leaf)) { throw "Hidden web admin runner not found: $adminRunner" }

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        $legacyAction = @($task.Actions).Count -eq 1 -and
            $task.Actions[0].Execute -eq $node -and
            $task.Actions[0].Arguments -eq ('"' + $app + '"') -and
            $task.Actions[0].WorkingDirectory -eq $serverDir
        $hiddenAction = @($task.Actions).Count -eq 1 -and
            $task.Actions[0].Execute -eq $wscript -and
            $task.Actions[0].Arguments -eq ('"' + $runner + '"') -and
            $task.Actions[0].WorkingDirectory -eq $root
        if (-not $legacyAction -and -not $hiddenAction) {
            throw "An unrelated Windows task already uses the name $taskName. No changes were made."
        }

        if ($legacyAction -or @($task.Triggers | Where-Object { $null -ne $_ }).Count -gt 0) {
            Write-Output 'Updating the backend task for hidden, manual-only operation...'
            if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName }
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
            $task = $null
        }
    }

    if (-not $task) {
        $action = New-ScheduledTaskAction -Execute $wscript -Argument ('"' + $runner + '"') -WorkingDirectory $root
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        $definition = New-ScheduledTask -Action $action -Settings $settings -Principal $principal
        Register-ScheduledTask -TaskName $taskName -InputObject $definition | Out-Null
        $task = Get-ScheduledTask -TaskName $taskName
        if (@($task.Triggers | Where-Object { $null -ne $_ }).Count -ne 0) { throw 'The backend task unexpectedly has an automatic trigger.' }
    }

    $backendRunning = $false
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        if ($health.data.status -eq 'alive') {
            Write-Output 'Backend is already running: http://127.0.0.1:3000/'
            $backendRunning = $true
        }
    } catch {
        # A connection failure is expected when the backend is stopped.
    }

    if (-not $backendRunning) {
        Write-Output 'Starting backend...'
        Start-ScheduledTask -TaskName $taskName
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 500
            try {
                $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
                if ($health.data.status -eq 'alive') {
                    $backendRunning = $true
                    Write-Output 'Backend is running: http://127.0.0.1:3000/'
                    break
                }
            } catch {
                # Keep polling while the service starts.
            }
        }
        if (-not $backendRunning) {
            $info = Get-ScheduledTaskInfo -TaskName $taskName
            throw "Backend did not become healthy. Task result: $($info.LastTaskResult)"
        }
    }

    $adminTask = Get-ScheduledTask -TaskName $adminTaskName -ErrorAction SilentlyContinue
    if ($adminTask) {
        if (@($adminTask.Actions).Count -ne 1 -or
            $adminTask.Actions[0].Execute -ne $wscript -or
            $adminTask.Actions[0].Arguments -ne ('"' + $adminRunner + '"') -or
            $adminTask.Actions[0].WorkingDirectory -ne $adminDir -or
            @($adminTask.Triggers | Where-Object { $null -ne $_ }).Count -ne 0) {
            throw "An unrelated or automatic Windows task already uses the name $adminTaskName. No changes were made."
        }
    } else {
        $adminAction = New-ScheduledTaskAction -Execute $wscript -Argument ('"' + $adminRunner + '"') -WorkingDirectory $adminDir
        $adminSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $adminPrincipal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        $adminDefinition = New-ScheduledTask -Action $adminAction -Settings $adminSettings -Principal $adminPrincipal
        Register-ScheduledTask -TaskName $adminTaskName -InputObject $adminDefinition | Out-Null
    }

    $adminRunning = $false
    try {
        $page = Invoke-WebRequest -Uri $adminUrl -TimeoutSec 2 -UseBasicParsing
        if ($page.StatusCode -eq 200 -and $page.Content -match '<html') {
            Write-Output 'Web admin is already running: http://127.0.0.1:5173/'
            $adminRunning = $true
        }
    } catch {
        # A connection failure is expected when the web admin is stopped.
    }

    if (-not $adminRunning) {
        Write-Output 'Starting web admin...'
        Start-ScheduledTask -TaskName $adminTaskName
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 500
            try {
                $page = Invoke-WebRequest -Uri $adminUrl -TimeoutSec 2 -UseBasicParsing
                if ($page.StatusCode -eq 200 -and $page.Content -match '<html') {
                    $adminRunning = $true
                    Write-Output 'Web admin is running: http://127.0.0.1:5173/'
                    break
                }
            } catch {
                # Keep polling while the web admin starts.
            }
        }
        if (-not $adminRunning) {
            $info = Get-ScheduledTaskInfo -TaskName $adminTaskName
            throw "Web admin did not become healthy. Task result: $($info.LastTaskResult)"
        }
    }
    Write-Output 'Both services are ready and will stay in the background until shutdown.'
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
