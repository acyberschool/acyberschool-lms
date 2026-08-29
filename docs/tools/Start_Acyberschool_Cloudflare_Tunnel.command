#!/bin/zsh
set -u
clear
echo "ACYBERSCHOOL LMS — START CLOUDFLARE TUNNEL"
echo "This publishes the existing localhost:8080 LMS."
echo "Paste the Cloudflare Tunnel token (the long eyJ... value). Nothing will appear."
read -s "TOKEN?Tunnel token: "; echo
if [[ -z "$TOKEN" ]]; then echo "STOP: No token entered."; read "?Press Return..."; exit 1; fi
if ! docker info >/dev/null 2>&1; then echo "STOP: Start Docker Desktop first."; TOKEN=""; read "?Press Return..."; exit 1; fi
docker rm -f acyberschool-tunnel >/dev/null 2>&1 || true
docker pull cloudflare/cloudflared:latest >/dev/null || exit 1
docker run -d --name acyberschool-tunnel --restart unless-stopped cloudflare/cloudflared:latest tunnel --no-autoupdate run --token "$TOKEN" >/dev/null || exit 1
TOKEN=""
sleep 5
echo "Cloudflare Tunnel connector is running."
echo
echo "In Cloudflare, finish the tunnel route with:"
echo "  Public hostname: classroom.acyberschool.com"
echo "  Service URL:     http://host.docker.internal:8080"
echo
echo "Use Routes > Add route > Published application."
echo "Cloudflare creates the DNS record automatically."
read "?Press Return to close..."
