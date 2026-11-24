param([switch]$SkipBuild)
. (Join-Path $PSScriptRoot 'tunnel-common.ps1')
New-Item -ItemType Directory -Path $tunnelDirectory -Force | Out-Null
if (Test-Path -LiteralPath $statePath) {
  $priorState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ($priorState.active) {
    $priorProcess = Get-Process -Id $priorState.cloudflared.id -ErrorAction SilentlyContinue
    if ($priorState.ready -and $priorProcess -and $priorProcess.StartTime.ToUniversalTime().ToString('o') -eq $priorState.cloudflared.started) {
      Write-Host ('Cloudflare Tunnel is already running: ' + $priorState.origin)
      exit 0
    }
    throw 'The previous tunnel stopped unexpectedly. Run npm run tunnel:stop before restarting.'
  }
}
$cloudflaredPath = Join-Path $tunnelDirectory 'cloudflared.exe'
if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
  Write-Host 'Downloading Cloudflare Tunnel from its official release...'
  Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cloudflaredPath -UseBasicParsing -TimeoutSec 120
}
$previousApi = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$previousWeb = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
foreach ($entry in @($previousApi, $previousWeb)) {
  if (-not $entry) { continue }
  $processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $entry.OwningProcess)
  $previousRecord = if ($entry.LocalPort -eq 4000 -and $priorState) { $priorState.api } elseif ($priorState) { $priorState.web } else { $null }
  $recorded = $previousRecord -and $previousRecord.id -eq $entry.OwningProcess -and (Get-Process -Id $entry.OwningProcess).StartTime.ToUniversalTime().ToString('o') -eq $previousRecord.started
  $projectCommand = $processInfo.CommandLine -match [regex]::Escape($projectDirectory)
  $expected = $processInfo.Name -eq 'node.exe' -and ($recorded -or ($projectCommand -and $processInfo.CommandLine -match '(dist[/\\]main\.js|\bnext\b.*\bstart\b)'))
  if (-not $expected) { throw ('Port ' + $entry.LocalPort + ' belongs to another app. Stop it before starting this tunnel.') }
}
$logPrefix = Join-Path $tunnelDirectory ('tunnel-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$tunnelProcess = Start-IndependentProcess $cloudflaredPath @('--no-autoupdate', 'tunnel', '--url', 'http://127.0.0.1:3100', '--protocol', 'http2') $projectDirectory ($logPrefix + '.out.log') ($logPrefix + '.err.log')
$state = @{ active = $true; ready = $false; origin = ''; cloudflared = (Get-ProcessRecord $tunnelProcess); api = $null; web = $null; worker = $null; originalClientId = ''; originalClientPath = ''; keycloakChanged = $false }
Save-TunnelState $state
try {
  for ($attemptNumber = 0; $attemptNumber -lt 60; $attemptNumber++) {
    Start-Sleep -Seconds 1
    $tunnelLog = Get-Content -LiteralPath ($logPrefix + '.err.log') -Raw -ErrorAction SilentlyContinue
    if ($tunnelLog -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $state.origin = $Matches[0]; break }
    if ($tunnelProcess.HasExited) { throw 'Cloudflare Tunnel exited. Inspect its log in .local/cloudflare.' }
  }
  if (-not $state.origin) { throw 'Cloudflare did not return a public URL.' }
  Save-TunnelState $state
  Connect-KeycloakAdmin
  $clientText = & docker compose -f $composePath exec -T keycloak /opt/keycloak/bin/kcadm.sh get clients -r prompt-battle -q clientId=prompt-battle --fields id,redirectUris,webOrigins
  if ($LASTEXITCODE -ne 0) { throw 'Could not read existing sign-in settings.' }
  $client = @((($clientText -join [Environment]::NewLine) | ConvertFrom-Json))[0]
  $state.originalClientId = $client.id
  $state.originalClientPath = Join-Path $tunnelDirectory 'client-original.json'
  Write-TunnelJson $state.originalClientPath @{ redirectUris = @($client.redirectUris); webOrigins = @($client.webOrigins) }
  Save-TunnelState $state
  $clientPublicPath = Join-Path $tunnelDirectory 'client-public.json'
  Write-TunnelJson $clientPublicPath @{ redirectUris = @($client.redirectUris) + @($state.origin + '/api/v1/auth/callback'); webOrigins = @($client.webOrigins) + @($state.origin) }
  Set-KeycloakClient $state.originalClientId $clientPublicPath
  $overridePath = Join-Path $tunnelDirectory 'compose-public.json'
  Write-TunnelJson $overridePath @{ services = @{ keycloak = @{ environment = @{ KC_HOSTNAME = $state.origin; KC_PROXY_HEADERS = 'xforwarded' } } } }
  $state.keycloakChanged = $true
  Save-TunnelState $state
  & docker compose -f $composePath -f $overridePath up -d keycloak
  if ($LASTEXITCODE -ne 0) { throw 'Could not restart public sign-in.' }
  Wait-BattleHttp 'http://localhost:8080/realms/prompt-battle/.well-known/openid-configuration'
  foreach ($entry in @($previousApi, $previousWeb)) { if ($entry) { Stop-Process -Id $entry.OwningProcess -ErrorAction Stop } }
  if ($priorState) { Stop-RecordedProcess $priorState.api; Stop-RecordedProcess $priorState.web }
  if ($priorState) { Stop-RecordedProcess $priorState.worker }
  $env:APP_ORIGIN = $state.origin
  $env:API_PORT = '4000'
  $env:API_INTERNAL_URL = 'http://localhost:4000'
  $env:KEYCLOAK_INTERNAL_URL = 'http://localhost:8080'
  $env:KEYCLOAK_IDENTITY_ISSUER = Get-LocalSetting 'KEYCLOAK_IDENTITY_ISSUER' (Get-LocalSetting 'KEYCLOAK_ISSUER' 'http://localhost:8080/realms/prompt-battle')
  $env:KEYCLOAK_ISSUER = $state.origin + '/realms/prompt-battle'
  $env:NODE_ENV = 'production'
  if (-not $SkipBuild) {
    & npm.cmd run build --workspace=@prompt-battle/api
    if ($LASTEXITCODE -ne 0) { throw 'API build failed.' }
    & npm.cmd run build --workspace=@prompt-battle/web
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  }
  Start-BattleServers $state
  Wait-BattleHttp $state.origin 45
  $state.ready = $true
  Save-TunnelState $state
  Write-Host ('Public app: ' + $state.origin)
  Write-Host 'Keep this computer running. Stop and restore local access with npm run tunnel:stop.'
} catch {
  Write-Host ('Tunnel setup failed: ' + $_.Exception.Message)
  Write-Host 'Run npm run tunnel:stop to restore local access, then inspect .local/cloudflare logs.'
  throw
}
