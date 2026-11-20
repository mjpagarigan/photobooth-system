# Grace Booth print helper.
# Long-lived child process. Reads one JSON request per line on stdin and writes one JSON
# response per line on stdout: { id, ok, data } or { id, ok: false, code, message }.
# Uses only what ships with Windows: .NET System.Drawing.Printing and the spooler's CIM classes.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing

$JOB_PAUSED = 0x1
$JOB_ERROR = 0x2
$JOB_OFFLINE = 0x20
$JOB_PAPEROUT = 0x40
$JOB_PRINTED = 0x80
$JOB_USER_INTERVENTION = 0x400

function Send($payload) {
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

function Fail([string]$code, [string]$message) {
  throw [System.Exception]::new("$code|$message")
}

function Get-QueuePrinter([string]$name) {
  $printer = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $name } | Select-Object -First 1
  if (-not $printer) { Fail 'printer_missing' "Printer '$name' is not installed." }
  return $printer
}

function Get-Settings([string]$name) {
  $settings = New-Object System.Drawing.Printing.PrinterSettings
  $settings.PrinterName = $name
  if (-not $settings.IsValid) { Fail 'printer_missing' "Printer '$name' is not installed." }
  return $settings
}

function Find-4rPaper($settings, $rawKind, [string]$paperName) {
  $papers = @($settings.PaperSizes)
  if ($null -ne $rawKind) {
    $match = $papers | Where-Object { $_.RawKind -eq [int]$rawKind } | Select-Object -First 1
    if ($match) { return $match }
  }
  if ($paperName) {
    $match = $papers | Where-Object { $_.PaperName -eq $paperName } | Select-Object -First 1
    if ($match) { return $match }
  }
  $match = $papers | Where-Object {
    $short = [Math]::Min($_.Width, $_.Height); $long = [Math]::Max($_.Width, $_.Height)
    [Math]::Abs($short - 400) -le 2 -and [Math]::Abs($long - 600) -le 2
  } | Sort-Object { if ($_.PaperName -match 'borderless') { 1 } else { 0 } } | Select-Object -First 1
  return $match
}

function Op-List {
  $default = (Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1).Name
  @(Get-CimInstance -ClassName Win32_Printer | ForEach-Object {
    [ordered]@{
      name = [string]$_.Name
      driverName = [string]$_.DriverName
      portName = [string]$_.PortName
      isNetwork = [bool]($_.Network -or ([string]$_.PortName) -match '^(IP_|WSD|https?:|\\\\)')
      isDefault = [bool]($_.Name -eq $default)
    }
  })
}

function Op-Capabilities($request) {
  $settings = Get-Settings $request.printerName
  $papers = @($settings.PaperSizes | ForEach-Object {
    [ordered]@{ rawKind = [int]$_.RawKind; name = [string]$_.PaperName; widthHundredths = [int]$_.Width; heightHundredths = [int]$_.Height }
  })
  $margins = $null
  $paper = Find-4rPaper $settings $null $null
  if ($paper) {
    $page = New-Object System.Drawing.Printing.PageSettings $settings
    $page.PaperSize = $paper
    $page.Landscape = $false
    $area = $page.PrintableArea
    $margins = [ordered]@{
      left = [double]$area.X
      top = [double]$area.Y
      right = [double]([Math]::Max(0, $paper.Width - $area.X - $area.Width))
      bottom = [double]([Math]::Max(0, $paper.Height - $area.Y - $area.Height))
    }
  }
  $dpi = $null
  foreach ($resolution in $settings.PrinterResolutions) {
    if ($resolution.X -gt 0 -and ($null -eq $dpi -or $resolution.X -gt $dpi)) { $dpi = [int]$resolution.X }
  }
  [ordered]@{ printerName = [string]$request.printerName; paperCandidates = $papers; margins = $margins; dpi = $dpi }
}

function Op-Status($request) {
  $printer = Get-QueuePrinter $request.printerName
  $status = 'ready'; $message = 'Printer is ready.'
  # Win32_Printer.PrinterStatus: 1 Other, 2 Unknown, 3 Idle, 4 Printing, 5 Warmup,
  # 6 Stopped printing, 7 Offline. DetectedErrorState: 0 Unknown, 1 Other, 2 No error,
  # 3 Low paper, 4 No paper, 5 Low toner, 6 No toner, 7 Door open, 8 Jammed, 9 Offline,
  # 10 Service requested, 11 Output bin full.
  $printerStatus = [int]$printer.PrinterStatus
  $errorState = [int]$printer.DetectedErrorState
  if ($printer.WorkOffline -or $printerStatus -eq 7 -or $errorState -eq 9) {
    $status = 'offline'; $message = 'Printer is offline or disconnected.'
  } elseif ($errorState -eq 4) {
    $status = 'paper_out'; $message = 'Printer is out of paper.'
  } elseif (@(6, 7, 8, 10, 11) -contains $errorState) {
    $status = 'error'; $message = 'Printer needs attention (door, jam, ink or service).'
  } elseif ($errorState -eq 1 -or $printerStatus -eq 1 -or $printerStatus -eq 6) {
    # Generic class drivers (e.g. Epson ESC/P-R on an L805) report paper-out and jams only as
    # "Other". Seen on a real L805 on 2026-11-13: PrinterStatus 1, DetectedErrorState 1.
    $status = 'error'; $message = 'Printer reports an error. Check its lights or screen for paper, a jam or ink.'
  } elseif ($printerStatus -eq 4) {
    $status = 'printing'; $message = 'Printer is printing.'
  }
  [ordered]@{ status = $status; message = $message }
}

