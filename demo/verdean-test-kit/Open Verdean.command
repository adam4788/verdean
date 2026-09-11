#!/bin/zsh
set -euo pipefail

PROJECT="${VERDEAN_PROJECT_ROOT:-$HOME/Projects/verdean}"
KIT="${VERDEAN_TEST_KIT_DIR:-$HOME/Desktop/Verdean Test Kit}"
GUIDE="$KIT/START HERE - VERDEAN TEST GUIDE.html"
HOW_IT_WORKS="$KIT/HOW VERDEAN WORKS.html"
TEST_FOLDER="$KIT/01 - CONNECT THIS FOLDER"
OPTIONAL_FOLDER="$KIT/02 - OPTIONAL DROP-INS"
URL="http://localhost:3000"
APP_URL="$URL"
if [[ "${1:-}" == "--reset" ]]; then
  APP_URL="$URL/?reset=1"
fi
EXPECTED=(
  "01_supplier_quote.txt"
  "02_buyer_email.txt"
  "02a_supplier_invoice.txt"
  "03_call_transcript.txt"
  "04_signed_contract.txt"
)

alert() {
  osascript -e "display alert \"$1\" message \"$2\" as critical"
}

if [[ ! -f "$PROJECT/package.json" || ! -f "$GUIDE" || ! -f "$HOW_IT_WORKS" || ! -d "$TEST_FOLDER" ]]; then
  alert "Verdean Test Kit is incomplete" "Expected the project at $PROJECT and the prepared kit at $KIT. Run Reset Test Kit.command after restoring those folders."
  exit 1
fi

if [[ ! -x "$PROJECT/node_modules/.bin/vinext" ]]; then
  alert "Verdean dependencies are missing" "Open Terminal, run cd '$PROJECT', then npm install. After it finishes, open this launcher again."
  exit 1
fi

baseline_warning=""
for name in $EXPECTED; do
  if [[ ! -f "$TEST_FOLDER/$name" ]] || ! cmp -s "$PROJECT/examples/example-quote-renewal/$name" "$TEST_FOLDER/$name"; then
    baseline_warning="The prepared source folder is not at its canonical five-file baseline. Run Reset Test Kit.command before the demo."
    break
  fi
done
if [[ -d "$TEST_FOLDER/_Verdean" || -f "$TEST_FOLDER/05_alternate_matching_contract.txt" || -f "$TEST_FOLDER/06_manual_review_required.md" ]]; then
  baseline_warning="The prepared source folder contains generated output or an optional drop-in. Run Reset Test Kit.command before a clean demo."
fi

page="$(curl --silent --max-time 2 "$URL" 2>/dev/null || true)"
if [[ "$page" != *"Verdean"* ]]; then
  osascript \
    -e 'tell application "Terminal"' \
    -e "do script \"cd '$PROJECT' && npm run dev -- --host 127.0.0.1 --port 3000\"" \
    -e 'activate' \
    -e 'end tell'

  ready=0
  for attempt in {1..60}; do
    page="$(curl --silent --max-time 2 "$URL" 2>/dev/null || true)"
    if [[ "$page" == *"Verdean"* ]]; then
      ready=1
      break
    fi
    sleep 0.5
  done

  if [[ "$ready" -ne 1 ]]; then
    alert "Verdean did not start" "Check the Terminal window for the server error. The guide contains manual startup steps for $PROJECT."
    exit 1
  fi
fi

open -a "Google Chrome" "$GUIDE"
open -a "Google Chrome" "$HOW_IT_WORKS"
open -a "Google Chrome" "$APP_URL"
open "$TEST_FOLDER"
if [[ -d "$OPTIONAL_FOLDER" ]]; then
  open "$OPTIONAL_FOLDER"
fi
if [[ -n "$baseline_warning" ]]; then
  osascript -e "display notification \"$baseline_warning\" with title \"Verdean Test Kit\""
else
  osascript -e 'display notification "Guide, how-it-works, app, and clean five-file test folder are ready." with title "Verdean Test Kit"'
fi
