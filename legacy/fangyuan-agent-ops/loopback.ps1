
if ($env:FANGYUAN_LEGACY_EXECUTION -ne '1') {
    throw 'Archived tool: read legacy/README.md and configure an isolated environment before enabling.'
}
function Test-LocalTcpPort([int]$Port) {
 $client=New-Object System.Net.Sockets.TcpClient
 try {
  $connection=$client.ConnectAsync('127.0.0.1',$Port)
  return ($connection.Wait(700) -and $client.Connected)
 } catch { return $false } finally { $client.Dispose() }
}
