#! /usr/bin/env python3
import json
import re
import requests
import time
from pathlib import Path
from urllib.parse import urlparse

HEADERS = {"User-Agent": "calcourses.nickwalker.us data pipeline (contact: nswalker@uw.edu)"}

def download_pdf(url, output_path, cert_id, max_retries=1):
    """Download a PDF from a URL and save it to the specified path"""
    for attempt in range(max_retries):
        try:
            response = requests.get(url, stream=True, headers=HEADERS)
            response.raise_for_status()
            
            # Check content type
            content_type = response.headers.get('content-type', '')
            if 'pdf' not in content_type.lower():
                print(f"Warning: Unexpected content type {content_type} for certificate {cert_id}")
                print(f"URL: {url}")
                if attempt < max_retries - 1:
                    time.sleep(2)  # Wait before retry
                    continue
                return False
            
            # Download the file
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            # Verify file is not empty
            if output_path.stat().st_size == 0:
                print(f"Warning: Empty file downloaded for certificate {cert_id}")
                print(f"URL: {url}")
                output_path.unlink()  # Remove empty file
                if attempt < max_retries - 1:
                    time.sleep(2)  # Wait before retry
                    continue
                return False
            
            print(f"Successfully downloaded {output_path}")
            return True
            
        except Exception as e:
            print(f"Error downloading certificate {cert_id} (attempt {attempt + 1}/{max_retries}): {e}")
            print(f"URL: {url}")
            if attempt < max_retries - 1:
                time.sleep(2)  # Wait before retry
                continue
            return False

def main():
    # Create output directory if it doesn't exist
    output_dir = Path("data/pdfs")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # List to track failed downloads
    failed_downloads = []
    
    # Read the GeoJSON file
    with open("data/calibration_courses.geojson", 'r') as f:
        data = json.load(f)
    
    # Process each feature
    for feature in data['features']:
        cert_id = feature['properties']['certificateId']
        cert_link = feature['properties']['certificateLink']

        # Set the output filename
        output_path = output_dir / f"{cert_id}.pdf"

        # Skip if file already exists and is not empty
        if output_path.exists() and output_path.stat().st_size > 0:
            print(f"Skipping {output_path} - already exists")
            continue

        if cert_link.lower().endswith('.pdf'):
            # Direct PDF link (Athletics Canada / acroad.ca)
            success = download_pdf(cert_link, output_path, cert_id)

            # Some acroad listing links point at the wrong year folder; retry
            # with the year embedded in the cert ID (e.g. ON-2022-057-BDC -> 2022)
            year_match = re.search(r'-(\d{4})-', cert_id)
            if not success and year_match:
                retry_url = re.sub(r'/certificates/\d+/', f'/certificates/{year_match.group(1)}/', cert_link)
                if retry_url != cert_link:
                    print(f"\nRetrying with cert-ID year folder for certificate {cert_id}")
                    success = download_pdf(retry_url, output_path, cert_id)
        else:
            # certifiedroadraces.com link (USATF): extract the ID query param
            parsed_url = urlparse(cert_link)
            query_params = dict(param.split('=') for param in parsed_url.query.split('&'))
            cert_id_from_link = query_params.get('id')

            # Try with type=l first
            pdf_url = f"https://www.certifiedroadraces.com/certificate/generate-view.php/?type=l&id={cert_id_from_link}"
            success = download_pdf(pdf_url, output_path, cert_id)

            # If that fails, try with type=c
            if not success:
                print(f"\nRetrying with type=c for certificate {cert_id}")
                pdf_url = f"https://www.certifiedroadraces.com/certificate/generate-view.php/?type=c&id={cert_id_from_link}"
                success = download_pdf(pdf_url, output_path, cert_id)

        if not success:
            failed_downloads.append(cert_id)

        # Add a 2-second delay between requests
        time.sleep(2)
    
    # Write failed downloads to a file
    if failed_downloads:
        failed_file = Path("data/failed_downloads.txt")
        with open(failed_file, 'w') as f:
            f.write("# Certificate IDs that failed to download\n")
            for cert_id in failed_downloads:
                f.write(f"{cert_id}\n")
        print(f"\nFailed downloads written to {failed_file}")

if __name__ == '__main__':
    main() 