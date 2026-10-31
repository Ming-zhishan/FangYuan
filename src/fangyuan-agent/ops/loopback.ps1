function Test-LocalTcpPort([int]$Port) {
 $client=New-Object System.Net.Sockets.TcpClient
 try {
  $connection=$client.ConnectAsync('127.0.0.1',$Port)
  return ($connection.Wait(700) -and $client.Connected)
 } catch { return $false } finally { $client.Dispose() }
}
