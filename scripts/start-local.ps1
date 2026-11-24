$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectDirectory
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install a supported Node.js LTS runtime first.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install and start Docker Desktop first.' }
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm install; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
& docker compose up -d
if ($LASTEXITCODE -ne 0) { throw 'Container startup failed. Start Docker Desktop and retry.' }
Write-Host 'Waiting for local login service...'
$loginReady = $false
for ($attemptNumber = 0; $attemptNumber -lt 90; $attemptNumber++) {
  try { $null = Invoke-RestMethod -Uri 'http://localhost:8080/realms/prompt-battle/.well-known/openid-configuration' -TimeoutSec 3; $loginReady = $true; break } catch { Start-Sleep -Seconds 2 }
}
if (-not $loginReady) { throw 'Login service did not become ready. Inspect docker compose logs keycloak.' }
& npm run build --workspace=@prompt-battle/core
if ($LASTEXITCODE -ne 0) { throw 'Domain build failed.' }
if (Test-Path -LiteralPath 'packages/openrouter/package.json') { & npm run build --workspace=@prompt-battle/openrouter; if ($LASTEXITCODE -ne 0) { throw 'OpenRouter adapter build failed.' } }
& npm run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
& npm run db:seed
if ($LASTEXITCODE -ne 0) { throw 'Sample setup failed.' }
Write-Host 'Open http://localhost:3100. Configure OPENROUTER_API_KEY privately in .env and restart after changing it.'
& npm run dev