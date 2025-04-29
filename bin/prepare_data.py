import json
import csv
from pathlib import Path
import re
import json
import os
from datetime import datetime, timezone


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
        # 'trail': 'Trl',
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

    # Sort features by certificateId
    geojson["features"].sort(key=lambda x: x["properties"]["certificateId"])
    return geojson


def patch_geojson_with_additional_data(original_geojson, additional_data_file):
    """
    Patch the original GeoJSON with data from an additional GeoJSON file.
    Don't patch over the geometry if types don't match.
    Extract LineString geometries to a separate collection.
    """
    # Load the additional data
    with open(additional_data_file, 'r', encoding='utf-8') as f:
        additional_data = json.load(f)

    # Create a new GeoJSON for LineString features
    line_geojson = {
        "type": "FeatureCollection",
        "features": []
    }

    # Create a dictionary mapping certificateId to the additional feature for quick lookup
    additional_features_dict = {}
    for feature in additional_data.get('features', []):
        cert_id = feature.get('properties', {}).get('certificateId')
        if cert_id:
            additional_features_dict[cert_id] = feature

    # Keep track of which additional features we've processed
    processed_additional_ids = set()

    # Update the original features with the additional data
    for feature in original_geojson.get('features', []):
        cert_id = feature.get('properties', {}).get('certificateId')

        if cert_id and cert_id in additional_features_dict:
            additional_feature = additional_features_dict[cert_id]

            # Extract the additional feature's geometry type
            additional_geom_type = additional_feature.get('geometry', {}).get('type')
            original_geom_type = feature.get('geometry', {}).get('type')

            # If the additional feature has a LineString geometry, add it to the line collection
            if additional_geom_type == 'LineString':
                # Create a new feature for the line collection
                line_feature = {
                    "type": "Feature",
                    "geometry": additional_feature['geometry'],
                    "properties": {"certificateId": cert_id}
                }

                # Compute the point by averaging the coordinates
                coords = additional_feature['geometry'].get('coordinates', None)
                if coords:
                    avg_longitude = sum(coord[0] for coord in coords) / len(coords)
                    avg_latitude = sum(coord[1] for coord in coords) / len(coords)
                    feature["geometry"]["coordinates"] = [avg_longitude, avg_latitude]


                # Update with any additional properties
                if 'properties' in additional_feature:
                    for prop_key, prop_value in additional_feature['properties'].items():
                        line_feature['properties'][prop_key] = prop_value

                line_geojson['features'].append(line_feature)
                print(f"Added LineString geometry for certificateId: {cert_id} to line collection")

            # Update geometry only if types match
            elif 'geometry' in additional_feature and additional_geom_type == original_geom_type:
                feature['geometry'] = {**feature['geometry'], **additional_feature['geometry']}
                print(f"Updated geometry for certificateId: {cert_id} (type: {original_geom_type})")

            # Always update properties
            if 'properties' in additional_feature:
                for prop_key, prop_value in additional_feature['properties'].items():
                    feature['properties'][prop_key] = prop_value
                print(f"Updated properties for certificateId: {cert_id}")

            processed_additional_ids.add(cert_id)

    # Add any new features from additional data that weren't in the original
    for cert_id, feature in additional_features_dict.items():
        if cert_id in processed_additional_ids:
            continue

        geom_type = feature.get('geometry', {}).get('type')

        # Add LineString features to the line collection
        if geom_type == 'LineString':
            line_geojson['features'].append(feature)
            print(f"Added new LineString feature with certificateId: {cert_id} to line collection")
        # Add other types to the original collection
        elif ('geometry' in feature and
              feature['geometry'].get('type') and
              'coordinates' in feature['geometry']):
            original_geojson['features'].append(feature)
            print(f"Added new feature with certificateId: {cert_id} to original collection")
        else:
            print(f"Skipped adding new feature with certificateId: {cert_id} - incomplete geometry")

    return original_geojson, line_geojson


def main():
    input_file = "data/calibration_courses.tsv"
    additional_data_file = "data/additional_data.geojson"
    output_file = "data/calibration_courses.geojson"
    line_output_file = "data/calibration_course_lines.geojson"

    if not Path(input_file).exists():
        print(f"Error: Input file '{input_file}' not found.")
        return

    geojson_data = tsv_to_geojson(input_file)

    if len(geojson_data["features"]) == 0:
        print(f"Error: No valid features found in '{input_file}'.")
        exit(1)

    # Patch with additional data if available
    if Path(additional_data_file).exists():
        print(f"Patching with additional data from '{additional_data_file}'...")
        geojson_data, line_geojson_data = patch_geojson_with_additional_data(geojson_data, additional_data_file)

        # Write the line data to a separate file
        with open(line_output_file, 'w', encoding='utf-8') as f:
            json.dump(line_geojson_data, f, indent=2)
        print(f"LineString geometries written to {line_output_file}")
        print(f"Wrote {len(line_geojson_data['features'])} LineString features.")

        print(f"Patching complete.")
    else:
        print(f"Note: Additional data file '{additional_data_file}' not found. Continuing without patching.")

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, indent=2)

    print(f"Conversion complete. Point GeoJSON written to {output_file}")
    print(f"Converted {len(geojson_data['features'])} point features.")

    # So we can display last update time on the webpage
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    data = {
        'last_updated': timestamp
    }

    with open(os.path.join('data', 'last_updated.json'), 'w') as f:
        json.dump(data, f, indent=2)


if __name__ == "__main__":
    main()