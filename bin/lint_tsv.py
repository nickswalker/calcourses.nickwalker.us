#!/usr/bin/env python3
import csv
import math
import re
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict


def extract_url_from_anchor(html_string):
    """Extract URL from HTML anchor tag."""
    import re
    pattern = r"<a\s+(?:[^>]*?\s+)?href=['\"]([^'\"]*)['\"]"
    match = re.search(pattern, html_string)
    if match:
        return match.group(1)
    return None


def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points
    on the earth (specified in decimal degrees)
    """
    # Convert decimal degrees to radians
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])

    # Haversine formula
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371000  # Radius of earth in meters
    return c * r


def detect_calibration_misspellings(course_name):
    """
    Detect common misspellings of 'Calibration' in course names.
    Returns the misspelled word if found, None otherwise.
    Explicitly ignores "celebration" as it's a valid word.
    """
    # Convert to lowercase for case-insensitive matching
    name_lower = course_name.lower()

    # List of common misspellings
    misspellings = [
        "cakibration",
        "calibraion",
        "calibation",
        "calibraton",
        "calaibration"
    ]

    # Create a regex pattern that will match these misspellings
    misspelling_pattern = r'\b(' + '|'.join(misspellings) + r')\b'

    # Find all misspellings in the course name
    matches = re.findall(misspelling_pattern, name_lower)

    if matches:
        return matches[0]  # Return the first misspelling found

    # Also check for other potential misspellings not in our list
    # This looks for words that are similar to "calibration" but not exactly
    potential_pattern = r'\bc[a-z]*l[a-z]*b[a-z]*r[a-z]*t[a-z]*[io][a-z]*n\b'
    potential_matches = re.findall(potential_pattern, name_lower)

    for match in potential_matches:
        # Exclude the correct spelling and "celebration"
        if match != "calibration" and match != "celebration":
            return match

    return None


def detect_typoed_measurements(course_name):
    """
    Detect typoed measurements in course names.
    Specifically looks for numbers with a dash and whitespace followed by 'ft'.
    Returns the typoed measurement if found, None otherwise.

    Examples of typos:
    - "1- 000ft" (has dash and whitespace)
    - "123- ft" (has dash and whitespace)

    Valid formats (not reported):
    - "1000ft" (no space)
    - "123 ft" (space but no dash)
    """
    # Case-insensitive matching for "ft" with possible whitespace
    # Look for: number + dash + whitespace + digits + "ft"
    typo_pattern = r'\b\d+\s*-\s+\d*\s*ft\b'

    # Find all typoed measurements in the course name, case insensitive
    matches = re.findall(typo_pattern, course_name.lower())

    if matches:
        return matches[0]  # Return the first typoed measurement found

    return None


def lint_tsv(input_file, output_file, epsilon=10):  # epsilon in meters
    """
    Lint the TSV file and write results to a text file:
    1. Find all courses with empty certificate links
    2. Find all courses with coordinates that are within epsilon meters of each other
    3. Find all courses with 'Calibration' misspellings in their names
    4. Find all courses with typoed measurements in their names
    5. List all courses where Color is 'PURPLE' (approximate location)
    6. Find all courses with duplicate certificate links
    """
    courses = []
    empty_cert_links = []
    misspelled_courses = []
    typoed_measurement_courses = []
    purple_courses = []

    # Dictionary to track certificate links and which courses use them
    cert_links_to_courses = defaultdict(list)

    # Read in all courses
    with open(input_file, 'r', encoding='utf-8') as tsv_file:
        reader = csv.DictReader(tsv_file, delimiter='\t')

        # Create a dictionary to store course names by ID for easier lookup
        course_names = {}

        for row in reader:
            try:
                course_id = row['CourseID']
                course_name = row['Name']
                course_names[course_id] = course_name
                cert_link = extract_url_from_anchor(row['Certificate URL'])

                # Check for empty certificate links
                if not cert_link:
                    empty_cert_links.append(course_id)
                else:
                    # Track this certificate link for duplicate detection
                    cert_links_to_courses[cert_link].append({
                        'id': course_id,
                        'name': course_name
                    })

                # Check for calibration misspellings
                misspelling = detect_calibration_misspellings(course_name)
                if misspelling:
                    misspelled_courses.append({
                        'id': course_id,
                        'name': course_name,
                        'misspelling': misspelling
                    })

                # Check for typoed measurements
                typoed_measurement = detect_typoed_measurements(course_name)
                if typoed_measurement:
                    typoed_measurement_courses.append({
                        'id': course_id,
                        'name': course_name,
                        'typoed_measurement': typoed_measurement
                    })

                # Check for teal color (approximate location)
                if 'Color' in row and row['Color'].upper() == 'PURPLE':
                    purple_courses.append({
                        'id': course_id,
                        'name': course_name,
                        'city': row.get('City', 'N/A'),
                        'state': row.get('State', 'N/A')
                    })

                # Only add courses with valid coordinates
                if row.get('Latitude') and row.get('Longitude'):
                    lat = float(row['Latitude'])
                    lon = float(row['Longitude'])

                    courses.append({
                        'id': course_id,
                        'name': course_name,
                        'lat': lat,
                        'lon': lon,
                        'city': row['City'],
                        'state': row['State']
                    })
            except (ValueError, KeyError) as e:
                print(f"Error processing course {row.get('CourseID', 'unknown')}: {e}")

    # Find duplicated certificate links (links used by more than one course)
    duplicated_links = {link: courses for link, courses in cert_links_to_courses.items() if len(courses) > 1}

    # Find courses with close coordinates
    close_courses = []

    # Compare each course with every other course
    for i, course1 in enumerate(courses):
        for j, course2 in enumerate(courses[i + 1:], i + 1):
            distance = haversine_distance(
                course1['lat'], course1['lon'],
                course2['lat'], course2['lon']
            )

            if distance <= epsilon:
                close_courses.append((course1, course2, distance))

    # Create timestamp
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    # Write results to file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(f"Calibration Courses QA Report\n")
        f.write(f"Generated: {timestamp}\n")
        f.write(f"{'=' * 50}\n\n")

        f.write("=== COURSES WITH EMPTY CERTIFICATE LINKS ===\n")
        if empty_cert_links:
            for cert_id in empty_cert_links:
                # Get the course name from our dictionary
                course_name = course_names.get(cert_id, "Unknown")
                f.write(f"{cert_id}\t{course_name}\n")
        else:
            f.write("No courses with empty certificate links found.\n")

        f.write("\n=== COURSES WITH DUPLICATED CERTIFICATE LINKS ===\n")
        if duplicated_links:
            for link, course_list in duplicated_links.items():
                f.write(f"Link: {link}\n")
                for course in course_list:
                    f.write(f"{course['id']}\t{course['name']}\n")
                f.write(f"{'-' * 50}\n")
        else:
            f.write("No courses with duplicated certificate links found.\n")

        f.write("\n=== COURSES WITH 'CALIBRATION' MISSPELLINGS ===\n")
        if misspelled_courses:
            for course in misspelled_courses:
                f.write(f"{course['id']}\t{course['name']}\n")
        else:
            f.write("No courses with 'Calibration' misspellings found.\n")

        f.write("\n=== COURSES WITH TYPOED MEASUREMENTS ===\n")
        if typoed_measurement_courses:
            for course in typoed_measurement_courses:
                f.write(f"{course['id']}\t{course['name']}\n")
        else:
            f.write("No courses with typoed measurements found.\n")

        f.write(f"\n=== COURSES WITH CLOSE COORDINATES (within {epsilon} meters) ===\n")
        if close_courses:
            for course1, course2, distance in close_courses:
                f.write(f"{course1['id']}\t{course1['name']}\t{course1['city']}, {course1['state']}\n")
                f.write(f"{course2['id']}\t{course2['name']}\t{course2['city']}, {course2['state']}\n")
                f.write(f"Distance: {distance:.2f}m\n")
                f.write(f"{'-' * 50}\n")
        else:
            f.write("No courses with close coordinates found.\n")

        f.write("\n=== COURSES WITH APPROXIMATE LOCATION (PURPLE) ===\n")
        if purple_courses:
            for course in purple_courses:
                f.write(f"{course['id']}\t{course['name']}\t{course['city']}, {course['state']}\n")
        else:
            f.write("No courses with approximate location (PURPLE color) found.\n")

    print(f"Report written to {output_file}")


def main():
    data_dir = Path("data")
    data_dir.mkdir(exist_ok=True)

    input_file = data_dir / "calibration_courses.tsv"
    output_file = data_dir / "calibration_qa_report.txt"

    if not Path(input_file).exists():
        print(f"Error: Input file '{input_file}' not found.")
        return

    lint_tsv(input_file, output_file, epsilon=10)


if __name__ == "__main__":
    main()