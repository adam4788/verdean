#!/bin/zsh
set -euo pipefail

PROJECT="${VERDEAN_PROJECT_ROOT:-$HOME/Projects/verdean}"
KIT="${VERDEAN_TEST_KIT_DIR:-$HOME/Desktop/Verdean Test Kit}"
TEST_FOLDER="$KIT/01 - CONNECT THIS FOLDER"
SOURCE_FOLDER="$PROJECT/examples/example-quote-renewal"
ASSET_FOLDER="$KIT/assets"
EXPECTED=(
  "01_supplier_quote.txt"
  "02_buyer_email.txt"
  "02a_supplier_invoice.txt"
  "03_call_transcript.txt"
  "04_signed_contract.txt"
)

if [[ "${1:-}" != "--yes" ]]; then
  printf '\nThis resets only the prepared Verdean test kit:\n  %s\n\n' "$KIT"
  printf 'It removes generated _Verdean copies, known optional drop-ins, and .DS_Store metadata, then restores the canonical five-file baseline. Continue? [y/N] '
  read -r answer
  if [[ "$answer" != [yY] ]]; then
    printf 'Reset cancelled.\n'
    exit 0
  fi
fi

if [[ ! -d "$SOURCE_FOLDER" ]]; then
  printf 'Canonical fixtures were not found at:\n  %s\n' "$SOURCE_FOLDER" >&2
  exit 1
fi

mkdir -p "$TEST_FOLDER"
rm -rf "$TEST_FOLDER/_Verdean"
rm -f \
  "$TEST_FOLDER/05_alternate_matching_contract.txt" \
  "$TEST_FOLDER/06_manual_review_required.md" \
  "$KIT/05_alternate_matching_contract.txt" \
  "$KIT/.DS_Store" \
  "$TEST_FOLDER/.DS_Store" \
  "$KIT/02 - OPTIONAL DROP-INS/.DS_Store"

for name in $EXPECTED; do
  if [[ ! -f "$SOURCE_FOLDER/$name" ]]; then
    printf 'Missing canonical fixture: %s\n' "$SOURCE_FOLDER/$name" >&2
    exit 1
  fi
  cp -f "$SOURCE_FOLDER/$name" "$TEST_FOLDER/$name"
  if ! cmp -s "$SOURCE_FOLDER/$name" "$TEST_FOLDER/$name"; then
    printf 'Fixture verification failed after copying: %s\n' "$name" >&2
    exit 1
  fi
done

mkdir -p "$ASSET_FOLDER"
cp -f "$PROJECT/docs/verdean-how-it-works.html" "$KIT/HOW VERDEAN WORKS.html"
cp -f "$PROJECT/docs/brand/verdean-document.css" "$ASSET_FOLDER/verdean-document.css"
cp -f "$PROJECT/public/verdean-horizontal.svg" "$ASSET_FOLDER/verdean-horizontal.svg"
/usr/bin/perl -0pi -e 's#href="brand/verdean-document\.css"#href="assets/verdean-document.css"#g; s#src="\.\./public/verdean-horizontal\.svg"#src="assets/verdean-horizontal.svg"#g' "$KIT/HOW VERDEAN WORKS.html"

"$KIT/Open Verdean.command" --reset
browser_result="Verdean was returned to its disconnected landing page."
osascript -e "display notification \"$browser_result\" with title \"Verdean Test Kit Reset\""
printf '\nReset complete. The five canonical files match the repository byte-for-byte.\n%s\n' "$browser_result"
