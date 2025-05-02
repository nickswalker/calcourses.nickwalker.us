import os
import re
import PyPDF2
import argparse
from pathlib import Path
from paddleocr import PaddleOCR

# Initialize PaddleOCR with English language and optimization
ocr = PaddleOCR(
    lang='en',
    use_angle_cls=True,
    use_gpu=False,
    use_mp=True,         # Enable multiprocessing
    total_process_num=4  # Use 4 processes (adjust based on your M1 Pro core count)
)

# Coordinate patterns to match
COORDINATE_PATTERNS = [
    # Standard format: 12N 4287669.6 N 402855.8 E
    r'\d{1,2}[NS]\s+\d{7}\.\d\s+[NS]\s+\d{6}\.\d\s+[EW]',
    
    # Format with commas: 12N, 4287669.6, N, 402855.8, E
    r'\d{1,2}[NS],\s*\d{7}\.\d,\s*[NS],\s*\d{6}\.\d,\s*[EW]',
    
    # Format with slashes: 12N/4287669.6/N/402855.8/E
    r'\d{1,2}[NS]/\d{7}\.\d/[NS]/\d{6}\.\d/[EW]',
    
    # Format with spaces only: 12N 4287669.6 N 402855.8 E
    r'\d{1,2}[NS]\s+\d{7}\.\d\s+[NS]\s+\d{6}\.\d\s+[EW]',
    
    # Format with no spaces between numbers: 12N4287669.6N402855.8E
    r'\d{1,2}[NS]\d{7}\.\d[NS]\d{6}\.\d[EW]',
    
    # Format with degree symbols: 12°N 4287669.6 N 402855.8 E
    r'\d{1,2}°[NS]\s+\d{7}\.\d\s+[NS]\s+\d{6}\.\d\s+[EW]',
    
    # Format with decimal degrees: 12.3456°N, 123.4567°E
    r'\d{1,3}\.\d{4}°[NS],\s*\d{1,3}\.\d{4}°[EW]',
    
    # Format with minutes and seconds: 12°34'56.78"N 123°45'67.89"E
    r"\d{1,3}°\d{1,2}'\d{1,2}\.\d{1,2}\"[NS]\s+\d{1,3}°\d{1,2}'\d{1,2}\.\d{1,2}\"[EW]"
]

def extract_pdf_text(file_path):
    """Extract text directly from PDF"""
    text = ""
    try:
        with open(file_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
    except Exception as e:
        print(f"Error extracting PDF text from {file_path}: {e}")
    return text

def extract_coordinates_with_regex(text):
    """Extract coordinates using regex patterns"""
    all_matches = []
    for pattern in COORDINATE_PATTERNS:
        matches = re.findall(pattern, text)
        if matches:
            print(f"Found matches with pattern: {pattern}")
            all_matches.extend(matches)
    return all_matches

def process_pdf(file_path):
    """Process a single PDF file and return extracted coordinates"""
    print(f"\nProcessing {file_path}...")
    
    # First try direct text extraction
    pdf_text = extract_pdf_text(file_path)
    print("\nText extracted from PDF:")
    print(pdf_text)
    
    coordinates = extract_coordinates_with_regex(pdf_text)
    
    # If no coordinates found, try OCR
    if not coordinates:
        print("\nNo coordinates found in text, trying OCR...")
        try:
            result = ocr.ocr(file_path, cls=True)
            ocr_text = ""
            if result:
                print("\nOCR Results:")
                for page_result in result:
                    for line in page_result:
                        text = line[1][0]
                        confidence = line[1][1]
                        print(f"Text: {text} (Confidence: {confidence:.2f})")
                        ocr_text += text + " "
            
            coordinates = extract_coordinates_with_regex(ocr_text)
        except Exception as e:
            print(f"Error during OCR: {e}")
    
    return coordinates

def main():
    parser = argparse.ArgumentParser(description='Extract coordinates from PDF files')
    parser.add_argument('path', type=str, help='Path to PDF file or directory containing PDFs')
    args = parser.parse_args()
    
    path = Path(args.path)
    
    if not path.exists():
        print(f"Error: Path {path} does not exist")
        return
    
    if path.is_file():
        # Process single file
        if path.suffix.lower() != '.pdf':
            print(f"Error: {path} is not a PDF file")
            return
        coordinates = process_pdf(str(path))
        print(f"\nResults for {path.name}:")
        if coordinates:
            print("Found coordinates:")
            for coord in coordinates:
                print(f"  - {coord}")
        else:
            print("No coordinates found")
    else:
        # Process directory
        for pdf_file in path.glob("*.pdf"):
            coordinates = process_pdf(str(pdf_file))
            print(f"\nResults for {pdf_file.name}:")
            if coordinates:
                print("Found coordinates:")
                for coord in coordinates:
                    print(f"  - {coord}")
            else:
                print("No coordinates found")

if __name__ == '__main__':
    main()