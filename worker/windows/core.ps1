# Robô Servopa - funções compartilhadas pelo instalador e pelo iniciador.
#
# Windows PowerShell 5.1, sem administrador: tudo fica no perfil do usuário
# (%LOCALAPPDATA%\RoboServopa) e no registro do usuário (HKCU).
#
# Estrutura instalada:
#   config.json             endereço do CRM + chave do computador (protegida pelo Windows/DPAPI)
#   runtime\node-vX-win-x64 Node.js portátil oficial (hash SHA-256 conferido)
#   app\<versão>\           código do robô baixado do CRM (atualiza sozinho)
#   app\current.txt         versão em uso
#   browsers\               Firefox do Playwright
#   profile\                perfil do Firefox (sessão da Servopa / Cloudflare)
#   logs\                   registros (14 dias)
#   robo-servopa.ps1        abre o iniciador da versão atual (não muda entre versões)
#   desinstalar.ps1         remove tudo (também em Configurações > Apps)

$script:RoboNodeVersion = 'v24.22.1'
$script:RoboNodeSha256 = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5'
$script:RoboMutexName = 'Local\RoboServopaReobote'
# Testes automáticos (ROBO_SERVOPA_TEST_REGISTRY=1) gravam numa chave inerte, que
# o Windows não executa ao entrar, e o atalho vai para a pasta de teste.
$script:RoboTestRegistry = $env:ROBO_SERVOPA_TEST_REGISTRY -eq '1'
$registryRoot = if ($script:RoboTestRegistry) { 'HKCU:\Software\RoboServopaTeste' } else { 'HKCU:\Software\Microsoft\Windows\CurrentVersion' }
$script:RoboRunKey = "$registryRoot\Run"
$script:RoboRunValue = 'RoboServopa'
$script:RoboUninstallKey = "$registryRoot\Uninstall\RoboServopa"
$script:RoboEntropy = [Text.Encoding]::UTF8.GetBytes('Reobote.RoboServopa.v1')
$script:RoboPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# Downloads do nodejs.org e do CRM exigem TLS 1.2 (o padrão antigo do .NET não inclui).
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072

function Get-RoboDefaultHome {
  if ($env:ROBO_SERVOPA_HOME) { return $env:ROBO_SERVOPA_HOME }
  return (Join-Path $env:LOCALAPPDATA 'RoboServopa')
}

function Get-RoboPaths([string]$HomeDir) {
  return @{
    Home = $HomeDir
    Config = Join-Path $HomeDir 'config.json'
    AppRoot = Join-Path $HomeDir 'app'
    CurrentFile = Join-Path $HomeDir 'app\current.txt'
    RuntimeRoot = Join-Path $HomeDir 'runtime'
    Browsers = Join-Path $HomeDir 'browsers'
    Logs = Join-Path $HomeDir 'logs'
    Status = Join-Path $HomeDir 'status.json'
    Revoked = Join-Path $HomeDir 'revoked'
    StopFile = Join-Path $HomeDir 'stop'
    ShowFile = Join-Path $HomeDir 'show'
    Stub = Join-Path $HomeDir 'robo-servopa.ps1'
    Uninstaller = Join-Path $HomeDir 'desinstalar.ps1'
  }
}

function Write-RoboLog($Paths, [string]$Message) {
  try {
    New-Item -ItemType Directory -Force -Path $Paths.Logs | Out-Null
    $file = Join-Path $Paths.Logs ('robo-windows-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd'))
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), ($Message -replace 'svw_[A-Za-z0-9_-]+', 'svw_[REDACTED]' -replace 'svp_[A-Za-z0-9._-]+', 'svp_[REDACTED]')
    [IO.File]::AppendAllText($file, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
  } catch {}
}

function Remove-RoboOldLogs($Paths) {
  try {
    $cutoff = (Get-Date).AddDays(-14)
    Get-ChildItem -LiteralPath $Paths.Logs -Filter 'robo-windows-*.log' -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  } catch {}
}

function Get-RoboSha256Text([string]$Value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha.Dispose() }
}

# ── Chave do computador: protegida pelo Windows (DPAPI, só este usuário neste computador) ──

