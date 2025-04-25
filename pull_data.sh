#!/bin/bash

GOOGLE_SHEET_URL="https://docs.google.com/spreadsheets/d/137rMUUj72qlMxZXUVvEUF_c1r6dHB6pQqDXmffcnSbc"
SHEET_ID="137rMUUj72qlMxZXUVvEUF_c1r6dHB6pQqDXmffcnSbc"
OUTPUT_FILE="calibration_courses.tsv"
TEMP_FILE="temp_sheet.tsv"

echo "Starting update of calibration courses TSV from Google Sheet..."
echo "Google Sheet ID: $SHEET_ID"

curl -L "https://docs.google.com/spreadsheets/d/$SHEET_ID/export?format=tsv" -o "$TEMP_FILE"

if [ $? -ne 0 ] || [ ! -s "$TEMP_FILE" ]; then
    echo "Error: Failed to download the Google Sheet or the downloaded file is empty."
    echo "Please check the Sheet ID and ensure the sheet is publicly accessible."
    exit 1
fi

if [ -f "$OUTPUT_FILE" ]; then
    BACKUP_FILE="${OUTPUT_FILE}.bak.$(date +%Y%m%d_%H%M%S)"
    echo "Creating backup of existing TSV: $BACKUP_FILE"
    cp "$OUTPUT_FILE" "$BACKUP_FILE"
fi

echo "Updating $OUTPUT_FILE with new data..."
mv "$TEMP_FILE" "$OUTPUT_FILE"

ROW_COUNT=$(wc -l < "$OUTPUT_FILE")
echo "Update complete. The new TSV contains $ROW_COUNT rows (including header)."