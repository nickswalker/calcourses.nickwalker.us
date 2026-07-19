#!/usr/bin/env python3
"""Scrape Athletics Canada (acroad.ca) certified CALIBRATION courses into a TSV
that shares the US usatf_calibration_courses.tsv column schema so that
bin/prepare_data.py can consume both through the same code path.

Part 1b geocodes each unique "City, Province, Canada" via Nominatim (1 req/sec),
caching results in data/acroad_city_geocode_cache.json.
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

SOURCE_URL = "https://www.acroad.ca/Directors/CourseMeasurement/CertifiedCourses/"
ACROAD_BASE = "https://www.acroad.ca"
DATA_DIR = Path("data")
OUTPUT_TSV = DATA_DIR / "acroad_calibration_courses.tsv"
REVIEW_FILE = DATA_DIR / "acroad_review.txt"
GEOCODE_CACHE = DATA_DIR / "acroad_city_geocode_cache.json"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim usage policy requires a descriptive User-Agent with contact info.
USER_AGENT = "calcourses.nickwalker.us acroad scraper (contact: nick@nickwalker.us)"

# Same header as data/usatf_calibration_courses.tsv, plus a trailing "Replaces"
# column recording an older cert ID that a renewal supersedes. csv.DictReader
# in prepare_data.py ignores the extra column.
HEADER = [
    "CourseID", "Certification Year", "Name", "Dist", "Units", "City", "State",
    "Measurer", "Full state", "City,State", "Latitude", "Longitude", "Color",
    "Certificate URL", "Steet map", "Driving directions", "Date added", "Replaces",
]

PROVINCES = {
    "AB": "Alberta", "BC": "British Columbia", "MB": "Manitoba",
    "NB": "New Brunswick", "NL": "Newfoundland and Labrador",
    "NS": "Nova Scotia", "NT": "Northwest Territories", "NU": "Nunavut",
    "ON": "Ontario", "PE": "Prince Edward Island", "QC": "Quebec",
    "SK": "Saskatchewan", "YT": "Yukon",
}

# Known Canadian cities that appear with a missing province code in the source.
CITY_PROVINCE_FALLBACK = {
    "winnipeg": "MB", "vancouver": "BC", "toronto": "ON", "montreal": "QC",
    "montréal": "QC", "acton vale": "QC", "calgary": "AB", "ottawa": "ON",
    "edmonton": "AB",
}

# Accent- and case-insensitive calibration matcher. Covers: calibration,
# etalon/etalons/etalonnage, calibrage, and standalone "cal"/"cal.".
CAL_RE = re.compile(r"calibration|etalon|calibrage|\bcal\.?(?:\s|$)", re.IGNORECASE)


def deaccent(text):
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


def strip_comments(fragment):
    return re.sub(r"<!--.*?-->", "", fragment, flags=re.DOTALL)


def clean_text(fragment):
    """Strip tags/entities from an HTML fragment and collapse whitespace."""
    import html as html_mod
    text = re.sub(r"<[^>]+>", " ", fragment)
    text = html_mod.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def fetch_html():
    req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read()
    # The page is windows-1252 encoded; a naive UTF-8 decode corrupts accents.
    return raw.decode("windows-1252")


def parse_distance(raw_dist):
    """Return (dist_string, units, meters or None) from a distance cell.

    Handles "300m", "300 m", "300.000 m", "1 km", "1 mile", <br/>-stacked
    values (use first) and doubled text like "304.469 m 304.469 m" (dedupe).
    """
    # Use the first stacked value (the primary cert's distance).
    first = re.split(r"<br\s*/?>", raw_dist)[0]
    first = clean_text(first)
    m = re.search(
        r"(\d+(?:[.,]\d+)?)\s*(km|mi|miles?|meters?|metres?|ft|feet|m)\b",
        first, re.IGNORECASE,
    )
    if not m:
        return "", "", None
    number = m.group(1).replace(",", "")
    unit_raw = m.group(2).lower()
    if unit_raw in ("km",):
        units, factor = "km", 1000.0
    elif unit_raw in ("mi", "mile", "miles"):
        units, factor = "mi", 1609.344
    elif unit_raw in ("ft", "feet"):
        units, factor = "ft", 0.3048
    else:
        units, factor = "m", 1.0
    try:
        meters = float(number) * factor
    except ValueError:
        meters = None
    return number, units, meters


def parse_certs(cert_cell):
    """Return list of (cert_id, absolute_pdf_url) from a cert cell, in order.

    IDs are taken from the hrefs (plain hyphens), not the visible text which
    uses non-breaking hyphens.
    """
    certs = []
    for href in re.findall(r'href=["\']([^"\']+\.pdf)["\']', cert_cell, re.IGNORECASE):
        # A handful of 2012-2013 hrefs use lowercase IDs; normalize the ID but
        # keep the URL's original case, which is what the server serves.
        cert_id = Path(href).stem.upper()
        url = href if href.startswith("http") else ACROAD_BASE + href
        certs.append((cert_id, url))
    return certs


def year_from_cert_id(cert_id):
    m = re.search(r"-(\d{4})-", cert_id)
    if not m:
        # Some national certs look like CAN-2025-157 (no trailing suffix).
        m = re.match(r"[A-Z]+-(\d{4})", cert_id)
    return int(m.group(1)) if m else None


def parse_location(loc_text):
    """Return (city, province_code, province_name) from a "City, XX" string."""
    loc_text = loc_text.strip().rstrip(",").strip()
    parts = [p.strip() for p in loc_text.split(",")]
    if len(parts) >= 2 and parts[-1] in PROVINCES:
        code = parts[-1]
        city = ", ".join(parts[:-1]).strip()
        return city, code, PROVINCES[code]
    # Missing province: try to infer from a known-city fallback.
    city = parts[0] if parts else loc_text
    code = CITY_PROVINCE_FALLBACK.get(city.lower())
    if code:
        return city, code, PROVINCES[code]
    # International or otherwise unresolved: keep the whole string as the city.
    return loc_text, "", ""


def parse_rows(html):
    start = html.find("</thead>")
    end = html.find("</tbody>", start)
    body = html[start:end if end != -1 else None]
    tr_blocks = re.findall(r"<tr>(.*?)</tr>", body, re.DOTALL)
    rows = []
    for tb in tr_blocks:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", strip_comments(tb), re.DOTALL)
        if len(cells) < 6:
            continue
        _, _year_c, dist_c, cert_c, title_c, loc_c = cells[:6]
        title_m = re.search(r'<span class="hideMobile">(.*?)</span>', title_c, re.DOTALL)
        title = clean_text(title_m.group(1)) if title_m else ""
        rows.append({
            "dist_raw": dist_c,
            "cert_raw": cert_c,
            "title": title,
            "loc_raw": clean_text(loc_c),
        })
    return rows


def load_cache():
    if GEOCODE_CACHE.exists():
        return json.loads(GEOCODE_CACHE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache):
    GEOCODE_CACHE.write_text(
        json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def geocode(query, cache):
    """Geocode a location string via Nominatim, caching results (incl. misses)."""
    if query in cache:
        entry = cache[query]
        return (entry.get("lat"), entry.get("lon")) if entry else (None, None)
    params = urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
    req = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}", headers={"User-Agent": USER_AGENT}
    )
    time.sleep(1.1)  # honor 1 req/sec policy
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            results = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"  geocode error for {query!r}: {exc}", file=sys.stderr)
        results = []
    if results:
        lat, lon = results[0]["lat"], results[0]["lon"]
        cache[query] = {"lat": lat, "lon": lon, "display_name": results[0].get("display_name")}
        return lat, lon
    cache[query] = None
    return None, None


def maps_anchor(kind, lat, lon):
    if not lat or not lon:
        return ""
    if kind == "street":
        return (f"<a href='https://www.google.com/maps/place/{lat},{lon}' "
                f"target='_blank'>Local street map of course</a>")
    return (f"<a href='https://www.google.com/maps/dir/?api=1&destination={lat},{lon}"
            f"&travelmode=driving' target='_blank'>Driving directions to course</a>")


def main():
    print(f"Fetching {SOURCE_URL} ...")
    html = fetch_html()
    rows = parse_rows(html)
    print(f"Parsed {len(rows)} table rows.")

    calibration = []
    review = []  # non-matching rows with a parseable distance under 1200 m
    for row in rows:
        title = row["title"]
        is_cal = bool(CAL_RE.search(deaccent(title)))
        dist_str, units, meters = parse_distance(row["dist_raw"])
        if not is_cal:
            if meters is not None and meters < 1200:
                review.append((row["loc_raw"], f"{dist_str} {units}".strip(), title))
            continue
        certs = parse_certs(row["cert_raw"])
        if not certs:
            continue
        # Choose the newest cert by year (from cert ID); tie-break: first listed.
        indexed = list(enumerate(certs))
        primary_i, (cert_id, cert_url) = max(
            indexed, key=lambda t: (year_from_cert_id(t[1][0]) or 0, -t[0])
        )
        replaces = ";".join(
            cid for j, (cid, _u) in enumerate(certs) if j != primary_i
        )
        year = year_from_cert_id(cert_id)
        city, prov_code, prov_name = parse_location(row["loc_raw"])
        calibration.append({
            "CourseID": cert_id,
            "Certification Year": str(year) if year else "",
            "Name": title,
            "Dist": dist_str,
            "Units": units,
            "City": city,
            "State": prov_code,
            "Measurer": "",
            "Full state": prov_name,
            "City,State": f"{city},{prov_name}" if prov_name else city,
            "Latitude": "",
            "Longitude": "",
            "Color": "PURPLE",
            "Certificate URL": (f"<a href='{cert_url}' target='_blank'>{cert_id}</a>"),
            "Steet map": "",
            "Driving directions": "",
            "Date added": "",
            "Replaces": replaces,
        })

    print(f"Calibration matches: {len(calibration)} of {len(rows)} rows.")

    # --- Part 1b: geocode unique cities ---
    cache = load_cache()
    geocode_failures = []
    unique_queries = {}
    for c in calibration:
        if c["Full state"]:
            query = f"{c['City']}, {c['Full state']}, Canada"
        else:
            query = c["City"]  # international / unresolved province
        unique_queries.setdefault(query, []).append(c)
    print(f"Geocoding {len(unique_queries)} unique locations ...")
    for i, (query, entries) in enumerate(sorted(unique_queries.items())):
        lat, lon = geocode(query, cache)
        if i % 20 == 0:
            save_cache(cache)  # checkpoint so a crash doesn't lose progress
        for c in entries:
            if lat and lon:
                c["Latitude"], c["Longitude"] = lat, lon
                c["Steet map"] = maps_anchor("street", lat, lon)
                c["Driving directions"] = maps_anchor("dir", lat, lon)
            else:
                geocode_failures.append((c["CourseID"], query))
    save_cache(cache)

    blank_coords = sum(1 for c in calibration if not c["Latitude"])
    geocoded = len(calibration) - blank_coords

    # --- Write TSV ---
    with OUTPUT_TSV.open("w", encoding="utf-8", newline="") as f:
        f.write("\t".join(HEADER) + "\n")
        for c in calibration:
            f.write("\t".join(c[h] for h in HEADER) + "\n")
    print(f"Wrote {len(calibration)} rows to {OUTPUT_TSV}")

    # --- Write review file ---
    with REVIEW_FILE.open("w", encoding="utf-8") as f:
        f.write("Possible unlabeled calibration courses "
                "(non-matching rows, parseable distance < 1200 m):\n")
        f.write(f"Count: {len(review)}\n\n")
        for loc, dist, title in review:
            f.write(f"  {dist}\t{loc}\t{title}\n")
        if geocode_failures:
            f.write(f"\nGeocode failures ({len(geocode_failures)}):\n")
            for cid, query in geocode_failures:
                f.write(f"  {cid}\t{query}\n")
    print(f"Wrote review list ({len(review)} rows) to {REVIEW_FILE}")

    print("\nSummary:")
    print(f"  rows scraped:        {len(rows)}")
    print(f"  calibration matches: {len(calibration)}")
    print(f"  geocoded:            {geocoded}")
    print(f"  blank coordinates:   {blank_coords}")
    print(f"  review list size:    {len(review)}")
    print(f"  geocode failures:    {len(geocode_failures)}")


if __name__ == "__main__":
    main()