function Protect-RoboSecret([string]$Value) {
  Add-Type -AssemblyName System.Security
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $script:RoboEntropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  return [Convert]::ToBase64String($protected)
}

function Unprotect-RoboSecret([string]$Value) {
  Add-Type -AssemblyName System.Security
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($Value), $script:RoboEntropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  return [Text.Encoding]::UTF8.GetString($bytes)
}

function Test-RoboCrmUrl([string]$Url) {
  if ($Url -notmatch '^https?://[A-Za-z0-9.-]+(:\d{1,5})?$') { return $false }
  $uri = [Uri]$Url
  return ($uri.Scheme -eq 'https' -or $uri.Host -in @('localhost', '127.0.0.1'))
}

function Save-RoboConfig($Paths, [string]$CrmBaseUrl, [string]$WorkerKey, [string]$WorkerId, [string]$WorkerName, [string]$PairingHash) {
  if (-not (Test-RoboCrmUrl $CrmBaseUrl)) { throw 'Endereço do CRM inválido.' }
  if ($WorkerKey -notmatch '^svw_[A-Za-z0-9_-]{40,}$') { throw 'O CRM devolveu uma chave inválida.' }
  New-Item -ItemType Directory -Force -Path $Paths.Home | Out-Null
  $data = [ordered]@{
    version = 1
    crmBaseUrl = $CrmBaseUrl
    workerId = $WorkerId
    workerName = $WorkerName
    workerKey = Protect-RoboSecret $WorkerKey
    pairingHash = $PairingHash
    savedAt = (Get-Date).ToString('o')
  }
  $temporary = "$($Paths.Config).tmp"
  [IO.File]::WriteAllText($temporary, ($data | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $Paths.Config -Force
}

function Read-RoboConfig($Paths) {
  if (-not (Test-Path -LiteralPath $Paths.Config)) { throw 'Configuração do robô não encontrada. Instale de novo pelo CRM.' }
  $data = [IO.File]::ReadAllText($Paths.Config) | ConvertFrom-Json
  if ($data.version -ne 1 -or -not (Test-RoboCrmUrl ([string]$data.crmBaseUrl))) { throw 'Configuração do robô inválida. Instale de novo pelo CRM.' }
  try { $key = Unprotect-RoboSecret ([string]$data.workerKey) } catch { throw 'A chave deste computador não pôde ser lida (outro usuário do Windows?). Instale de novo pelo CRM.' }
  if ($key -notmatch '^svw_[A-Za-z0-9_-]{40,}$') { throw 'Configuração do robô inválida. Instale de novo pelo CRM.' }
  return [pscustomobject]@{
    CrmBaseUrl = [string]$data.crmBaseUrl
    WorkerKey = $key
    WorkerId = [string]$data.workerId
    WorkerName = [string]$data.workerName
    PairingHash = [string]$data.pairingHash
  }
}

# ── HTTP ──

function Get-RoboWebException($ErrorRecord) {
  $exception = $ErrorRecord.Exception
  while ($exception -and -not ($exception -is [Net.WebException])) { $exception = $exception.InnerException }
  return $exception
}

function New-RoboRequest([string]$Method, [string]$Url, [string]$WorkerKey) {
  $request = [Net.HttpWebRequest]::Create($Url)
  $request.Method = $Method
  $request.Timeout = 60000
  $request.ReadWriteTimeout = 300000
  $request.UserAgent = 'RoboServopa-Windows/1'
  $request.AllowAutoRedirect = $true
  if ($WorkerKey) {
    $request.Headers['Authorization'] = "Bearer $WorkerKey"
    # O CRM mostra "instalando" até o robô em si abrir e se apresentar com a versão real.
    $request.Headers['X-Servopa-Worker-Version'] = 'instalando'
  }
  return $request
}

function Invoke-RoboApi([string]$Method, [string]$Url, [string]$WorkerKey, $Body) {
  $request = New-RoboRequest $Method $Url $WorkerKey
  $request.Accept = 'application/json'
  try {
    if ($null -ne $Body) {
      $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
      $request.ContentType = 'application/json'
      $request.ContentLength = $bytes.Length
      $stream = $request.GetRequestStream()
      try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Close() }
    }
    $response = $request.GetResponse()
  } catch {
    $webError = Get-RoboWebException $_
    if ($webError -and $webError.Response) { $response = $webError.Response }
    else { throw 'Não foi possível falar com o CRM. Confira a internet e tente de novo.' }
  }
  try {
    $reader = New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close()
    $data = $null
    if ($text) { try { $data = $text | ConvertFrom-Json } catch {} }
    return [pscustomobject]@{ Status = [int]$response.StatusCode; Data = $data }
  } finally { $response.Close() }
}

function Invoke-RoboDownload([string]$Url, [string]$Destination, [string]$WorkerKey, [scriptblock]$OnProgress) {
  $request = New-RoboRequest 'GET' $Url $WorkerKey
  try { $response = $request.GetResponse() }
  catch {
    $webError = Get-RoboWebException $_
    if ($webError -and $webError.Response) {
      $status = [int]$webError.Response.StatusCode
      $webError.Response.Close()
      throw "O servidor recusou o download (HTTP $status)."
    }
    throw 'Não foi possível baixar um componente. Confira a internet e tente de novo.'
  }
  $headers = @{}
  foreach ($name in $response.Headers.AllKeys) { $headers[$name] = $response.Headers[$name] }
  try {
    $total = $response.ContentLength
    $source = $response.GetResponseStream()
    $target = [IO.File]::Create($Destination)
    try {
      $buffer = New-Object byte[] 262144
      $done = [long]0
      $lastReport = [DateTime]::MinValue
      while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $target.Write($buffer, 0, $read)
        $done += $read
        if ($OnProgress -and ((Get-Date) - $lastReport).TotalMilliseconds -ge 300) {
          & $OnProgress $done $total
          $lastReport = Get-Date
        }
      }
      if ($total -gt 0 -and $done -ne $total) { throw 'O download foi interrompido. Confira a internet e tente de novo.' }
    } finally {
      $target.Close()
      $source.Close()
    }
  } finally { $response.Close() }
  return $headers
}

