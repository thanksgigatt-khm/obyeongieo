# docs/icon/icon.png 로 홈 화면 아이콘과 링크 미리보기 그림을 만든다.
# 사용: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
# 규칙(인계 문서 4-1): 금색 둥근 테두리를 자르거나 확대하지 않는다.
#  - 일반 아이콘: 원본을 그대로 줄인다.
#  - maskable(안드로이드 원형 자르기): 원본을 줄여 가운데 두고 둘레를 원본 가장자리 남색으로 채운다.
#    원형 안전 영역(지름 80%) 안에 테두리 모서리까지 들어가도록 66%로 줄인다.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src = New-Object System.Drawing.Bitmap (Join-Path $root 'docs\icon\icon.png')

# 원본 가장자리 색 평균
$r = 0; $g = 0; $b = 0; $n = 0
for ($i = 0; $i -lt $src.Width; $i += 8) {
  foreach ($p in @(@($i, 1), @($i, ($src.Height - 2)), @(1, [Math]::Min($i, $src.Height - 1)), @(($src.Width - 2), [Math]::Min($i, $src.Height - 1)))) {
    $c = $src.GetPixel($p[0], $p[1]); $r += $c.R; $g += $c.G; $b += $c.B; $n++
  }
}
$edge = [System.Drawing.Color]::FromArgb(255, [int]($r / $n), [int]($g / $n), [int]($b / $n))
'edge color: #{0:X2}{1:X2}{2:X2}' -f $edge.R, $edge.G, $edge.B

function Save-Icon([int]$w, [int]$h, [double]$scale, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gr.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gr.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gr.Clear($edge)
  $s = [int]([Math]::Min($w, $h) * $scale)
  $gr.DrawImage($src, [int](($w - $s) / 2), [int](($h - $s) / 2), $s, $s)
  $gr.Dispose()
  $bmp.Save((Join-Path $root "icons\$name"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "made $name"
}

Save-Icon 180 180 1.0 'apple-touch-icon.png'
Save-Icon 192 192 1.0 'icon-192.png'
Save-Icon 512 512 1.0 'icon-512.png'
Save-Icon 192 192 0.66 'maskable-192.png'
Save-Icon 512 512 0.66 'maskable-512.png'
Save-Icon 32 32 1.0 'favicon-32.png'
Save-Icon 1200 630 0.86 'og.png'
$src.Dispose()
