# Robô Servopa - desinstalador (copiado para %LOCALAPPDATA%\RoboServopa).
# Aberto por Configurações > Aplicativos > Robô Servopa > Desinstalar.
# Independente do resto da instalação: funciona mesmo se ela estiver quebrada.

param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
$homeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Windows.Forms

if (-not $Quiet) {
  $answer = [Windows.Forms.MessageBox]::Show(
    'Remover o Robô Servopa deste computador? Ele deixa de atualizar as tabelas daqui. Os outros computadores continuam funcionando.',
    'Robô Servopa', 'YesNo', 'Question')
  if ($answer -ne 'Yes') { exit 0 }
}

Set-Location -LiteralPath $env:TEMP

# 1. Pede ao iniciador para fechar (ele encerra o robô e o Firefox) e espera.
$mutexName = 'Local\RoboServopaReobote'
$mutex = $null
if ([Threading.Mutex]::TryOpenExisting($mutexName, [ref]$mutex)) {
  $mutex.Dispose()
  try { [IO.File]::WriteAllText((Join-Path $homeDir 'stop'), '1') } catch {}
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $mutex = $null
    if (-not [Threading.Mutex]::TryOpenExisting($mutexName, [ref]$mutex)) { break }
    $mutex.Dispose()
    Start-Sleep -Milliseconds 500
  }
}
Get-Process -Name node, firefox -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($homeDir, [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { try { $_.Kill() } catch {} }

# 2. Desliga a chave deste computador no CRM (se der; sem internet o CRM só o verá offline).
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
  Add-Type -AssemblyName System.Security
  $config = [IO.File]::ReadAllText((Join-Path $homeDir 'config.json')) | ConvertFrom-Json
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([string]$config.workerKey), [Text.Encoding]::UTF8.GetBytes('Reobote.RoboServopa.v1'), [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $key = [Text.Encoding]::UTF8.GetString($bytes)
  if ([string]$config.crmBaseUrl -match '^https?://[A-Za-z0-9.-]+(:\d{1,5})?$' -and $key -match '^svw_[A-Za-z0-9_-]{40,}$') {
    $request = [Net.HttpWebRequest]::Create("$($config.crmBaseUrl)/api/servopa-worker/unpair")
    $request.Method = 'POST'
    $request.Timeout = 15000
    $request.ContentType = 'application/json'
    $request.Headers['Authorization'] = "Bearer $key"
    $body = [Text.Encoding]::UTF8.GetBytes('{}')
    $request.ContentLength = $body.Length
    $stream = $request.GetRequestStream(); $stream.Write($body, 0, $body.Length); $stream.Close()
    $request.GetResponse().Close()
  }
} catch {}

# 3. Remove a inicialização automática, a entrada de Aplicativos e o atalho.
#    (ROBO_SERVOPA_TEST_REGISTRY=1: a chave inerte dos testes automáticos; ver core.ps1.)
$registryRoot = if ($env:ROBO_SERVOPA_TEST_REGISTRY -eq '1') { 'HKCU:\Software\RoboServopaTeste' } else { 'HKCU:\Software\Microsoft\Windows\CurrentVersion' }
Remove-ItemProperty -Path "$registryRoot\Run" -Name 'RoboServopa' -ErrorAction SilentlyContinue
Remove-Item -Path "$registryRoot\Uninstall\RoboServopa" -Recurse -Force -ErrorAction SilentlyContinue
if ($env:ROBO_SERVOPA_TEST_REGISTRY -eq '1') { Remove-Item -Path $registryRoot -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Robô Servopa.lnk') -Force -ErrorAction SilentlyContinue

# 4. Apaga a pasta (perfil do Firefox, registros, chave). Tenta algumas vezes:
#    o Windows pode demorar a soltar arquivos de processos recém-encerrados.
$removed = $false
for ($attempt = 0; $attempt -lt 5 -and -not $removed; $attempt++) {
  Remove-Item -LiteralPath $homeDir -Recurse -Force -ErrorAction SilentlyContinue
  $removed = -not (Test-Path -LiteralPath $homeDir)
  if (-not $removed) { Start-Sleep -Seconds 2 }
}

if (-not $Quiet) {
  if ($removed) {
    [Windows.Forms.MessageBox]::Show('Robô Servopa removido deste computador.', 'Robô Servopa', 'OK', 'Information') | Out-Null
  } else {
    [Windows.Forms.MessageBox]::Show("O Robô Servopa foi desligado, mas alguns arquivos ficaram em:`n$homeDir`nApague essa pasta depois de reiniciar o computador.", 'Robô Servopa', 'OK', 'Warning') | Out-Null
  }
}