# ── Processos sem janela ──

function ConvertTo-RoboArgument([string]$Value) {
  if ($Value -and $Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Invoke-RoboProcess([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [hashtable]$Environment, $Paths, [int]$TimeoutSeconds = 1800) {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $FilePath
  $info.Arguments = (@($Arguments) | ForEach-Object { ConvertTo-RoboArgument $_ }) -join ' '
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  if ($WorkingDirectory) { $info.WorkingDirectory = $WorkingDirectory }
  if ($Environment) { foreach ($name in $Environment.Keys) { $info.EnvironmentVariables[$name] = [string]$Environment[$name] } }
  $process = [Diagnostics.Process]::Start($info)
  try {
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill() } catch {}
      Write-RoboLog $Paths "Tempo esgotado: $([IO.Path]::GetFileName($FilePath)) $($info.Arguments)"
      return -1
    }
    $process.WaitForExit()
    $output = ($stdout.Result + "`n" + $stderr.Result).Trim()
    if ($output.Length -gt 4000) { $output = $output.Substring($output.Length - 4000) }
    Write-RoboLog $Paths "$([IO.Path]::GetFileName($FilePath)) $($info.Arguments) -> $($process.ExitCode) $output"
    return $process.ExitCode
  } finally { $process.Dispose() }
}

function Expand-RoboZip([string]$ZipPath, [string]$Destination, $Paths) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path -LiteralPath $tar) {
    if ((Invoke-RoboProcess $tar @('-xf', $ZipPath, '-C', $Destination) $null $null $Paths 900) -eq 0) { return }
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
}

function Remove-RoboPath([string]$Path) {
  if ($Path -and (Test-Path -LiteralPath $Path)) { Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue }
}

# ── Componentes ──

function Get-RoboNodeExe($Paths) {
  return (Join-Path $Paths.RuntimeRoot ("node-{0}-win-x64\node.exe" -f $script:RoboNodeVersion))
}

