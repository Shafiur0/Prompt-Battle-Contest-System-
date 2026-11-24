$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tunnelDirectory = Join-Path $projectDirectory '.local\cloudflare'
$statePath = Join-Path $tunnelDirectory 'state.json'
$composePath = Join-Path $projectDirectory 'docker-compose.yml'
Set-Location -LiteralPath $projectDirectory
function Get-LocalSetting([string]$name, [string]$fallback) {
  $line = Get-Content -LiteralPath (Join-Path $projectDirectory '.env') | Where-Object { $_ -match ('^' + [regex]::Escape($name) + '=') } | Select-Object -Last 1
  if ($line) { return $line.Substring($name.Length + 1).Trim().Trim('"').Trim("'") }
  return $fallback
}
function Write-TunnelJson([string]$path, $value) { [IO.File]::WriteAllText($path, ($value | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false))) }
function Save-TunnelState($state) { Write-TunnelJson $statePath $state }
function Get-ProcessRecord($process) { return @{ id = $process.Id; started = $process.StartTime.ToUniversalTime().ToString('o') } }
function Start-IndependentProcess([string]$filePath, [string[]]$arguments, [string]$directory, [string]$outputPath, [string]$errorPath) {
  $command = '"' + $filePath + '"'
  foreach ($argument in $arguments) { $command += ' "' + $argument + '"' }
  if ($outputPath -and $errorPath) {
    $command = '"' + $env:ComSpec + '" /d /s /c "' + $command + ' 1>"' + $outputPath + '" 2>"' + $errorPath + '""'
  }
  $environment = [Environment]::GetEnvironmentVariables().GetEnumerator() | ForEach-Object { $_.Key + '=' + $_.Value }
  # The WMI provider creates this process independently of the calling terminal's job.
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; CreateFlags = [uint32]0x01000400; EnvironmentVariables = [string[]]$environment }
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command; CurrentDirectory = $directory; ProcessStartupInformation = $startup }
  if ($created.ReturnValue -ne 0) { throw ('Background startup failed for ' + [IO.Path]::GetFileName($filePath) + ' (Windows code ' + $created.ReturnValue + ').') }
  return Get-Process -Id $created.ProcessId -ErrorAction Stop
}
function Stop-ProcessChildren([int]$parentProcessId) {
  $children = Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $parentProcessId)
  foreach ($child in $children) {
    Stop-ProcessChildren $child.ProcessId
    Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
  }
}
function Stop-RecordedProcess($record) {
  if (-not $record) { return }
  $process = Get-Process -Id $record.id -ErrorAction SilentlyContinue
  if (-not $process -or $process.HasExited) { return }
  try { $started = $process.StartTime } catch { return }
  if ($started -and $started.ToUniversalTime().ToString('o') -eq $record.started) {
    Stop-ProcessChildren $record.id
    Stop-Process -Id $record.id -ErrorAction SilentlyContinue
  }
}
function Wait-BattleHttp([string]$url, [int]$attempts = 90) {
  for ($attemptNumber = 0; $attemptNumber -lt $attempts; $attemptNumber++) {
    try { $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3; if ($response.StatusCode -eq 200) { return } } catch {}
    Start-Sleep -Seconds 2
  }
  throw ('Service did not become ready: ' + $url)
}
function Connect-KeycloakAdmin {
  & docker compose -f $composePath exec -T keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user local-admin --password local-admin-change-before-deployment
  if ($LASTEXITCODE -ne 0) { throw 'Could not configure the local sign-in service.' }
}
function Set-KeycloakClient([string]$clientId, [string]$settingsPath) {
  $container = (& docker compose -f $composePath ps -q keycloak).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $container) { throw 'Sign-in container is unavailable.' }
  & docker cp $settingsPath ("${container}:/tmp/prompt-battle-tunnel-client.json")
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy sign-in settings.' }
  & docker compose -f $composePath exec -T keycloak /opt/keycloak/bin/kcadm.sh update ("clients/" + $clientId) -r prompt-battle -f /tmp/prompt-battle-tunnel-client.json
  if ($LASTEXITCODE -ne 0) { throw 'Could not update the public sign-in callback.' }
}
function Start-BattleServers($state) {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  if (-not (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue)) {
    $apiPath = Join-Path $projectDirectory 'apps\api\dist\main.js'
    $api = Start-IndependentProcess $nodePath @($apiPath) (Join-Path $projectDirectory 'apps\api') (Join-Path $tunnelDirectory 'api.out.log') (Join-Path $tunnelDirectory 'api.err.log')
    $state.api = Get-ProcessRecord $api
    Save-TunnelState $state
  }
  $nextPath = Join-Path $projectDirectory 'node_modules\next\dist\bin\next'
  if (-not (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue)) {
    $web = Start-IndependentProcess $nodePath @($nextPath, 'start', '--hostname', '127.0.0.1', '--port', '3100') (Join-Path $projectDirectory 'apps\web') (Join-Path $tunnelDirectory 'web.out.log') (Join-Path $tunnelDirectory 'web.err.log')
    $state.web = Get-ProcessRecord $web
    Save-TunnelState $state
  }
  if ($state -isnot [System.Collections.IDictionary] -and -not $state.PSObject.Properties['worker']) { $state | Add-Member -NotePropertyName worker -NotePropertyValue $null }
  $workerPath = Join-Path $projectDirectory 'apps\api\dist\worker-main.js'
  $worker = Start-IndependentProcess $nodePath @($workerPath) (Join-Path $projectDirectory 'apps\api') (Join-Path $tunnelDirectory 'worker.out.log') (Join-Path $tunnelDirectory 'worker.err.log')
  $state.worker = Get-ProcessRecord $worker
  Save-TunnelState $state
  Wait-BattleHttp 'http://localhost:4000/api/v1/session'
  Wait-BattleHttp 'http://localhost:3100'
}
