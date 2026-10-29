# Robô Servopa - instalador.
#
# Chega dentro do "Instalar Robo Servopa.cmd" baixado no CRM, que o extrai
# para uma pasta temporária ao lado de core.ps1 e o abre sem console. O CRM
# preenche os dois valores abaixo; o código é de uso único e vale 1 hora.
# Nada para a pessoa digitar: uma janela de progresso e, no fim, "Pronto".

$ErrorActionPreference = 'Stop'
$CrmBaseUrl = '__ROBO_CRM_BASE_URL__'
$PairingCode = '__ROBO_PAIRING_CODE__'
$CoreFile = Join-Path $PSScriptRoot 'core.ps1'
. $CoreFile

# Testes automáticos: ROBO_SERVOPA_UNATTENDED=1 instala sem janela e grava o
# resultado em ROBO_SERVOPA_RESULT. ROBO_SERVOPA_HOME troca a pasta (core.ps1).
$Unattended = $env:ROBO_SERVOPA_UNATTENDED -eq '1'
$HomeDir = Get-RoboDefaultHome

$state = [hashtable]::Synchronized(@{
  Step = 'Conectando este computador ao CRM'
  Percent = 2
  Detail = ''
  Done = $false
  Error = $null
  WorkerName = $null
  SiteWarning = $false
})