function Install-RoboNode($Paths, [scriptblock]$OnProgress) {
  $nodeExe = Get-RoboNodeExe $Paths
  if (Test-Path -LiteralPath $nodeExe) { return $nodeExe }
  New-Item -ItemType Directory -Force -Path $Paths.RuntimeRoot | Out-Null
  $name = "node-$($script:RoboNodeVersion)-win-x64"
  $zip = Join-Path $Paths.RuntimeRoot "$name.zip.download"
  $staging = Join-Path $Paths.RuntimeRoot ('s-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  try {
    Invoke-RoboDownload "https://nodejs.org/dist/$($script:RoboNodeVersion)/$name.zip" $zip $null $OnProgress | Out-Null
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $script:RoboNodeSha256) { throw 'O Node.js baixado não confere com o original. Tente de novo.' }
    Expand-RoboZip $zip $staging $Paths
    Move-Item -LiteralPath (Join-Path $staging $name) -Destination (Join-Path $Paths.RuntimeRoot $name)
  } finally {
    Remove-RoboPath $zip
    Remove-RoboPath $staging
  }
  if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'O Node.js não foi instalado corretamente.' }
  Get-ChildItem -LiteralPath $Paths.RuntimeRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'node-v*' -and $_.Name -ne $name } |
    ForEach-Object { Remove-RoboPath $_.FullName }
  return $nodeExe
}

function Get-RoboCurrentApp($Paths) {
  if (-not (Test-Path -LiteralPath $Paths.CurrentFile)) { return $null }
  $folder = ([IO.File]::ReadAllText($Paths.CurrentFile)).Trim()
  if ($folder -notmatch '^[0-9A-Za-z._-]+$') { return $null }
  $dir = Join-Path $Paths.AppRoot $folder
  $manifestFile = Join-Path $dir 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestFile) -or -not (Test-Path -LiteralPath (Join-Path $dir 'run.mjs'))) { return $null }
  $manifest = [IO.File]::ReadAllText($manifestFile) | ConvertFrom-Json
  return [pscustomobject]@{ Version = [string]$manifest.version; Dir = $dir; Folder = $folder }
}

function Install-RoboApp($Paths, $Config) {
  New-Item -ItemType Directory -Force -Path $Paths.AppRoot | Out-Null
  $zip = Join-Path $Paths.AppRoot ('download-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.zip')
  $staging = Join-Path $Paths.AppRoot ('s-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  try {
    $headers = Invoke-RoboDownload "$($Config.CrmBaseUrl)/api/servopa-worker/bundle" $zip $Config.WorkerKey $null
    $version = [string]$headers['X-Servopa-App-Version']
    $expectedHash = [string]$headers['X-Servopa-Bundle-Sha256']
    if ($version -notmatch '^[0-9A-Za-z.+_-]{1,50}$') { throw 'O CRM não informou a versão do robô.' }
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $expectedHash -or $hash -ne $expectedHash.ToLowerInvariant()) { throw 'O pacote do robô veio corrompido. Tente de novo.' }
    $folder = $version -replace '[^0-9A-Za-z._-]', '_'
    $dir = Join-Path $Paths.AppRoot $folder
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'manifest.json'))) {
      Remove-RoboPath $dir
      Expand-RoboZip $zip $staging $Paths
      $manifest = [IO.File]::ReadAllText((Join-Path $staging 'manifest.json')) | ConvertFrom-Json
      if ([string]$manifest.version -ne $version) { throw 'O pacote do robô não confere com a versão informada.' }
      Move-Item -LiteralPath $staging -Destination $dir
    }
    return [pscustomobject]@{ Version = $version; Dir = $dir; Folder = $folder }
  } finally {
    Remove-RoboPath $zip
    Remove-RoboPath $staging
  }
}

