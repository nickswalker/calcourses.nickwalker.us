import json
import csv
from pathlib import Path
import re

def extract_url_from_anchor(html_string):
    pattern = r"<a\s+(?:[^>]*?\s+)?href=['\"]([^'\"]*)['\"]"
    match = re.search(pattern, html_string)

    if match:
        return match.group(1)
    return None

def tsv_to_geojson(input_file):
    geojson = {
        "type": "FeatureCollection",
        "features": []
    }

    with open(input_file, 'r', encoding='utf-8') as tsv_file:
        reader = csv.DictReader(tsv_file, delimiter='\t')

        for row in reader:
            if not row.get('Latitude') or not row.get('Longitude'):
                continue

            try:
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [
                            float(row['Longitude']),  # Note longitude comes first in GeoJSON
                            float(row['Latitude'])
                        ]
                    },
                    "properties": {
                        "certificateId": row['CourseID'],
                        "name": row['Name'],
                        "city": row['City'],
                        "state": row['State'],
                        "courseLength": float(row['Dist'].replace(",", "")),
                        "units": row['Units'].lower(),
                        "measurer": row['Measurer'],
                        "certificateLink": extract_url_from_anchor(row['Certificate URL']),
                        "approximate": row['Color'] == 'PURPLE'
                    }
                }

                geojson["features"].append(feature)

            except (ValueError, KeyError) as e:
                print(f"Skipping row due to error: {e}")
                continue

    return geojson


def main():
    input_file = "calibration_courses.tsv"
    output_file = "calibration_courses.geojson"

    if not Path(input_file).exists():
        print(f"Error: Input file '{input_file}' not found.")
        return

    geojson_data = tsv_to_geojson(input_file)

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, indent=2)

    print(f"Conversion complete. GeoJSON written to {output_file}")
    print(f"Converted {len(geojson_data['features'])} features.")


if __name__ == "__main__":
    main()