# Roda numa thread separada para a janela continuar respondendo.
$installWork = {
  param($state, $CoreFile, $CrmBaseUrl, $PairingCode, $HomeDir)
  $ErrorActionPreference = 'Stop'
  try {
    . $CoreFile
    $paths = Get-RoboPaths $HomeDir
    New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
    Write-RoboLog $paths "Instalação iniciada ($env:USERNAME em $env:COMPUTERNAME)."
    $installStartedAt = Get-Date

    # 1. Troca o código de uso único pela chave deste computador. Se este mesmo
    #    arquivo já foi usado aqui (nova tentativa após uma falha de internet),
    #    reaproveita a chave salva em vez de pedir outra.
    $pairingHash = Get-RoboSha256Text $PairingCode
    $config = $null
    try {
      $saved = Read-RoboConfig $paths
      if ($saved.PairingHash -eq $pairingHash -and $saved.CrmBaseUrl -eq $CrmBaseUrl) { $config = $saved }
    } catch {}
    if (-not $config) {
      $result = Invoke-RoboApi 'POST' "$CrmBaseUrl/api/servopa-worker/pair" $null @{
        code = $PairingCode
        computerName = $env:COMPUTERNAME
        windowsUser = $env:USERNAME
      }
      if ($result.Status -ne 201) {
        $message = if ($result.Data -and $result.Data.error) { [string]$result.Data.error } else { "O CRM recusou a instalação (HTTP $($result.Status))." }
        throw $message
      }
      Save-RoboConfig $paths $CrmBaseUrl ([string]$result.Data.workerKey) ([string]$result.Data.workerId) ([string]$result.Data.name) $pairingHash
      $config = Read-RoboConfig $paths
    }
    $state.WorkerName = $config.WorkerName
    Write-RoboLog $paths "Computador conectado ao CRM como '$($config.WorkerName)'."

    # 2. Reinstalação: fecha o robô que estiver aberto antes de mexer nos arquivos.
    $state.Step = 'Preparando este computador'
    $state.Percent = 10
    Stop-RoboLauncher $paths

    # 3. Node.js portátil, código do robô, componentes, Firefox e Windows.
    $app = Update-RoboInstallation $paths $config {
      param($text, $percent, $detail)
      $state.Step = $text
      $state.Percent = $percent
      $state.Detail = $detail
    } | Select-Object -Last 1

    # 4. Prova que o navegador abre AQUI antes de dizer "Pronto" (conserta sozinho se precisar).
    $state.Step = 'Testando o navegador do robô'
    $state.Percent = 88
    $state.Detail = 'Uma janela do Firefox vai abrir e fechar sozinha. Não precisa mexer nela.'
    $state.SiteWarning = (Test-RoboBrowser $paths $app) -eq 'site'

    # 5. Abre o robô e espera ele se apresentar ao CRM.
    $state.Step = 'Abrindo o robô'
    $state.Percent = 92
    $state.Detail = ''
    Remove-RoboPath $paths.Status
    Start-RoboLauncher $paths
    $deadline = (Get-Date).AddSeconds(120)
    $ready = $false
    while (-not $ready -and (Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 1
      try {
        $status = [IO.File]::ReadAllText($paths.Status) | ConvertFrom-Json
        $fresh = [DateTimeOffset]::Parse([string]$status.at).UtcDateTime -ge $installStartedAt.ToUniversalTime().AddSeconds(-5)
        $ready = $fresh -and ([string]$status.state -in @('idle', 'waiting-access', 'collecting', 'uploading'))
      } catch {}
    }
    if (-not $ready) {
      throw "O robô foi instalado, mas não conseguiu se conectar ao CRM. Reinicie o computador; se continuar, envie ao suporte os registros em $($paths.Logs)."
    }
    $state.Percent = 100
    Write-RoboLog $paths 'Instalação concluída.'
  } catch {
    $state.Error = $_.Exception.Message
    try { Write-RoboLog (Get-RoboPaths $HomeDir) "Instalação falhou: $($_.Exception.Message)" } catch {}
  } finally {
    $state.Done = $true
  }
}

function Remove-InstallerFiles {
  # Apaga a pasta temporária com este instalador (o código de uso único vai junto).
  try { Remove-Item -LiteralPath $PSScriptRoot -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}

# Testes automáticos: com ROBO_SERVOPA_RESULT, grava o resultado (e a janela fecha sozinha).
function Write-InstallResult {
  if ($env:ROBO_SERVOPA_RESULT) {
    [IO.File]::WriteAllText($env:ROBO_SERVOPA_RESULT, (@{ ok = (-not $state.Error); error = $state.Error; workerName = $state.WorkerName } | ConvertTo-Json -Compress))
  }
}

if ($Unattended) {
  & $installWork $state $CoreFile $CrmBaseUrl $PairingCode $HomeDir
  Write-InstallResult
  Remove-InstallerFiles
  if ($state.Error) { exit 1 }
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$brand = [Drawing.Color]::FromArgb(79, 70, 229)
$muted = [Drawing.Color]::FromArgb(95, 99, 110)

$form = New-Object Windows.Forms.Form
$form.Text = 'Robô Servopa'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object Drawing.Size(500, 250)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.Font = New-Object Drawing.Font('Segoe UI', 10)
$form.BackColor = [Drawing.Color]::White
$form.TopMost = $true

$title = New-Object Windows.Forms.Label
$title.Text = 'Instalando o Robô Servopa'
$title.Font = New-Object Drawing.Font('Segoe UI Semibold', 16)
$title.Location = New-Object Drawing.Point(28, 22)
$title.AutoSize = $true
$form.Controls.Add($title)

$subtitle = New-Object Windows.Forms.Label
$subtitle.Text = 'Não precisa preencher nada. Pode continuar usando o computador.'
$subtitle.ForeColor = $muted
$subtitle.Location = New-Object Drawing.Point(30, 60)
$subtitle.AutoSize = $true
$form.Controls.Add($subtitle)

$stepLabel = New-Object Windows.Forms.Label
$stepLabel.Location = New-Object Drawing.Point(30, 104)
$stepLabel.Size = New-Object Drawing.Size(440, 22)
$form.Controls.Add($stepLabel)

$progress = New-Object Windows.Forms.ProgressBar
$progress.Location = New-Object Drawing.Point(30, 130)
$progress.Size = New-Object Drawing.Size(440, 18)
$progress.Minimum = 0
$progress.Maximum = 100
$form.Controls.Add($progress)

$detailLabel = New-Object Windows.Forms.Label
$detailLabel.ForeColor = $muted
$detailLabel.Location = New-Object Drawing.Point(30, 154)
$detailLabel.Size = New-Object Drawing.Size(440, 40)
$form.Controls.Add($detailLabel)

$closeButton = New-Object Windows.Forms.Button
$closeButton.Text = 'Aguarde...'
$closeButton.Enabled = $false
$closeButton.Location = New-Object Drawing.Point(350, 198)
$closeButton.Size = New-Object Drawing.Size(120, 36)
$closeButton.FlatStyle = 'Flat'
$closeButton.FlatAppearance.BorderSize = 0
$closeButton.BackColor = $brand
$closeButton.ForeColor = [Drawing.Color]::White
$closeButton.add_Click({ $form.Close() })
$form.Controls.Add($closeButton)

$retryButton = New-Object Windows.Forms.Button
$retryButton.Text = 'Tentar de novo'
$retryButton.Visible = $false
$retryButton.Location = New-Object Drawing.Point(214, 198)
$retryButton.Size = New-Object Drawing.Size(126, 36)
$form.Controls.Add($retryButton)

$runner = @{ Shell = $null; Handle = $null }
function Start-InstallWork {
  $state.Done = $false
  $state.Error = $null
  $state.SiteWarning = $false
  $state.Step = 'Conectando este computador ao CRM'
  $state.Percent = 2
  $state.Detail = ''
  $title.Text = 'Instalando o Robô Servopa'
  $title.ForeColor = [Drawing.Color]::Black
  $stepLabel.ForeColor = [Drawing.Color]::Black
  $retryButton.Visible = $false
  $closeButton.Enabled = $false
  $closeButton.Text = 'Aguarde...'
  $shell = [PowerShell]::Create()
  [void]$shell.AddScript($installWork).AddArgument($state).AddArgument($CoreFile).AddArgument($CrmBaseUrl).AddArgument($PairingCode).AddArgument($HomeDir)
  $runner.Shell = $shell
  $runner.Handle = $shell.BeginInvoke()
  $timer.Start()
}
$retryButton.add_Click({ Start-InstallWork })

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 300
$timer.add_Tick({
  $stepLabel.Text = $state.Step
  $progress.Value = [Math]::Max(0, [Math]::Min(100, [int]$state.Percent))
  $detailLabel.Text = $state.Detail
  if (-not $state.Done) { return }
  $timer.Stop()
  try { $runner.Shell.EndInvoke($runner.Handle) | Out-Null } catch {}
  $runner.Shell.Dispose()
  if ($state.Error) {
    $title.Text = 'A instalação não terminou'
    $title.ForeColor = [Drawing.Color]::FromArgb(185, 28, 28)
    $stepLabel.Text = 'Nada foi perdido. Você pode tentar de novo.'
    $detailLabel.Text = $state.Error
    $retryButton.Visible = $true
    $closeButton.Text = 'Fechar'
  } else {
    $title.Text = 'Pronto!'
    $title.ForeColor = [Drawing.Color]::FromArgb(4, 120, 87)
    $stepLabel.Text = 'Este computador já atualiza as tabelas sozinho.'
    $detailLabel.Text = "O robô abre junto com o Windows e fica no ícone ao lado do relógio. Conectado ao CRM como `"$($state.WorkerName)`"."
    if ($state.SiteWarning) { $detailLabel.Text += ' O navegador abriu; o site da Servopa demorou agora, mas o robô tenta de novo ao rodar.' }
    $closeButton.Text = 'Concluir'
  }
  $closeButton.Enabled = $true
  $form.TopMost = $false
  $form.Activate()
  if ($env:ROBO_SERVOPA_RESULT) {
    Write-InstallResult
    $form.Close()
  }
})

$form.add_FormClosing({
  param($source, $closing)
  if (-not $state.Done) {
    $answer = [Windows.Forms.MessageBox]::Show('A instalação ainda está em andamento. Cancelar mesmo assim?', 'Robô Servopa', 'YesNo', 'Question')
    if ($answer -ne 'Yes') { $closing.Cancel = $true; return }
    try { $runner.Shell.Stop() } catch {}
  }
})

$form.add_Shown({ Start-InstallWork })
[void]$form.ShowDialog()
Remove-InstallerFiles