function Install-RoboDependencies($Paths, [string]$AppDir, [string]$NodeExe) {
  if (Test-Path -LiteralPath (Join-Path $AppDir 'node_modules\playwright-core\package.json')) { return }
  $nodeDir = Split-Path -Parent $NodeExe
  $npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
  $environment = @{
    PATH = "$nodeDir;$env:PATH"
    npm_config_update_notifier = 'false'
    npm_config_fund = 'false'
    npm_config_audit = 'false'
  }
  $code = Invoke-RoboProcess $NodeExe @($npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error') $AppDir $environment $Paths 1200
  if ($code -ne 0) {
    Remove-RoboPath (Join-Path $AppDir 'node_modules')
    throw 'Não foi possível baixar os componentes do robô. Confira a internet e tente de novo.'
  }
}

function Install-RoboBrowser($Paths, [string]$AppDir, [string]$NodeExe) {
  $cli = Join-Path $AppDir 'node_modules\playwright-core\cli.js'
  $code = Invoke-RoboProcess $NodeExe @($cli, 'install', 'firefox') $AppDir @{ PLAYWRIGHT_BROWSERS_PATH = $Paths.Browsers } $Paths 2400
  if ($code -ne 0) { throw 'Não foi possível baixar o navegador do robô. Confira a internet e tente de novo.' }
}

<#
  Abre o Firefox do robô de verdade (mesmo caminho da coleta, com os consertos
  automáticos) e carrega a página de login da Servopa, sem entrar. Devolve
  'ok', 'site' (Firefox abriu, Servopa não carregou agora) ou lança erro.
  O robô precisa estar fechado (o perfil do Firefox é um só).
#>
function Test-RoboBrowser($Paths, $App) {
  $nodeExe = Get-RoboNodeExe $Paths
  $environment = @{ SERVOPA_DATA_DIR = $Paths.Home; PLAYWRIGHT_BROWSERS_PATH = $Paths.Browsers }
  $code = Invoke-RoboProcess $nodeExe @((Join-Path $App.Dir 'check-browser.mjs')) $App.Dir $environment $Paths 1500
  # Códigos de check-browser.mjs: 0 = tudo certo; 2 = Firefox abriu, Servopa não carregou; outro = Firefox não abriu.
  if ($code -eq 2) { return 'site' }
  if ($code -ne 0) {
    throw "O navegador do robô não abriu neste computador, mesmo depois de reinstalado. Se houver antivírus, libere a pasta $($Paths.Home) e clique em Tentar de novo."
  }
  return 'ok'
}

function Set-RoboCurrentApp($Paths, $App) {
  $temporary = "$($Paths.CurrentFile).tmp"
  [IO.File]::WriteAllText($temporary, $App.Folder, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $Paths.CurrentFile -Force
}

function Remove-RoboOldVersions($Paths, $App) {
  # Mantém a versão atual e a anterior (volta rápida se algo der errado).
  Get-ChildItem -LiteralPath $Paths.AppRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne $App.Folder } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 1 |
    ForEach-Object { Remove-RoboPath $_.FullName }
}

# ── Integração com o Windows (sem administrador) ──

function Get-RoboHiddenCommand([string]$Script, [string]$Extra) {
  $command = '"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}"' -f $script:RoboPowerShell, $Script
  if ($Extra) { $command += " $Extra" }
  return $command
}

function Get-RoboShortcutFolder($Paths) {
  if ($script:RoboTestRegistry) { return $Paths.Home }
  return [Environment]::GetFolderPath('Programs')
}

# Cria só os níveis que faltam. Nunca `New-Item -Force` numa chave que já existe:
# no registro isso apaga os valores dela (por exemplo, os outros programas de
# inicialização do usuário em ...\Run).
function New-RoboRegistryKey([string]$Path) {
  if (Test-Path -LiteralPath $Path) { return }
  New-RoboRegistryKey (Split-Path -Parent $Path)
  New-Item -Path $Path | Out-Null
}

function Register-RoboShell($Paths, $App) {
  Copy-Item -LiteralPath (Join-Path $App.Dir 'windows\robo-servopa.ps1') -Destination $Paths.Stub -Force
  Copy-Item -LiteralPath (Join-Path $App.Dir 'windows\desinstalar.ps1') -Destination $Paths.Uninstaller -Force

  # Abre sozinho quando o usuário entra no Windows (aparece em Gerenciador de Tarefas > Aplicativos de inicialização).
  New-RoboRegistryKey $script:RoboRunKey
  Set-ItemProperty -LiteralPath $script:RoboRunKey -Name $script:RoboRunValue -Value (Get-RoboHiddenCommand $Paths.Stub $null)

  # Aparece em Configurações > Aplicativos instalados, com "Desinstalar".
  New-RoboRegistryKey $script:RoboUninstallKey
  $values = @{
    DisplayName = 'Robô Servopa (Reobote)'
    DisplayVersion = $App.Version
    Publisher = 'Reobote Consórcios'
    InstallLocation = $Paths.Home
    UninstallString = Get-RoboHiddenCommand $Paths.Uninstaller $null
    QuietUninstallString = Get-RoboHiddenCommand $Paths.Uninstaller '-Quiet'
  }
  foreach ($name in $values.Keys) { Set-ItemProperty -Path $script:RoboUninstallKey -Name $name -Value $values[$name] }
  foreach ($name in @('NoModify', 'NoRepair')) { Set-ItemProperty -Path $script:RoboUninstallKey -Name $name -Value 1 -Type DWord }
  Set-ItemProperty -Path $script:RoboUninstallKey -Name 'EstimatedSize' -Value 350000 -Type DWord

  # Atalho no menu Iniciar: reabre o robô (ou mostra o estado, se já estiver aberto).
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path (Get-RoboShortcutFolder $Paths) 'Robô Servopa.lnk'))
    $shortcut.TargetPath = $script:RoboPowerShell
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Show' -f $Paths.Stub
    $shortcut.WorkingDirectory = $Paths.Home
    $shortcut.Description = 'Robô que atualiza as tabelas da Servopa no CRM Reobote'
    $shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
    $shortcut.Save()
  } catch {
    Write-RoboLog $Paths "Atalho do menu Iniciar não criado: $($_.Exception.Message)"
  }
}

