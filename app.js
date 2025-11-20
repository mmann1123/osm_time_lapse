// OSM Time Lapse Application

// City definitions with bounding boxes and centers
const CITIES = {
    'Rome, IT': {
        bbox: [12.23, 41.65, 12.85, 42.10],
        center: [41.875, 12.54]
    },
    'London, UK': {
        bbox: [-0.51, 51.28, 0.33, 51.69],
        center: [51.485, -0.09]
    },
    'Manchester, UK': {
        bbox: [-2.35, 53.35, -2.15, 53.55],
        center: [53.45, -2.25]
    },
    'Naples, IT': {
        bbox: [14.10, 40.78, 14.40, 40.95],
        center: [40.865, 14.25]
    },
    'Brooklyn, NY': {
        bbox: [-74.05, 40.57, -73.83, 40.74],
        center: [40.655, -73.94]
    },
    'Atlanta, GA': {
        bbox: [-84.55, 33.65, -84.29, 33.89],
        center: [33.77, -84.42]
    },
    'Austin, TX': {
        bbox: [-97.95, 30.10, -97.60, 30.50],
        center: [30.30, -97.75]
    },
    'Phoenix, AZ': {
        bbox: [-112.35, 33.27, -111.90, 33.70],
        center: [33.485, -112.125]
    }
};

// Application state
let weeklyData = {};
let allWeeks = [];  // All weeks in the dataset
let filteredWeeks = [];  // Weeks filtered by city
let currentWeekIndex = 0;
let isPlaying = false;
let playInterval = null;
let playSpeed = 500;  // Default to 0.5s (500ms)
let selectedCity = 'all';
let showCumulative = true;  // Default to cumulative view
let map = null;
let markersLayer = null;

// Initialize the map
function initMap() {
    map = L.map('map', {
        center: [40, -40],
        zoom: 3,
        zoomControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
}

// Load data from JSON files
async function loadData() {
    try {
        const response = await fetch('data/weekly_changesets.json');
        if (!response.ok) {
            throw new Error('Data not found. Please run fetch_changesets.py first.');
        }
        weeklyData = await response.json();
        allWeeks = Object.keys(weeklyData).sort();

        if (allWeeks.length === 0) {
            throw new Error('No changeset data found.');
        }

        initializeUI();
        updateFilteredWeeks();  // Apply initial filter for 100+ edits
        updateDisplay();
        document.getElementById('loading').style.display = 'none';
    } catch (error) {
        document.getElementById('loading').innerHTML = `
            <div style="color: #e94560;">Error: ${error.message}</div>
            <div style="margin-top: 1rem; font-size: 0.85rem;">
                Run <code>python fetch_changesets.py</code> to download data.
            </div>
        `;
    }
}

// Initialize UI elements
function initializeUI() {
    // Set up city buttons
    const cityButtonsContainer = document.getElementById('city-buttons');
    Object.keys(CITIES).forEach(city => {
        const btn = document.createElement('button');
        btn.className = 'city-btn';
        btn.dataset.city = city;
        btn.textContent = city.split(',')[0];
        cityButtonsContainer.appendChild(btn);
    });

    // City button click handlers
    document.querySelectorAll('.city-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.city-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedCity = btn.dataset.city;

            if (selectedCity !== 'all' && CITIES[selectedCity]) {
                const city = CITIES[selectedCity];
                map.flyTo(city.center, 11);
            } else {
                map.flyTo([40, -40], 3);
            }

            // Filter weeks to only those with data for the selected city
            updateFilteredWeeks();
            updateDisplay();

            // Auto-play when selecting a city
            if (selectedCity !== 'all' && !isPlaying) {
                currentWeekIndex = 0;  // Start from the beginning
                updateDisplay();
                setTimeout(() => startPlayback(), 500);  // Small delay for map animation
            }
        });
    });

    // Timeline slider
    const slider = document.getElementById('timeline-slider');
    slider.max = filteredWeeks.length - 1;
    slider.addEventListener('input', (e) => {
        currentWeekIndex = parseInt(e.target.value);
        updateDisplay();
    });

    // Playback controls
    document.getElementById('play-btn').addEventListener('click', togglePlay);
    document.getElementById('prev-btn').addEventListener('click', () => {
        if (currentWeekIndex > 0) {
            currentWeekIndex--;
            updateDisplay();
        }
    });
    document.getElementById('next-btn').addEventListener('click', () => {
        if (currentWeekIndex < filteredWeeks.length - 1) {
            currentWeekIndex++;
            updateDisplay();
        }
    });

    // Speed control
    document.getElementById('speed-select').addEventListener('change', (e) => {
        playSpeed = parseInt(e.target.value);
        if (isPlaying) {
            stopPlayback();
            startPlayback();
        }
    });

    // Cumulative toggle
    document.getElementById('cumulative-check').addEventListener('change', (e) => {
        showCumulative = e.target.checked;
        updateDisplay();
    });
}

