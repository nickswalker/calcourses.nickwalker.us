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


def remove_calibration_references(text):
    # Pattern to match various forms of calibration course references
    calibration_pattern = r'\s+-?\s*(?:calibration\s+course|calibration|cal\s+course)'

    # Remove all matches from the text
    result = re.sub(calibration_pattern, '', text, flags=re.IGNORECASE)

    return result


def remove_measurements(text):
    # Pattern to match:
    # 1. Optional whitespace
    # 2. Optional hyphen with optional surrounding whitespace
    # 3. Digits with optional decimal portion
    # 4. Unit (m or ft)
    measurement_pattern = r'\s*(?:\s*-\s*)?\d+(?:\.\d+)?(?:m|ft)'

    # Remove all matches
    result = re.sub(measurement_pattern, '', text, flags=re.IGNORECASE)

    return result

def format_measurements(text):
    # Pattern 1: Numbers followed by optional space/dash then metric units
    pattern_metric = r'(\d+(?:\.\d+)?)[\s-]?(meters?|mtr|m)'

    # Pattern 2: Numbers followed by various feet indicators
    pattern_feet = r'(\d+(?:\.\d+)?)[\s-]?(feet|foot|ft\.?|\')'

    def replace_metric(match):
        number = match.group(1)
        return f"{number}m"

    def replace_feet(match):
        number = match.group(1)
        return f"{number}ft"

    # Apply both transformations
    result = re.sub(pattern_metric, replace_metric, text, flags=re.IGNORECASE)
    result = re.sub(pattern_feet, replace_feet, result, flags=re.IGNORECASE)

    return result


def standardize_road_types(text):
    # Dictionary of full road types to their abbreviations
    road_types = {
        'avenue': 'Ave',
        'boulevard': 'Blvd',
        'circle': 'Cir',
        'court': 'Ct',
        'drive': 'Dr',
        'expressway': 'Expy',
        'freeway': 'Fwy',
        'highway': 'Hwy',
        'lane': 'Ln',
        'parkway': 'Pkwy',
        'place': 'Pl',
        'road': 'Rd',
        'square': 'Sq',
        'street': 'St',
        'terrace': 'Ter',
        #'trail': 'Trl',
        'turnpike': 'Tpke',
        'way': 'Way'
    }

    # Create regex pattern for all road types
    # Format is: word boundary + road type + word boundary
    # Using alternation for all road types, longest first to avoid partial matches
    # Sort by length (descending) to match longest terms first
    sorted_types = sorted(road_types.keys(), key=len, reverse=True)
    pattern = r'\b(' + '|'.join(sorted_types) + r')\b'

    # Case-insensitive replacement function
    def replace_road_type(match):
        road_type = match.group(1).lower()
        return road_types[road_type]

    # Apply the transformation
    result = re.sub(pattern, replace_road_type, text, flags=re.IGNORECASE)

    return remove_unnecessary_periods(result)


def remove_unnecessary_periods(text):
    # Pattern for compass directions with periods
    # Matches N., S., E., W., NE., NW., SE., SW.
    compass_pattern = r'\b([NSEW]|NE|NW|SE|SW)\.(?!\w)'

    # Pattern for road type abbreviations with periods
    # These match common abbreviated road types with periods
    abbrev_pattern = r'\b(Ave|Blvd|Cir|Ct|Dr|Expy|Fwy|Hwy|Ln|Pkwy|Pl|Rd|Sq|St|Ter|Trl|Tpke|Way)\.(?!\w)'

    # Remove periods from compass directions
    result = re.sub(compass_pattern, r'\1', text)

    # Remove periods from abbreviations
    result = re.sub(abbrev_pattern, r'\1', result)

    return result

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
                name = row['Name']
                name_abbreviated = name
                name_abbreviated = remove_calibration_references(name_abbreviated)
                name_abbreviated = name_abbreviated.replace(" yards", "yd")
                name_abbreviated = format_measurements(name_abbreviated)
                name_abbreviated = remove_measurements(name_abbreviated)
                name_abbreviated = standardize_road_types(name_abbreviated)
                # Clean up any extra spaces
                name_abbreviated = re.sub(r'\s+', ' ', name_abbreviated).strip()
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
                        "name": name,
                        "nameAbbreviated": name_abbreviated,
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