function Test-RoboLauncherRunning {
  $mutex = $null
  if ([Threading.Mutex]::TryOpenExisting($script:RoboMutexName, [ref]$mutex)) {
    $mutex.Dispose()
    return $true
  }
  return $false
}

function Stop-RoboLeftovers($Paths) {
  # Processos do robô que ficaram para trás (Node e Firefox desta instalação).
  Get-Process -Name node, firefox -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($Paths.Home, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { try { $_.Kill() } catch {} }
}

function Stop-RoboLauncher($Paths, [int]$TimeoutSeconds = 20) {
  if (Test-RoboLauncherRunning) {
    [IO.File]::WriteAllText($Paths.StopFile, '1')
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Test-RoboLauncherRunning) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  }
  Remove-RoboPath $Paths.StopFile
  Stop-RoboLeftovers $Paths
}

function Start-RoboLauncher($Paths) {
  Remove-RoboPath $Paths.StopFile
  Remove-RoboPath $Paths.Revoked
  Start-Process -FilePath $script:RoboPowerShell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"{0}"' -f $Paths.Stub)) -WindowStyle Hidden
}

<#
  Instala ou atualiza tudo: Node.js portátil, código do robô, componentes e
  Firefox. Idempotente: o que já está certo é reaproveitado. Usado pelo
  instalador (com progresso na tela) e pelo iniciador (atualização automática).
  $OnStep recebe (texto, percentual, detalhe).
#>
function Update-RoboInstallation($Paths, $Config, [scriptblock]$OnStep) {
  if (-not $OnStep) { $OnStep = { param($text, $percent, $detail) } }
  & $OnStep 'Preparando o Node.js' 15 ''
  $nodeExe = Install-RoboNode $Paths {
    param($done, $total)
    $detail = if ($total -gt 0) { '{0:N0} de {1:N0} MB' -f ($done / 1MB), ($total / 1MB) } else { '{0:N0} MB' -f ($done / 1MB) }
    $percent = if ($total -gt 0) { 15 + [int](20 * $done / $total) } else { 20 }
    & $OnStep 'Baixando o Node.js' $percent $detail
  }
  & $OnStep 'Baixando o robô do CRM' 38 ''
  $app = Install-RoboApp $Paths $Config
  & $OnStep 'Baixando os componentes do robô' 45 ''
  Install-RoboDependencies $Paths $app.Dir $nodeExe
  & $OnStep 'Baixando o navegador (cerca de 90 MB, pode levar alguns minutos)' 55 ''
  Install-RoboBrowser $Paths $app.Dir $nodeExe
  & $OnStep 'Configurando o Windows' 85 ''
  Set-RoboCurrentApp $Paths $app
  Register-RoboShell $Paths $app
  Remove-RoboOldVersions $Paths $app
  Write-RoboLog $Paths "Instalação atualizada para a versão $($app.Version)."
  return $app
}
