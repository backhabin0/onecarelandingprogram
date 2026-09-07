$ErrorActionPreference = 'Continue'
$logPath = Join-Path $PSScriptRoot 'system_repair_diagnostics.log'
Start-Transcript -LiteralPath $logPath -Force

Write-Output '=== DISM RESTOREHEALTH ==='
DISM.exe /Online /Cleanup-Image /RestoreHealth
Write-Output "DISM_EXIT=$LASTEXITCODE"

Write-Output '=== SFC SCANNOW ==='
sfc.exe /scannow
Write-Output "SFC_EXIT=$LASTEXITCODE"

Write-Output '=== CHKDSK ONLINE SCAN ==='
chkdsk.exe C: /scan
Write-Output "CHKDSK_EXIT=$LASTEXITCODE"

Write-Output '=== PROBLEM DEVICES ==='
pnputil.exe /enum-devices /problem

Write-Output '=== AMD PSP DEVICE ==='
pnputil.exe /enum-devices /instanceid 'PCI\VEN_1022&DEV_1649&SUBSYS_16491022&REV_00\4&16012499&0&0241' /drivers

Stop-Transcript
