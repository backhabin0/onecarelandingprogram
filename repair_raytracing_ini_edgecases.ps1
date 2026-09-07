$ErrorActionPreference = 'Stop'

$restoreTargets = @(
    'C:\Users\kgb04\Documents\Unreal Projects\내프로젝트 5.4\Config\DefaultEngine.ini',
    'C:\Users\kgb04\Documents\Unreal Projects\내프로젝트\Config\DefaultEngine.ini'
)

foreach ($target in $restoreTargets) {
    $backup = Get-ChildItem -LiteralPath (Split-Path -Parent $target) -File -Filter 'DefaultEngine.ini.codex-backup-*' |
        Sort-Object Name |
        Select-Object -First 1
    if (-not $backup) { throw "Original backup not found for $target" }
    $attrs = [System.IO.File]::GetAttributes($target)
    if (($attrs -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {
        [System.IO.File]::SetAttributes($target, ($attrs -band (-bnot [System.IO.FileAttributes]::ReadOnly)))
    }
    Copy-Item -LiteralPath $backup.FullName -Destination $target -Force
}

$targets = @(
    'C:\Users\kgb04\Documents\Unreal Projects\내프로젝트 5.4\Config\DefaultEngine.ini',
    'C:\Users\kgb04\Documents\Unreal Projects\내프로젝트\Config\DefaultEngine.ini',
    "D:\1.Unreal Project's\P427\Config\DefaultEngine.ini",
    "D:\1.Unreal Project's\PhotorealisticLandscapePa\Config\DefaultEngine.ini",
    "D:\1.Unreal Project's\UnifiedSplineMovement\Config\DefaultEngine.ini"
)

foreach ($path in $targets) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $encoding = $null
    $preambleLength = 0
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
        $encoding = [System.Text.UnicodeEncoding]::new($false, $true)
        $preambleLength = 2
    }
    elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) {
        $encoding = [System.Text.UnicodeEncoding]::new($true, $true)
        $preambleLength = 2
    }
    elseif ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $encoding = [System.Text.UTF8Encoding]::new($true)
        $preambleLength = 3
    }
    else {
        $encoding = [System.Text.UTF8Encoding]::new($false)
    }

    $text = $encoding.GetString($bytes, $preambleLength, $bytes.Length - $preambleLength)
    $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $header = '[/Script/Engine.RendererSettings]'
    $headerIndex = $text.IndexOf($header, [System.StringComparison]::OrdinalIgnoreCase)
    if ($headerIndex -lt 0) {
        if ($text.Length -gt 0 -and -not $text.EndsWith($newline)) { $text += $newline }
        $text += $newline + $header + $newline
    }
    else {
        $text = [regex]::Replace($text, '(?mi)^\s*\[/Script/Engine\.RendererSettings\]\s*', $header + $newline, 1)
    }

    foreach ($pair in @(
        @('r.RayTracing', 'False'),
        @('r.RayTracing.RayTracingProxies.ProjectEnabled', 'False'),
        @('r.RayTracing.EnableOnDemand', 'False')
    )) {
        $key = $pair[0]
        $value = $pair[1]
        $pattern = '(?mi)^\s*' + [regex]::Escape($key) + '\s*=.*$'
        if ([regex]::IsMatch($text, $pattern)) {
            $text = [regex]::Replace($text, $pattern, "$key=$value")
        }
        else {
            $insertAt = $text.IndexOf($header, [System.StringComparison]::OrdinalIgnoreCase) + $header.Length
            $text = $text.Insert($insertAt, $newline + "$key=$value")
        }
    }

    $attrs = [System.IO.File]::GetAttributes($path)
    $wasReadOnly = ($attrs -band [System.IO.FileAttributes]::ReadOnly) -ne 0
    try {
        if ($wasReadOnly) { [System.IO.File]::SetAttributes($path, ($attrs -band (-bnot [System.IO.FileAttributes]::ReadOnly))) }
        [System.IO.File]::WriteAllText($path, $text, $encoding)
    }
    finally {
        if ($wasReadOnly) { [System.IO.File]::SetAttributes($path, $attrs) }
    }
    "REPAIRED`t$path"
}
