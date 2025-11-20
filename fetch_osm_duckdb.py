#!/usr/bin/env python3
"""
Fetch OSM changesets for specified users using DuckDB and the public OSM dataset on AWS.
This queries s3://osm-pds/ directly without needing your own S3 bucket or Athena.
"""

import duckdb
import json
from pathlib import Path

# Users to track
USERS = [
    'Amac239', 'AndromedaL', 'bmrushing', 'brikin', 'caitnahc', 'clayded',
    'conordoremus', 'dsmith10', 'DuckDuckCat', 'geographywizard123', 'haycam',
    'I-Izzo', 'isamah', 'JacobLovesMaps', 'joecalta', 'katherineherlihy',
    'kengaroo5445', 'KQWilson', 'livmakesmaps', 'Lendekat001', 'lucycrino',
    'maps4lyfe1304', 'meghanstengel', 'merritt_car22', 'mmann1123', 'norabutter',
    'o_paq', 'ryleeisosm', 'Sai_Dontukurti', 'Sasank Chaganti',
    'Manojkumar Yerraguntla', 'Waltuh'
]

# Cities with bounding boxes (min_lon, min_lat, max_lon, max_lat)
CITIES = {
    'Rome, IT': (12.23, 41.65, 12.85, 42.10),
    'Scottsdale, AZ': (-111.96, 33.40, -111.68, 33.85),
    'London, UK': (-0.51, 51.28, 0.33, 51.69),
    'Naples, IT': (14.10, 40.78, 14.40, 40.95),
    'Brooklyn, NY': (-74.05, 40.57, -73.83, 40.74),
    'Phoenix, AZ': (-112.35, 33.27, -111.90, 33.70),
}

# Start date
START_DATE = '2024-01-01'

def main():
    output_dir = Path(__file__).parent / 'data'
    output_dir.mkdir(exist_ok=True)

    print("Setting up DuckDB with extensions...")
    conn = duckdb.connect(':memory:')

    # Install and load required extensions
    conn.execute("""
        INSTALL httpfs;
        LOAD httpfs;
        INSTALL spatial;
        LOAD spatial;

        -- Configure S3 for anonymous access to public bucket
        SET s3_region = 'us-east-1';
        SET s3_access_key_id = '';
        SET s3_secret_access_key = '';
    """)

    # Create user list for SQL IN clause
    users_sql = ", ".join([f"'{user}'" for user in USERS])

    print(f"Querying OSM changesets for {len(USERS)} users since {START_DATE}...")
    print("This may take several minutes as it scans the public OSM dataset...")

    # Query the public OSM changesets
    # The osm-pds bucket contains changesets in ORC format
    query = f"""
        SELECT
            id,
            uid,
            "user" AS username,
            created_at,
            closed_at,
            min_lon,
            min_lat,
            max_lon,
            max_lat,
            num_changes,
            tags
        FROM read_orc('s3://osm-pds/changesets/changesets-latest.orc')
        WHERE "user" IN ({users_sql})
          AND created_at >= DATE '{START_DATE}'
        ORDER BY created_at
    """

    print("Executing query...")
    result = conn.execute(query).fetchdf()

    print(f"Found {len(result)} changesets")

    if len(result) == 0:
        print("No changesets found. Check user names and date range.")
        return

    # Process the data
    print("Processing changesets...")

    # Calculate centroids and classify by city
    changesets = []
    for _, row in result.iterrows():
        if row['min_lon'] is not None and row['min_lat'] is not None:
            center_lon = (row['min_lon'] + row['max_lon']) / 2
            center_lat = (row['min_lat'] + row['max_lat']) / 2

            # Classify by city
            city = 'Other'
            for city_name, (cmin_lon, cmin_lat, cmax_lon, cmax_lat) in CITIES.items():
                if cmin_lon <= center_lon <= cmax_lon and cmin_lat <= center_lat <= cmax_lat:
                    city = city_name
                    break

            # Extract comment from tags if available
            comment = ''
            if row['tags'] is not None:
                tags_dict = dict(row['tags']) if hasattr(row['tags'], '__iter__') else {}
                comment = tags_dict.get('comment', '')

            changesets.append({
                'id': int(row['id']),
                'user': row['username'],
                'uid': int(row['uid']),
                'lon': float(center_lon),
                'lat': float(center_lat),
                'changes_count': int(row['num_changes']) if row['num_changes'] else 0,
                'city': city,
                'created_at': row['created_at'].isoformat() if hasattr(row['created_at'], 'isoformat') else str(row['created_at']),
                'comment': comment,
            })

    # Save raw changesets
    with open(output_dir / 'changesets.json', 'w') as f:
        json.dump(changesets, f, indent=2)

    # Create monthly aggregation
    print("Creating monthly aggregations...")
    monthly_data = {}
    for cs in changesets:
        # Parse month from created_at
        month_key = cs['created_at'][:7]  # YYYY-MM

        if month_key not in monthly_data:
            monthly_data[month_key] = []

        monthly_data[month_key].append({
            'id': cs['id'],
            'user': cs['user'],
            'lon': cs['lon'],
            'lat': cs['lat'],
            'changes_count': cs['changes_count'],
            'city': cs['city'],
            'created_at': cs['created_at'],
            'comment': cs['comment'],
        })

    # Save monthly data
    with open(output_dir / 'monthly_changesets.json', 'w') as f:
        json.dump(monthly_data, f, indent=2)

    # Save city definitions
    with open(output_dir / 'cities.json', 'w') as f:
        json.dump({
            name: {
                'bbox': list(bbox),
                'center': [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
            }
            for name, bbox in CITIES.items()
        }, f, indent=2)

    # Print summary
    print("\n" + "="*50)
    print("SUMMARY")
    print("="*50)
    print(f"Total changesets: {len(changesets)}")

    # User counts
    user_counts = {}
    for cs in changesets:
        user_counts[cs['user']] = user_counts.get(cs['user'], 0) + 1
    print(f"Users with data: {len(user_counts)}/{len(USERS)}")

    if changesets:
        print(f"Date range: {changesets[0]['created_at'][:10]} to {changesets[-1]['created_at'][:10]}")
    print(f"Months covered: {len(monthly_data)}")

    # City breakdown
    city_counts = {}
    for cs in changesets:
        city_counts[cs['city']] = city_counts.get(cs['city'], 0) + 1

    print("\nChangesets by city:")
    for city, count in sorted(city_counts.items(), key=lambda x: -x[1]):
        print(f"  {city}: {count}")

    # Top users
    print("\nTop 10 contributors:")
    for user, count in sorted(user_counts.items(), key=lambda x: -x[1])[:10]:
        print(f"  {user}: {count}")

    print(f"\nData saved to {output_dir}")

    conn.close()


if __name__ == '__main__':
    main()
