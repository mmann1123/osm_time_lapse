#!/usr/bin/env python3
"""
Fetch OSM changesets for specified users since 2024.
Uses the OSM API to download changeset metadata including bounding boxes.
"""

import requests
import json
import time
from datetime import datetime, timedelta
from pathlib import Path
import xml.etree.ElementTree as ET

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
    'London, UK': (-0.51, 51.28, 0.33, 51.69),
    'Manchester, UK': (-2.35, 53.35, -2.15, 53.55),
    'Naples, IT': (14.10, 40.78, 14.40, 40.95),
    'Brooklyn, NY': (-74.05, 40.57, -73.83, 40.74),
    'Atlanta, GA': (-84.55, 33.65, -84.29, 33.89),
    'Austin, TX': (-97.95, 30.10, -97.60, 30.50),
    'Phoenix, AZ': (-112.35, 33.27, -111.90, 33.70),
}

# Start date
START_DATE = '2024-01-01T00:00:00Z'

def fetch_user_changesets(username, start_time=START_DATE):
    """Fetch all changesets for a user since start_time."""
    changesets = []
    base_url = 'https://api.openstreetmap.org/api/0.6/changesets'

    # OSM API returns max 100 changesets per request
    params = {
        'display_name': username,
        'time': start_time,
    }

    print(f"Fetching changesets for {username}...")

    while True:
        try:
            response = requests.get(base_url, params=params, timeout=30)
            response.raise_for_status()

            # Parse XML response
            root = ET.fromstring(response.content)
            batch = []

            for cs in root.findall('changeset'):
                changeset = {
                    'id': int(cs.get('id')),
                    'user': cs.get('user'),
                    'uid': int(cs.get('uid')),
                    'created_at': cs.get('created_at'),
                    'closed_at': cs.get('closed_at'),
                    'open': cs.get('open') == 'true',
                    'changes_count': int(cs.get('changes_count', 0)),
                    'comments_count': int(cs.get('comments_count', 0)),
                }

                # Get bounding box if available
                if cs.get('min_lon'):
                    changeset['bbox'] = {
                        'min_lon': float(cs.get('min_lon')),
                        'min_lat': float(cs.get('min_lat')),
                        'max_lon': float(cs.get('max_lon')),
                        'max_lat': float(cs.get('max_lat')),
                    }
                    # Calculate centroid
                    changeset['center'] = {
                        'lon': (changeset['bbox']['min_lon'] + changeset['bbox']['max_lon']) / 2,
                        'lat': (changeset['bbox']['min_lat'] + changeset['bbox']['max_lat']) / 2,
                    }

                # Get tags (like comment)
                tags = {}
                for tag in cs.findall('tag'):
                    tags[tag.get('k')] = tag.get('v')
                if tags:
                    changeset['tags'] = tags

                batch.append(changeset)

            if not batch:
                break

            changesets.extend(batch)
            print(f"  Found {len(batch)} changesets (total: {len(changesets)})")

            # If we got less than 100, we're done
            if len(batch) < 100:
                break

            # Get the oldest changeset's created_at for pagination
            oldest = min(batch, key=lambda x: x['created_at'])
            params['time'] = f"{start_time},{oldest['created_at']}"

            # Rate limiting
            time.sleep(1)

        except requests.exceptions.RequestException as e:
            print(f"  Error fetching changesets for {username}: {e}")
            break

    return changesets


def classify_changeset_location(changeset):
    """Determine which city a changeset belongs to based on its center point."""
    if 'center' not in changeset:
        return None

    lon = changeset['center']['lon']
    lat = changeset['center']['lat']

    for city_name, (min_lon, min_lat, max_lon, max_lat) in CITIES.items():
        if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
            return city_name

    return 'Other'


def main():
    output_dir = Path(__file__).parent / 'data'
    output_dir.mkdir(exist_ok=True)

    all_changesets = []
    user_stats = {}

    for username in USERS:
        changesets = fetch_user_changesets(username)
        user_stats[username] = len(changesets)

        # Classify each changeset by location
        for cs in changesets:
            cs['city'] = classify_changeset_location(cs)

        all_changesets.extend(changesets)

        # Rate limiting between users
        time.sleep(2)

    # Sort by created_at
    all_changesets.sort(key=lambda x: x['created_at'])

    # Save raw data
    with open(output_dir / 'changesets.json', 'w') as f:
        json.dump(all_changesets, f, indent=2)

    # Create weekly aggregation
    weekly_data = {}
    for cs in all_changesets:
        if 'center' not in cs:
            continue

        # Parse week (ISO week starting on Monday)
        created_at = datetime.fromisoformat(cs['created_at'].replace('Z', '+00:00'))
        # Get the Monday of the week
        week_start = created_at - timedelta(days=created_at.weekday())
        week_key = week_start.strftime('%Y-%m-%d')

        if week_key not in weekly_data:
            weekly_data[week_key] = []

        weekly_data[week_key].append({
            'id': cs['id'],
            'user': cs['user'],
            'lon': cs['center']['lon'],
            'lat': cs['center']['lat'],
            'changes_count': cs['changes_count'],
            'city': cs.get('city'),
            'created_at': cs['created_at'],
            'comment': cs.get('tags', {}).get('comment', ''),
        })

    # Save weekly data
    with open(output_dir / 'weekly_changesets.json', 'w') as f:
        json.dump(weekly_data, f, indent=2)

    # Save city definitions
    with open(output_dir / 'cities.json', 'w') as f:
        json.dump({
            name: {
                'bbox': bbox,
                'center': [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
            }
            for name, bbox in CITIES.items()
        }, f, indent=2)

    # Print summary
    print("\n" + "="*50)
    print("SUMMARY")
    print("="*50)
    print(f"Total changesets: {len(all_changesets)}")
    print(f"Users with data: {sum(1 for v in user_stats.values() if v > 0)}/{len(USERS)}")
    print(f"Date range: {all_changesets[0]['created_at'][:10] if all_changesets else 'N/A'} to {all_changesets[-1]['created_at'][:10] if all_changesets else 'N/A'}")
    print(f"Weeks covered: {len(weekly_data)}")

    # City breakdown
    city_counts = {}
    for cs in all_changesets:
        city = cs.get('city', 'Unknown')
        city_counts[city] = city_counts.get(city, 0) + 1

    print("\nChangesets by city:")
    for city, count in sorted(city_counts.items(), key=lambda x: -x[1]):
        print(f"  {city}: {count}")

    print(f"\nData saved to {output_dir}")

    return all_changesets


if __name__ == '__main__':
    main()
