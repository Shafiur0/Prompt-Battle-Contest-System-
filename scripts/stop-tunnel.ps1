. (Join-Path $PSScriptRoot 'tunnel-common.ps1')
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host 'No Cloudflare Tunnel has been started.'; exit 0 }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if (-not $state.active) { Write-Host 'Cloudflare Tunnel is already stopped.'; exit 0 }
Stop-RecordedProcess $state.cloudflared
Stop-RecordedProcess $state.web
Stop-RecordedProcess $state.api
Stop-RecordedProcess $state.worker
if ($state.originalClientId -and (Test-Path -LiteralPath $state.originalClientPath)) {
  Connect-KeycloakAdmin
  Set-KeycloakClient $state.originalClientId $state.originalClientPath
}
if ($state.keycloakChanged) {
  & docker compose -f $composePath up -d keycloak
  if ($LASTEXITCODE -ne 0) { throw 'Could not restore the local sign-in service.' }
  Wait-BattleHttp 'http://localhost:8080/realms/prompt-battle/.well-known/openid-configuration'
}
$env:APP_ORIGIN = Get-LocalSetting 'APP_ORIGIN' 'http://localhost:3100'
$env:API_PORT = Get-LocalSetting 'API_PORT' '4000'
$env:API_INTERNAL_URL = Get-LocalSetting 'API_INTERNAL_URL' 'http://localhost:4000'
$env:KEYCLOAK_ISSUER = Get-LocalSetting 'KEYCLOAK_ISSUER' 'http://localhost:8080/realms/prompt-battle'
$env:KEYCLOAK_IDENTITY_ISSUER = Get-LocalSetting 'KEYCLOAK_IDENTITY_ISSUER' $env:KEYCLOAK_ISSUER
$env:KEYCLOAK_INTERNAL_URL = 'http://localhost:8080'
$env:NODE_ENV = Get-LocalSetting 'NODE_ENV' 'development'
Start-BattleServers $state
$state.active = $false
$state.ready = $false
$state.origin = $env:APP_ORIGIN
Save-TunnelState $state
Write-Host ('Tunnel stopped. Local app: ' + $env:APP_ORIGIN)
