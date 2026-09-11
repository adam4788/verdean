#!/bin/zsh
set -euo pipefail

PROJECT="${VERDEAN_PROJECT_ROOT:-$HOME/Projects/verdean}"
KIT="${VERDEAN_TEST_KIT_DIR:-$HOME/Desktop/Verdean Test Kit}"
TEST_FOLDER="$KIT/01 - CONNECT THIS FOLDER"
SOURCE_FOLDER="$PROJECT/examples/example-quote-renewal"
HOW_IT_WORKS="$KIT/HOW VERDEAN WORKS.html"
URL="http://localhost:3000"
EXPECTED=(
  "01_supplier_quote.txt"
  "02_buyer_email.txt"
  "02a_supplier_invoice.txt"
  "03_call_transcript.txt"
  "04_signed_contract.txt"
)

failures=0
check() {
  if eval "$2"; then
    printf 'PASS  %s\n' "$1"
  else
    printf 'FAIL  %s\n' "$1"
    failures=$((failures + 1))
  fi
}

printf '\nVerdean Test Kit verification\n=============================\n'
check "Current Verdean repository exists" "[[ -f '$PROJECT/package.json' ]]"
check "HTML guide exists" "[[ -f '$KIT/START HERE - VERDEAN TEST GUIDE.html' ]]"
check "Verdean how-it-works document exists" "[[ -f '$HOW_IT_WORKS' ]]"
check "How-it-works stylesheet is packaged" "[[ -f '$KIT/assets/verdean-document.css' ]]"
check "How-it-works logo is packaged" "[[ -f '$KIT/assets/verdean-horizontal.svg' ]]"
check "Launcher is executable" "[[ -x '$KIT/Open Verdean.command' ]]"
check "Reset command is executable" "[[ -x '$KIT/Reset Test Kit.command' ]]"
check "Optional alternate-contract fixture exists" "[[ -f '$KIT/02 - OPTIONAL DROP-INS/05_alternate_matching_contract.txt' ]]"
check "Optional OCR scan fixture exists" "[[ -f '$KIT/02 - OPTIONAL DROP-INS/05_alternate_matching_contract_scan.png' ]]"
check "Optional manual-review fixture exists" "[[ -f '$KIT/02 - OPTIONAL DROP-INS/06_manual_review_required.md' ]]"

for name in $EXPECTED; do
  check "$name matches the canonical fixture" "cmp -s '$SOURCE_FOLDER/$name' '$TEST_FOLDER/$name'"
done

check "No generated _Verdean tree is present" "[[ ! -d '$TEST_FOLDER/_Verdean' ]]"
check "No optional contract is staged in the connected folder" "[[ ! -f '$TEST_FOLDER/05_alternate_matching_contract.txt' ]]"
check "No manual-review file is staged in the connected folder" "[[ ! -f '$TEST_FOLDER/06_manual_review_required.md' ]]"
check "No .DS_Store metadata remains in the prepared baseline" "[[ ! -f '$TEST_FOLDER/.DS_Store' ]]"

page="$(curl --silent --max-time 2 "$URL" 2>/dev/null || true)"
if [[ "$page" == *"Verdean"* ]]; then
  printf 'PASS  Verdean is serving at %s\n' "$URL"
else
  printf 'INFO  Verdean is not currently serving at %s; Open Verdean.command will start it.\n' "$URL"
fi

if [[ "$failures" -ne 0 ]]; then
  printf '\n%d check(s) failed. Run Reset Test Kit.command, then run this verifier again.\n' "$failures" >&2
  exit 1
fi

printf '\nAll prepared-kit checks passed.\n'
osascript -e 'display notification "All prepared-kit checks passed." with title "Verdean Test Kit"'
