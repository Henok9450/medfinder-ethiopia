Add-Type -AssemblyName System.Drawing

function Generate-PwaIcon($outputPath, $size, $bgColorHex, $crossColorHex) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Background fill
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($bgColorHex))
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # Rounded rectangle inner container
    $margin = [int]($size * 0.10)
    $innerSize = $size - (2 * $margin)
    $radius = [int]($innerSize * 0.20)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($margin, $margin, $d, $d, 180, 90)
    $path.AddArc($margin + $innerSize - $d, $margin, $d, $d, 270, 90)
    $path.AddArc($margin + $innerSize - $d, $margin + $innerSize - $d, $d, $d, 0, 90)
    $path.AddArc($margin, $margin + $innerSize - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $innerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45, 255, 255, 255))
    $g.FillPath($innerBrush, $path)

    # Medical Cross in center
    $crossBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($crossColorHex))
    $armWidth = [int]($size * 0.18)
    $armLength = [int]($size * 0.54)
    $center = [int]($size / 2)

    # Vertical bar
    $vX = $center - [int]($armWidth / 2)
    $vY = $center - [int]($armLength / 2)
    $g.FillRectangle($crossBrush, $vX, $vY, $armWidth, $armLength)

    # Horizontal bar
    $hX = $center - [int]($armLength / 2)
    $hY = $center - [int]($armWidth / 2)
    $g.FillRectangle($crossBrush, $hX, $hY, $armLength, $armWidth)

    # Center circle accent
    $circleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($bgColorHex))
    $circleRadius = [int]($armWidth * 0.40)
    $g.FillEllipse($circleBrush, $center - $circleRadius, $center - $circleRadius, $circleRadius * 2, $circleRadius * 2)

    # Save PNG
    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated: $outputPath ($size x $size)"
}

# 1. Global Assets
Generate-PwaIcon "public/assets/icon-192.png" 192 "#047857" "#ffffff"
Generate-PwaIcon "public/assets/icon-512.png" 512 "#047857" "#ffffff"
Generate-PwaIcon "public/assets/icon-maskable-192.png" 192 "#047857" "#ffffff"
Generate-PwaIcon "public/assets/icon-maskable-512.png" 512 "#047857" "#ffffff"

# 2. Pharmacy Studio Brand Icons (Emerald #059669)
Generate-PwaIcon "public/pharmacy/icon-192.png" 192 "#059669" "#ffffff"
Generate-PwaIcon "public/pharmacy/icon-512.png" 512 "#059669" "#ffffff"
Generate-PwaIcon "public/pharmacy/icon-maskable-192.png" 192 "#059669" "#ffffff"
Generate-PwaIcon "public/pharmacy/icon-maskable-512.png" 512 "#059669" "#ffffff"

# 3. Wholesaler Studio Brand Icons (Indigo #4f46e5)
Generate-PwaIcon "public/wholesaler/icon-192.png" 192 "#4f46e5" "#ffffff"
Generate-PwaIcon "public/wholesaler/icon-512.png" 512 "#4f46e5" "#ffffff"
Generate-PwaIcon "public/wholesaler/icon-maskable-192.png" 192 "#4f46e5" "#ffffff"
Generate-PwaIcon "public/wholesaler/icon-maskable-512.png" 512 "#4f46e5" "#ffffff"

# 4. Patient Finder App Icons (Teal-Emerald #047857)
Generate-PwaIcon "public/find/icon-192.png" 192 "#047857" "#ffffff"
Generate-PwaIcon "public/find/icon-512.png" 512 "#047857" "#ffffff"
Generate-PwaIcon "public/find/icon-maskable-192.png" 192 "#047857" "#ffffff"
Generate-PwaIcon "public/find/icon-maskable-512.png" 512 "#047857" "#ffffff"
