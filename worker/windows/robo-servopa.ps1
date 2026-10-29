# Robô Servopa - entrada estável (copiada para %LOCALAPPDATA%\RoboServopa).
# É o que o Windows abre ao entrar e o atalho do menu Iniciar chama. Só
# encontra a versão atual do robô e abre o iniciador dela, que pode mudar
# a cada atualização automática.

param([switch]$Show)

$ErrorActionPreference = 'Stop'
$homeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
try {
  $folder = ([IO.File]::ReadAllText((Join-Path $homeDir 'app\current.txt'))).Trim()
  if ($folder -notmatch '^[0-9A-Za-z._-]+$') { throw 'versão inválida' }
  $launcher = Join-Path $homeDir "app\$folder\windows\launcher.ps1"
  if (-not (Test-Path -LiteralPath $launcher)) { throw 'iniciador ausente' }
} catch {
  if ($Show) {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show('O Robô Servopa não está instalado corretamente neste computador. Instale de novo pelo CRM (Tabelas > Configurar robô).', 'Robô Servopa', 'OK', 'Warning') | Out-Null
  }
  exit 1
}

& $launcher -HomeDir $homeDir -Show:$Show
exit $LASTEXITCODE
