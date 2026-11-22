param(
  [ValidateSet('Install', 'Uninstall')][string]$Mode = 'Install',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
)
$ErrorActionPreference = 'Stop'
$candidates = @()
$cmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
if ($cmd) { $candidates += $cmd.Source }
$appData = [Environment]::GetFolderPath('ApplicationData')
$candidates += (Join-Path $appData 'Antigravity/bin/agy-node.cmd')
$runtime = $null
foreach ($candidate in $candidates) {
  if (-not (Test-Path -LiteralPath $candidate)) { continue }
  $ok = & $candidate -p "Number(process.versions.node.split('.')[0])>22||(Number(process.versions.node.split('.')[0])===22&&Number(process.versions.node.split('.')[1])>=13)" 2>$null
  if ($LASTEXITCODE -eq 0 -and "$ok".Trim() -eq 'true') { $runtime = $candidate; break }
}
if (-not $runtime) {
  throw '未找到可用的 Node.js。请安装 Node.js 22.13 或更高版本，或先启动 Antigravity。'
}
$script = if ($Mode -eq 'Uninstall') { 'scripts/uninstall.mjs' } else { 'scripts/install.mjs' }
& $runtime (Join-Path $PSScriptRoot $script) @Arguments
exit $LASTEXITCODE
