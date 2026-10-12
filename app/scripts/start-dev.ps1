# Starts Metro for a physical phone on the same Wi-Fi.
# Detects this machine's current LAN IP and sets EXPO_PUBLIC_API_URL to it,
# so the dev client always reaches the backend even if the router assigns a new IP.
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
$ip = (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4).IPAddress
$env:EXPO_PUBLIC_API_URL = "http://${ip}:8787"
Write-Host "EXPO_PUBLIC_API_URL = $env:EXPO_PUBLIC_API_URL"
npx expo start --dev-client
