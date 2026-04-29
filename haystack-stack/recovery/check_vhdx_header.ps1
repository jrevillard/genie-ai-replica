param([string]$Path)
$fs = [System.IO.File]::OpenRead($Path)
$buf = New-Object byte[] 16
$null = $fs.Read($buf, 0, 16)
$fs.Close()
"ASCII: " + [System.Text.Encoding]::ASCII.GetString($buf)
"HEX:   " + [BitConverter]::ToString($buf)
