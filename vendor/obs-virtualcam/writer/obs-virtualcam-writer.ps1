param(
  [int]$Width = 1280,
  [int]$Height = 720,
  [int]$Fps = 30,
  [ValidateSet("stdin", "test")]
  [string]$Mode = "stdin"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Core

$Width = [Math]::Max(2, $Width - ($Width % 2))
$Height = [Math]::Max(2, $Height - ($Height % 2))
$Fps = [Math]::Max(1, [Math]::Min(240, $Fps))

$name = "KairoMirrorVCamVid"
$headerSize = 80
$frameHeaderSize = 32
$frameSize = [int]($Width * $Height * 3 / 2)
$interval = [UInt64][Math]::Round(10000000 / $Fps)

function Align32([int]$value) {
  return ($value + 31) -band (-bnot 31)
}

$size = Align32 $headerSize
$offsets = New-Object int[] 3
for ($i = 0; $i -lt 3; $i++) {
  $offsets[$i] = $size
  $size = Align32 ($size + $frameHeaderSize + $frameSize)
}

$mmf = $null
$view = $null
$writeIndex = [UInt32]0

function Write-U32([int]$offset, [UInt32]$value) {
  $script:view.Write([Int64]$offset, $value)
}

function Write-U64([int]$offset, [UInt64]$value) {
  $script:view.Write([Int64]$offset, $value)
}

function Write-Bytes([int]$offset, [byte[]]$bytes) {
  [void]$script:view.WriteArray([Int64]$offset, $bytes, 0, $bytes.Length)
}

function Write-Header {
  Write-U32 0 0
  Write-U32 4 0
  Write-U32 8 1
  Write-U32 12 ([UInt32]$script:offsets[0])
  Write-U32 16 ([UInt32]$script:offsets[1])
  Write-U32 20 ([UInt32]$script:offsets[2])
  Write-U32 24 0
  Write-U32 28 ([UInt32]$script:Width)
  Write-U32 32 ([UInt32]$script:Height)
  Write-U64 40 ([UInt64]$script:interval)
}

function Write-Frame([byte[]]$frame) {
  $script:writeIndex = [UInt32]($script:writeIndex + 1)
  $slot = [int]($script:writeIndex % 3)
  $offset = $script:offsets[$slot]
  $timestamp = [UInt64](([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) * 10000)

  Write-U64 $offset $timestamp
  Write-Bytes ($offset + $script:frameHeaderSize) $frame
  Write-U32 0 $script:writeIndex
  Write-U32 4 $script:writeIndex
  Write-U32 8 2
}

function New-TestPattern([int]$tick) {
  $frame = New-Object byte[] $script:frameSize
  $uvOffset = $script:Width * $script:Height
  for ($y = 0; $y -lt $script:Height; $y++) {
    $row = $y * $script:Width
    for ($x = 0; $x -lt $script:Width; $x++) {
      $bar = [int](($x + $tick * 12) * 6 / $script:Width) % 6
      $luma = @(48, 88, 128, 168, 208, 232)[$bar]
      $frame[$row + $x] = [byte]$luma
    }
  }

  for ($y = 0; $y -lt ($script:Height / 2); $y++) {
    $row = $uvOffset + $y * $script:Width
    for ($x = 0; $x -lt $script:Width; $x += 2) {
      $bar = [int](($x + $tick * 12) * 6 / $script:Width) % 6
      $u = @(128, 90, 166, 54, 202, 128)[$bar]
      $v = @(128, 202, 90, 166, 54, 128)[$bar]
      $frame[$row + $x] = [byte]$u
      $frame[$row + $x + 1] = [byte]$v
    }
  }

  return $frame
}

try {
  $mmf = [System.IO.MemoryMappedFiles.MemoryMappedFile]::CreateNew($name, [Int64]$size, [System.IO.MemoryMappedFiles.MemoryMappedFileAccess]::ReadWrite)
  $view = $mmf.CreateViewAccessor(0, [Int64]$size, [System.IO.MemoryMappedFiles.MemoryMappedFileAccess]::ReadWrite)
  Write-Header
  Write-Output "READY $Width $Height $Fps"

  if ($Mode -eq "test") {
    $delay = [Math]::Max(1, [int](1000 / $Fps))
    $tick = 0
    while ($true) {
      Write-Frame (New-TestPattern $tick)
      $tick++
      Start-Sleep -Milliseconds $delay
    }
  }

  $stdin = [Console]::OpenStandardInput()
  while ($true) {
    $buffer = New-Object byte[] $frameSize
    $offset = 0
    while ($offset -lt $frameSize) {
      $read = $stdin.Read($buffer, $offset, $frameSize - $offset)
      if ($read -le 0) {
        return
      }
      $offset += $read
    }
    Write-Frame $buffer
  }
} catch {
  Write-Error $_
  exit 1
} finally {
  if ($view -ne $null) {
    try { Write-U32 8 3 } catch {}
    $view.Dispose()
  }
  if ($mmf -ne $null) {
    $mmf.Dispose()
  }
}
