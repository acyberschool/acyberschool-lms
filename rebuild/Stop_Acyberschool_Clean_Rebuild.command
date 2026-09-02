#!/bin/zsh
set -e

clear
printf '\nACYBERSCHOOL CLEAN LMS\n\n'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker command was not found."
  echo ""
  read "?Press Return to close..."
  exit 1
fi

echo "Stopping only the new clean Acyberschool classroom..."
echo "Your clean LMS database and uploaded files will be kept."
echo "The old Acyberschool LMS will not be changed."
echo ""

docker compose stop

echo ""
echo "The clean preview is stopped."
echo "Run Start_Acyberschool_Clean_Rebuild.command whenever you want to open it again."
echo ""
read "?Press Return to close..."
