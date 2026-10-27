# Robô Servopa - iniciador com ícone ao lado do relógio do Windows.
#
# Abre o robô (Node) sem janela, reabre se ele cair, atualiza sozinho quando o
# CRM publica uma versão nova e mostra o estado no ícone. Uma única cópia por
# sessão do Windows (mutex). Chamado por ..\..\..\robo-servopa.ps1.
#
# Códigos de saída do robô (worker/run.mjs): 75 = versão nova disponível;
# 78 = este computador foi removido no CRM; outros = queda (reabre com espera).

param([Parameter(Mandatory = $true)][string]$HomeDir, [switch]$Show)

$ErrorActionPreference = 'Stop'
$coreFile = Join-Path $PSScriptRoot 'core.ps1'
. $coreFile
$paths = Get-RoboPaths $HomeDir

$createdNew = $false
$mutex = New-Object Threading.Mutex($true, $script:RoboMutexName, [ref]$createdNew)
if (-not $createdNew) {
  # Já está aberto: só pede para ele mostrar o estado (atalho do menu Iniciar).
  $mutex.Dispose()
  if ($Show) { try { [IO.File]::WriteAllText($paths.ShowFile, '1') } catch {} }
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-RoboMessage([string]$Text, [string]$Icon = 'Information') {
  [Windows.Forms.MessageBox]::Show($Text, 'Robô Servopa', 'OK', $Icon) | Out-Null
}

if (Test-Path -LiteralPath $paths.Revoked) {
  if ($Show) { Show-RoboMessage 'Este computador foi removido no CRM. Para voltar a usar o robô, instale de novo pelo CRM (Tabelas > Configurar robô).' 'Warning' }
  $mutex.ReleaseMutex(); $mutex.Dispose()
  exit 0
}

try { $config = Read-RoboConfig $paths }
catch {
  Write-RoboLog $paths "Iniciador: $($_.Exception.Message)"
  if ($Show) { Show-RoboMessage $_.Exception.Message 'Warning' }
  $mutex.ReleaseMutex(); $mutex.Dispose()
  exit 1
}

Remove-RoboPath $paths.StopFile
Remove-RoboPath $paths.ShowFile
Remove-RoboOldLogs $paths
# Com o mutex em mãos, qualquer Node/Firefox desta instalação ainda aberto é
# sobra de um iniciador anterior encerrado à força; ele travaria o robô novo.
Stop-RoboLeftovers $paths
Write-RoboLog $paths 'Iniciador aberto.'

# ── Ícone ──

function New-RoboIcon([int]$Red, [int]$Green, [int]$Blue) {
  $bitmap = New-Object Drawing.Bitmap 32, 32
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([Drawing.Color]::Transparent)
  $brush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb($Red, $Green, $Blue))
  $graphics.FillEllipse($brush, 1, 1, 30, 30)
  $font = New-Object Drawing.Font('Segoe UI', 17, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
  $format = New-Object Drawing.StringFormat
  $format.Alignment = [Drawing.StringAlignment]::Center
  $format.LineAlignment = [Drawing.StringAlignment]::Center
  $graphics.DrawString('S', $font, [Drawing.Brushes]::White, (New-Object Drawing.RectangleF(0, 1, 32, 32)), $format)
  $graphics.Dispose(); $brush.Dispose(); $font.Dispose()
  return [Drawing.Icon]::FromHandle($bitmap.GetHicon())
}

$icons = @{
  ready = New-RoboIcon 5 150 105      # verde: conectado e pronto
  busy = New-RoboIcon 79 70 229       # índigo: atualizando as tabelas
  warning = New-RoboIcon 217 119 6    # âmbar: precisa de atenção
  idle = New-RoboIcon 115 115 115     # cinza: iniciando / sem conexão
}

# Todo estado mutável fica nesta tabela (os eventos do WinForms rodam em escopo filho).
$robo = @{
  Child = $null
  ChildStartedAt = $null
  NextStartAt = Get-Date
  Failures = 0
  UpdatePending = $false
  UpdateJob = $null
  LastUpdateFailureAt = $null
  Relaunch = $false
  Exiting = $false
  LastRunNotified = $null
  StatusText = 'iniciando'
}

$tray = New-Object Windows.Forms.NotifyIcon
$tray.Icon = $icons.idle
$tray.Text = 'Robô Servopa: iniciando'
$menu = New-Object Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add('Robô Servopa: iniciando')
$statusItem.Enabled = $false
[void]$menu.Items.Add('-')
$openItem = $menu.Items.Add('Abrir as tabelas no CRM')
$logsItem = $menu.Items.Add('Ver registros')
[void]$menu.Items.Add('-')
$exitItem = $menu.Items.Add('Fechar o robô')
$tray.ContextMenuStrip = $menu
$tray.Visible = $true

function Set-RoboTray([string]$Text, $Icon) {
  $robo.StatusText = $Text
  $full = "Robô Servopa: $Text"
  $tray.Text = if ($full.Length -gt 63) { $full.Substring(0, 60) + '...' } else { $full }
  $statusItem.Text = $full
  if ($tray.Icon -ne $Icon) { $tray.Icon = $Icon }
}

function Show-RoboBalloon([string]$Text, [string]$Kind = 'Info') {
  $tray.BalloonTipTitle = 'Robô Servopa'
  $tray.BalloonTipText = $Text
  $tray.BalloonTipIcon = $Kind
  $tray.ShowBalloonTip(8000)
}

# ── Robô (Node) ──

function Stop-RoboChild {
  if ($robo.Child -and -not $robo.Child.HasExited) {
    # /T encerra também o Firefox aberto pelo robô.
    Invoke-RoboProcess (Join-Path $env:SystemRoot 'System32\taskkill.exe') @('/PID', [string]$robo.Child.Id, '/T', '/F') $null $null $paths 30 | Out-Null
  }
  if ($robo.Child) { $robo.Child.Dispose(); $robo.Child = $null }
}

function Get-RoboReadyApp {
  $app = Get-RoboCurrentApp $paths
  if (-not $app -or -not (Test-Path -LiteralPath (Get-RoboNodeExe $paths)) -or -not (Test-Path -LiteralPath (Join-Path $app.Dir 'node_modules\playwright-core'))) { return $null }
  return $app
}

function Start-RoboChild {
  $app = Get-RoboReadyApp
  $nodeExe = Get-RoboNodeExe $paths
  if (-not $app) {
    # Instalação incompleta (ou Node.js novo exigido pela versão): conserta sozinho.
    $robo.UpdatePending = $true
    return
  }
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $nodeExe
  $info.Arguments = ConvertTo-RoboArgument (Join-Path $app.Dir 'run.mjs')
  $info.WorkingDirectory = $app.Dir
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.EnvironmentVariables['CRM_BASE_URL'] = $config.CrmBaseUrl
  $info.EnvironmentVariables['SERVOPA_WORKER_KEY'] = $config.WorkerKey
  $info.EnvironmentVariables['SERVOPA_APP_VERSION'] = $app.Version
  $info.EnvironmentVariables['SERVOPA_DATA_DIR'] = $paths.Home
  $info.EnvironmentVariables['PLAYWRIGHT_BROWSERS_PATH'] = $paths.Browsers
  if ($robo.LastUpdateFailureAt -and ((Get-Date) - $robo.LastUpdateFailureAt).TotalMinutes -lt 30) {
    # A última atualização falhou há pouco: roda a versão atual sem pedir outra por 30 min.
    $info.EnvironmentVariables['SERVOPA_UPDATE_BLOCKED'] = '1'
  }
  $robo.Child = [Diagnostics.Process]::Start($info)
  $robo.ChildStartedAt = Get-Date
  Write-RoboLog $paths "Robô aberto (versão $($app.Version), processo $($robo.Child.Id))."
}

function Start-RoboUpdate {
  Set-RoboTray 'atualizando o robô' $icons.idle
  Write-RoboLog $paths 'Atualizando o robô.'
  $shell = [PowerShell]::Create()
  [void]$shell.AddScript({
    param($CoreFile, $HomeDir)
    $ErrorActionPreference = 'Stop'
    . $CoreFile
    $paths = Get-RoboPaths $HomeDir
    $config = Read-RoboConfig $paths
    Update-RoboInstallation $paths $config $null | Out-Null
  }).AddArgument($coreFile).AddArgument($paths.Home)
  $robo.UpdateJob = @{ Shell = $shell; Handle = $shell.BeginInvoke() }
}

function Complete-RoboUpdate {
  $job = $robo.UpdateJob
  $robo.UpdateJob = $null
  try {
    [void]$job.Shell.EndInvoke($job.Handle)
    if ($job.Shell.HadErrors -and $job.Shell.Streams.Error.Count -gt 0) { throw $job.Shell.Streams.Error[0].Exception }
    Write-RoboLog $paths 'Atualização concluída; reabrindo o iniciador.'
    $robo.UpdatePending = $false
    # O iniciador também pode ter mudado: reabre pela entrada estável.
    $robo.Relaunch = $true
    Exit-Robo
  } catch {
    $robo.LastUpdateFailureAt = Get-Date
    $robo.UpdatePending = $false
    $message = $_.Exception.Message
    if ($_.Exception.InnerException) { $message = $_.Exception.InnerException.Message }
    Write-RoboLog $paths "Falha ao atualizar: $message"
    if (Get-RoboReadyApp) {
      # A versão atual continua funcionando: volta a rodar já e tenta atualizar de novo depois.
      $robo.NextStartAt = Get-Date
    } else {
      $robo.NextStartAt = (Get-Date).AddMinutes(5)
      Set-RoboTray 'sem internet para terminar a instalação (tentando de novo)' $icons.warning
    }
  } finally {
    $job.Shell.Dispose()
  }
}

function Exit-Robo {
  if ($robo.Exiting) { return }
  $robo.Exiting = $true
  $timer.Stop()
  Stop-RoboChild
  $tray.Visible = $false
  $tray.Dispose()
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
  if ($robo.Relaunch) { Start-RoboLauncher $paths }
  Write-RoboLog $paths 'Iniciador encerrado.'
  [Windows.Forms.Application]::Exit()
}

function Read-RoboStatus {
  try {
    if (-not (Test-Path -LiteralPath $paths.Status)) { return $null }
    $status = [IO.File]::ReadAllText($paths.Status) | ConvertFrom-Json
    if ($robo.Child -and $status.pid -ne $robo.Child.Id) { return $null }
    return $status
  } catch { return $null }
}

function Update-RoboTrayFromStatus {
  $status = Read-RoboStatus
  if (-not $status) { Set-RoboTray 'iniciando' $icons.idle; return }
  switch ([string]$status.state) {
    'idle' { Set-RoboTray 'conectado e pronto' $icons.ready }
    'waiting-access' { Set-RoboTray 'aguardando o acesso da Servopa no CRM' $icons.warning }
    'offline' { Set-RoboTray 'sem conexão com o CRM (tentando de novo)' $icons.warning }
    'uploading' { Set-RoboTray 'enviando as tabelas ao CRM' $icons.busy }
    'collecting' {
      $progress = if ([int]$status.total -gt 0) { " ($($status.completed) de $($status.total))" } else { '' }
      Set-RoboTray "atualizando as tabelas$progress" $icons.busy
      if ($status.runId -and $status.runId -ne $robo.LastRunNotified) {
        $robo.LastRunNotified = [string]$status.runId
        Show-RoboBalloon 'Atualizando as tabelas da Servopa. Uma janela do Firefox vai abrir: não feche, ela fecha sozinha ao terminar.'
      }
    }
    default { Set-RoboTray 'iniciando' $icons.idle }
  }
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
  try {
    if ($robo.Exiting) { return }
    if (Test-Path -LiteralPath $paths.StopFile) {
      Remove-RoboPath $paths.StopFile
      Write-RoboLog $paths 'Pedido para fechar recebido (instalador/desinstalador).'
      Exit-Robo
      return
    }
    if (Test-Path -LiteralPath $paths.ShowFile) {
      Remove-RoboPath $paths.ShowFile
      Show-RoboBalloon "O robô já está aberto: $($robo.StatusText)."
    }

    if ($robo.UpdateJob) {
      if ($robo.UpdateJob.Handle.IsCompleted) { Complete-RoboUpdate }
      return
    }

    if ($robo.Child) {
      if (-not $robo.Child.HasExited) {
        if ($robo.Failures -gt 0 -and ((Get-Date) - $robo.ChildStartedAt).TotalMinutes -ge 10) { $robo.Failures = 0 }
        Update-RoboTrayFromStatus
        return
      }
      $code = $robo.Child.ExitCode
      $robo.Child.Dispose()
      $robo.Child = $null
      Write-RoboLog $paths "Robô encerrou com código $code."
      if ($code -eq 75) {
        $robo.UpdatePending = $true
      } elseif ($code -eq 78) {
        [IO.File]::WriteAllText($paths.Revoked, (Get-Date).ToString('o'))
        Show-RoboBalloon 'Este computador foi removido no CRM e o robô parou. Para voltar, instale de novo pelo CRM.' 'Warning'
        Start-Sleep -Seconds 6
        Exit-Robo
        return
      } else {
        $robo.Failures++
        $delay = [Math]::Min(300, 10 * [Math]::Pow(2, [Math]::Min($robo.Failures - 1, 5)))
        $robo.NextStartAt = (Get-Date).AddSeconds($delay)
        Set-RoboTray "reabrindo em $([int]$delay) s" $icons.warning
      }
    }

    if ((Get-Date) -lt $robo.NextStartAt) { return }
    if ($robo.UpdatePending) { Start-RoboUpdate; return }
    Start-RoboChild
  } catch {
    Write-RoboLog $paths "Iniciador: $($_.Exception.Message)"
    $robo.NextStartAt = (Get-Date).AddSeconds(60)
  }
})

$openItem.add_Click({ Start-Process "$($config.CrmBaseUrl)/tabelas" })
$logsItem.add_Click({ Start-Process -FilePath 'explorer.exe' -ArgumentList ('"{0}"' -f $paths.Logs) })
$exitItem.add_Click({
  $answer = [Windows.Forms.MessageBox]::Show(
    'Fechar o Robô Servopa? Este computador deixa de atualizar as tabelas até ser reiniciado ou até você abrir "Robô Servopa" no menu Iniciar.',
    'Robô Servopa', 'YesNo', 'Question')
  if ($answer -eq 'Yes') {
    Write-RoboLog $paths 'Fechado pelo usuário.'
    Exit-Robo
  }
})
$tray.add_DoubleClick({ Start-Process "$($config.CrmBaseUrl)/tabelas" })

if ($Show) { Show-RoboBalloon 'Robô Servopa aberto. Ele fica aqui, ao lado do relógio, e atualiza as tabelas sozinho.' }
$timer.Start()
[Windows.Forms.Application]::Run()