function Find-SpoolerJob([string]$printerName, [string]$documentKey) {
  Get-CimInstance -ClassName Win32_PrintJob |
    Where-Object { $_.Document -eq $documentKey -and ([string]$_.Name).StartsWith("$printerName,") } |
    Select-Object -First 1
}

function Op-FindJob($request) {
  $job = Find-SpoolerJob $request.printerName $request.documentKey
  if (-not $job) { return [ordered]@{ found = $false } }
  $mask = [int]$job.StatusMask
  $problem = $null
  if ($mask -band $JOB_PAPEROUT) { $problem = 'paper_out' }
  elseif ($mask -band $JOB_OFFLINE) { $problem = 'offline' }
  elseif ($mask -band ($JOB_ERROR -bor $JOB_USER_INTERVENTION)) { $problem = 'error' }
  [ordered]@{
    found = $true
    spoolerJobId = [int]$job.JobId
    printed = [bool]($mask -band $JOB_PRINTED)
    problem = $problem
    statusText = [string]$job.JobStatus
  }
}

function Op-Submit($request) {
  # Everything before Print() is validation: a failure here provably never reached the spooler.
  $settings = Get-Settings $request.printerName
  $paper = Find-4rPaper $settings $request.paperRawKind $request.paperName
  if (-not $paper) { Fail 'paper_missing' 'The printer has no 4 x 6 in paper size.' }
  if (-not (Test-Path -LiteralPath $request.imagePath)) { Fail 'print_image_missing' 'The print image is missing.' }
  $image = [System.Drawing.Image]::FromFile($request.imagePath, $false)
  try {
    $document = New-Object System.Drawing.Printing.PrintDocument
    $document.PrinterSettings = $settings
    $document.PrinterSettings.Copies = 1
    if ($request.outputFile) {
      # Self-test only: lets file-port printers (Microsoft Print to PDF) run without a dialog.
      $document.PrinterSettings.PrintToFile = $true
      $document.PrinterSettings.PrintFileName = [string]$request.outputFile
    }
    $document.DocumentName = [string]$request.documentKey
    $document.DefaultPageSettings.PaperSize = $paper
    $document.DefaultPageSettings.Landscape = $true
    $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins 0, 0, 0, 0
    $document.OriginAtMargins = $false
    $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
    $document.add_PrintPage({
      param($s, $e)
      $graphics = $e.Graphics
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $bounds = $e.PageBounds
      # The graphics origin sits at the hard margin; offset so the full-page bitmap lines up
      # with the physical paper edge.
      $target = New-Object System.Drawing.RectangleF (-$e.PageSettings.HardMarginX), (-$e.PageSettings.HardMarginY), $bounds.Width, $bounds.Height
      $graphics.DrawImage($image, $target)
      $e.HasMorePages = $false
    })
    try {
      $document.Print()
    } catch {
      Fail 'submit_unknown' ("The spooler reported an error while printing: " + $_.Exception.Message)
    }
  } finally {
    $image.Dispose()
  }
  $job = Find-SpoolerJob $request.printerName $request.documentKey
  [ordered]@{ spoolerJobId = if ($job) { [int]$job.JobId } else { $null } }
}

function Op-Cancel($request) {
  $job = Find-SpoolerJob $request.printerName $request.documentKey
  if ($job) { Remove-PrintJob -PrinterName $request.printerName -ID ([int]$job.JobId) }
  [ordered]@{}
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $id = $null
  try {
    $request = $line | ConvertFrom-Json
    $id = $request.id
    $data = switch ($request.op) {
      'list' { Op-List }
      'capabilities' { Op-Capabilities $request }
      'status' { Op-Status $request }
      'findJob' { Op-FindJob $request }
      'submit' { Op-Submit $request }
      'cancel' { Op-Cancel $request }
      'ping' { [ordered]@{ pong = $true } }
      default { Fail 'unknown_op' "Unknown operation." }
    }
    Send ([ordered]@{ id = $id; ok = $true; data = $data })
  } catch {
    $text = [string]$_.Exception.Message
    $code = 'helper_error'; $message = $text
    $separator = $text.IndexOf('|')
    if ($separator -gt 0) { $code = $text.Substring(0, $separator); $message = $text.Substring($separator + 1) }
    Send ([ordered]@{ id = $id; ok = $false; code = $code; message = $message })
  }
}
