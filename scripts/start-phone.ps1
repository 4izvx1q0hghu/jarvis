# Run JARVIS so a phone can use it. The PC stays the brain; the phone is only
# the screen, microphone and speaker.
#
#   npm.cmd run start:phone
#
# Two ways in, picked automatically:
#
#   Tailscale (iPhone, or anywhere) - when Tailscale is running on this PC,
#     `tailscale serve` gives the face a private https://<pc>.<tailnet>.ts.net
#     address that only your own devices can open. https is what lets Safari use
#     the microphone. The page reaches the bridge through Vite at /bridge, so
#     there is one secure origin and nothing for Safari to block as mixed.
#
#   Same Wi-Fi (Android Chrome) - otherwise the face listens on this PC's
#     network address over plain http, and Chrome needs a one-time flag to allow
#     the microphone there. Safari has no such flag, so this way cannot hear you
#     on an iPhone.
#
# Addresses are looked up on every start, because they can change.

$tailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
$dns = $null
if (Test-Path $tailscale) {
  try {
    $status = & $tailscale status --json | ConvertFrom-Json
    if ($status.BackendState -eq 'Running' -and $status.Self.DNSName) {
      $dns = $status.Self.DNSName.TrimEnd('.')
    }
  } catch {
    $dns = $null
  }
}

if ($dns) {
  $face = "https://$dns"
  $env:VITE_BRIDGE_URL = "wss://$dns/bridge"
  $env:JARVIS_ALLOWED_ORIGINS = $face

  # https://<dns> -> http://127.0.0.1:5173. If HTTPS is not yet enabled for your
  # tailnet, this prints a link to enable it; open it, then start again.
  & $tailscale serve --bg 5173
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  tailscale serve did not start. Fix what it says above, then run this again.'
    exit 1
  }

  Write-Host ''
  Write-Host "  Phone URL:  $face"
  Write-Host ''
  Write-Host '  On the iPhone: keep the Tailscale app connected, open the address above in'
  Write-Host '  Safari, tap INITIALISE and allow the microphone.'
  Write-Host ''
} else {
  $addrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
  $pick = $addrs | Where-Object { $_.InterfaceAlias -like 'Wi-Fi*' } | Select-Object -First 1
  if (-not $pick) { $pick = $addrs | Select-Object -First 1 }
  if (-not $pick) {
    Write-Host 'No network address found. Connect this PC to Wi-Fi first.'
    exit 1
  }
  $ip = $pick.IPAddress
  $face = "http://${ip}:5173"

  $env:JARVIS_LAN = '1'
  $env:VITE_BRIDGE_URL = "ws://${ip}:8787"
  $env:JARVIS_ALLOWED_ORIGINS = $face

  Write-Host ''
  Write-Host "  Phone URL:  $face"
  Write-Host ''
  Write-Host '  Tailscale is not running, so this is plain http on your Wi-Fi. That works'
  Write-Host '  for Android Chrome but an iPhone will never hear you; start Tailscale for that.'
  Write-Host ''
  Write-Host '  Android Chrome only lets a page use the microphone over plain http if you'
  Write-Host '  allow it once: open chrome://flags/#unsafely-treat-insecure-origin-as-secure'
  Write-Host "  on the phone, enter $face, set it to Enabled, and Relaunch."
  Write-Host ''
}

Set-Location (Split-Path -Parent $PSScriptRoot)
# A terminal opened before Node.js was installed does not have it on PATH yet.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
& $node scripts/start.mjs @args