// Update filtered weeks based on selected city
function updateFilteredWeeks() {
    const MIN_EDITS = 100;

    if (selectedCity === 'all') {
        // Filter to weeks with at least MIN_EDITS total
        filteredWeeks = allWeeks.filter(week => {
            const changesets = weeklyData[week] || [];
            const totalEdits = changesets.reduce((sum, cs) => sum + cs.changes_count, 0);
            return totalEdits >= MIN_EDITS;
        });
    } else {
        // Filter to only weeks that have at least MIN_EDITS in the selected city
        filteredWeeks = allWeeks.filter(week => {
            const changesets = weeklyData[week] || [];
            const cityChangesets = changesets.filter(cs => isInCity(cs.lon, cs.lat, selectedCity));
            const totalEdits = cityChangesets.reduce((sum, cs) => sum + cs.changes_count, 0);
            return totalEdits >= MIN_EDITS;
        });
    }

    // Reset to first week if current index is out of bounds
    if (currentWeekIndex >= filteredWeeks.length) {
        currentWeekIndex = 0;
    }

    // Update slider max
    const slider = document.getElementById('timeline-slider');
    slider.max = Math.max(0, filteredWeeks.length - 1);
}

// Start playback
function startPlayback() {
    isPlaying = true;
    document.getElementById('play-btn').textContent = 'Pause';

    playInterval = setInterval(() => {
        if (currentWeekIndex < filteredWeeks.length - 1) {
            currentWeekIndex++;
            updateDisplay();
        } else {
            // Loop back to the beginning
            currentWeekIndex = 0;
            updateDisplay();
        }
    }, playSpeed);
}

// Stop playback
function stopPlayback() {
    isPlaying = false;
    document.getElementById('play-btn').textContent = 'Play';
    if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
    }
}

// Toggle playback
function togglePlay() {
    if (isPlaying) {
        stopPlayback();
    } else {
        if (currentWeekIndex >= filteredWeeks.length - 1) {
            currentWeekIndex = 0;
        }
        startPlayback();
    }
}

// Get color based on edit count
function getColor(editCount) {
    if (editCount > 100) return '#ff0000';
    if (editCount > 50) return '#ff8800';
    if (editCount > 10) return '#ffff00';
    return '#00ff88';
}

// Get radius based on edit count
function getRadius(editCount) {
    if (editCount > 100) return 12;
    if (editCount > 50) return 9;
    if (editCount > 10) return 6;
    return 4;
}

// Check if a point is within a city's bounding box
function isInCity(lon, lat, cityName) {
    if (cityName === 'all') return true;
    if (!CITIES[cityName]) return false;

    const bbox = CITIES[cityName].bbox;
    return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

// Update the display
function updateDisplay() {
    if (filteredWeeks.length === 0) {
        document.getElementById('month-display').textContent = 'No data';
        document.getElementById('stat-changesets').textContent = '0';
        document.getElementById('stat-edits').textContent = '0';
        document.getElementById('stat-users').textContent = '0';
        document.getElementById('user-list').innerHTML = '';
        markersLayer.clearLayers();
        return;
    }

    const currentWeek = filteredWeeks[currentWeekIndex];

    // Update week display
    const weekDate = new Date(currentWeek);
    const weekDisplay = weekDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('month-display').textContent = 'Week of ' + weekDisplay;
    document.getElementById('timeline-slider').value = currentWeekIndex;

    // Get changesets to display
    let changesets = [];
    if (showCumulative) {
        // Get all changesets up to current week
        for (let i = 0; i <= currentWeekIndex; i++) {
            if (weeklyData[filteredWeeks[i]]) {
                changesets = changesets.concat(weeklyData[filteredWeeks[i]]);
            }
        }
    } else {
        changesets = weeklyData[currentWeek] || [];
    }

    // Filter by city
    if (selectedCity !== 'all') {
        changesets = changesets.filter(cs => isInCity(cs.lon, cs.lat, selectedCity));
    }

    // Clear existing markers
    markersLayer.clearLayers();

    // Add markers
    const userCounts = {};
    let totalEdits = 0;

    changesets.forEach(cs => {
        const color = getColor(cs.changes_count);
        const radius = getRadius(cs.changes_count);

        const marker = L.circleMarker([cs.lat, cs.lon], {
            radius: radius,
            fillColor: color,
            color: '#fff',
            weight: 1,
            opacity: 0.3,
            fillOpacity: 0.4
        });

        marker.bindPopup(`
            <strong>${cs.user}</strong><br>
            Edits: ${cs.changes_count}<br>
            ${cs.comment ? `Comment: ${cs.comment}<br>` : ''}
            Date: ${new Date(cs.created_at).toLocaleDateString()}<br>
            <a href="https://www.openstreetmap.org/changeset/${cs.id}" target="_blank">View on OSM</a>
        `);

        markersLayer.addLayer(marker);

        // Update stats
        userCounts[cs.user] = (userCounts[cs.user] || 0) + cs.changes_count;
        totalEdits += cs.changes_count;
    });

    // Update stats display
    document.getElementById('stat-changesets').textContent = changesets.length.toLocaleString();
    document.getElementById('stat-edits').textContent = totalEdits.toLocaleString();
    document.getElementById('stat-users').textContent = Object.keys(userCounts).length;

    // Update user list
    const userList = document.getElementById('user-list');
    const sortedUsers = Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

    userList.innerHTML = sortedUsers.map(([user, count]) => `
        <div class="user-item">
            <span>${user}</span>
            <span>${count.toLocaleString()}</span>
        </div>
    `).join('');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadData();
});
