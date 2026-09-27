#!/bin/bash
# Double-click (macOS) to start the gallery admin (opens in your browser).
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js neni nainstalovany. Stahni ho z https://nodejs.org"
  read -r -p "Stiskni Enter pro zavreni..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Prvni spusteni: instaluji zavislosti..."
  if ! npm install; then
    echo
    echo "Instalace selhala."
    read -r -p "Stiskni Enter pro zavreni..."
    exit 1
  fi
fi
npm run admin
