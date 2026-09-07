$ErrorActionPreference = 'Continue'
$logPath = Join-Path $PSScriptRoot 'system_file_disk_check.log'
Start-Transcript -LiteralPath $logPath -Force

Write-Output '=== SFC SCANNOW ==='
sfc.exe /scannow
Write-Output "SFC_EXIT=$LASTEXITCODE"

Write-Output '=== CHKDSK ONLINE SCAN ==='
chkdsk.exe C: /scan
Write-Output "CHKDSK_EXIT=$LASTEXITCODE"

Write-Output '=== PROBLEM DEVICES ==='
pnputil.exe /enum-devices /problem

Stop-Transcript
