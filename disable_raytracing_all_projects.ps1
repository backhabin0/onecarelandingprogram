$ErrorActionPreference = 'Stop'
$runLog = Join-Path $PSScriptRoot 'disable_raytracing_all_projects.log'
Start-Transcript -LiteralPath $runLog -Force

$scanRoots = @(
    'C:\Users\kgb04\Documents\Unreal Projects',
    "D:\1.Unreal Project's",
    'E:\training_194044 (2)',
    'F:\A'
)

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$projects = foreach ($root in $scanRoots) {
    if (Test-Path -LiteralPath $root) {
        Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.uproject' -ErrorAction SilentlyContinue
    }
}
$projects = @($projects | Sort-Object FullName -Unique)

function Set-RayTracingDisabled {
    param([Parameter(Mandatory)][string]$ProjectFile)

    $projectDir = Split-Path -Parent $ProjectFile
    $configDir = Join-Path $projectDir 'Config'
    $iniPath = Join-Path $configDir 'DefaultEngine.ini'

    if (-not (Test-Path -LiteralPath $configDir)) {
        New-Item -ItemType Directory -Path $configDir | Out-Null
    }

    $hadFile = Test-Path -LiteralPath $iniPath
    $hadBom = $false
    $newline = "`r`n"
    $text = ''
    if ($hadFile) {
        $bytes = [System.IO.File]::ReadAllBytes($iniPath)
        $hadBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
        if ($text -notmatch "`r`n" -and $text -match "`n") { $newline = "`n" }
    }

    $original = $text
    $header = '[/Script/Engine.RendererSettings]'
    $headerIndex = $text.IndexOf($header, [System.StringComparison]::OrdinalIgnoreCase)

    if ($headerIndex -lt 0) {
        if ($text.Length -gt 0 -and -not $text.EndsWith($newline)) { $text += $newline }
        $text += $newline + $header + $newline
        $text += 'r.RayTracing=False' + $newline
        $text += 'r.RayTracing.RayTracingProxies.ProjectEnabled=False' + $newline
        $text += 'r.RayTracing.EnableOnDemand=False' + $newline
    }
    else {
        $sectionStart = $headerIndex + $header.Length
        $nextSectionMatch = [regex]::Match($text.Substring($sectionStart), '(?m)^\s*\[[^\r\n]+\]\s*$')
        $sectionEnd = if ($nextSectionMatch.Success) { $sectionStart + $nextSectionMatch.Index } else { $text.Length }
        $before = $text.Substring(0, $sectionStart)
        $section = $text.Substring($sectionStart, $sectionEnd - $sectionStart)
        $after = $text.Substring($sectionEnd)

        $settings = [ordered]@{
            'r.RayTracing' = 'False'
            'r.RayTracing.RayTracingProxies.ProjectEnabled' = 'False'
            'r.RayTracing.EnableOnDemand' = 'False'
        }

        foreach ($key in $settings.Keys) {
            $pattern = '(?mi)^\s*' + [regex]::Escape($key) + '\s*=.*$'
            if ([regex]::IsMatch($section, $pattern)) {
                $section = [regex]::Replace($section, $pattern, "$key=$($settings[$key])")
            }
            else {
                if (-not $section.EndsWith($newline)) { $section += $newline }
                $section += "$key=$($settings[$key])" + $newline
            }
        }
        $text = $before + $section + $after
    }

    if ($text -ne $original) {
        if ($hadFile) { Copy-Item -LiteralPath $iniPath -Destination ($iniPath + '.codex-backup-' + $timestamp) }
        $encoding = [System.Text.UTF8Encoding]::new($hadBom)
        $originalAttributes = if ($hadFile) { [System.IO.File]::GetAttributes($iniPath) } else { [System.IO.FileAttributes]::Normal }
        try {
            if ($hadFile -and (($originalAttributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0)) {
                [System.IO.File]::SetAttributes($iniPath, ($originalAttributes -band (-bnot [System.IO.FileAttributes]::ReadOnly)))
            }
            [System.IO.File]::WriteAllText($iniPath, $text, $encoding)
        }
        finally {
            if ($hadFile -and (($originalAttributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) -and (Test-Path -LiteralPath $iniPath)) {
                [System.IO.File]::SetAttributes($iniPath, $originalAttributes)
            }
        }
        return "UPDATED`t$ProjectFile"
    }
    return "UNCHANGED`t$ProjectFile"
}

$results = foreach ($project in $projects) {
    try {
        Set-RayTracingDisabled -ProjectFile $project.FullName
    }
    catch {
        "FAILED`t$($project.FullName)`t$($_.Exception.Message)"
    }
}
$results
"PROJECT_COUNT=$($projects.Count)"
"UPDATED_COUNT=$(@($results | Where-Object { $_ -like 'UPDATED*' }).Count)"
"UNCHANGED_COUNT=$(@($results | Where-Object { $_ -like 'UNCHANGED*' }).Count)"
"FAILED_COUNT=$(@($results | Where-Object { $_ -like 'FAILED*' }).Count)"
Stop-Transcript
