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
    'Naples, IT': {
        bbox: [14.10, 40.78, 14.40, 40.95],
        center: [40.865, 14.25]
    },
    'Brooklyn, NY': {
        bbox: [-74.05, 40.57, -73.83, 40.74],
        center: [40.655, -73.94]
    },
    'Phoenix, AZ': {
        bbox: [-112.35, 33.27, -111.90, 33.70],
        center: [33.485, -112.125]
    }
};

// Application state
let monthlyData = {};
let allMonths = [];  // All months in the dataset
let filteredMonths = [];  // Months filtered by city
let currentMonthIndex = 0;
let isPlaying = false;
let playInterval = null;
let playSpeed = 1000;
let selectedCity = 'all';
let showCumulative = false;
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
        const response = await fetch('data/monthly_changesets.json');
        if (!response.ok) {
            throw new Error('Data not found. Please run fetch_changesets.py first.');
        }
        monthlyData = await response.json();
        allMonths = Object.keys(monthlyData).sort();

        if (allMonths.length === 0) {
            throw new Error('No changeset data found.');
        }

        initializeUI();
        updateFilteredMonths();  // Apply initial filter for 100+ edits
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

            // Filter months to only those with data for the selected city
            updateFilteredMonths();
            updateDisplay();
        });
    });

    // Timeline slider
    const slider = document.getElementById('timeline-slider');
    slider.max = filteredMonths.length - 1;
    slider.addEventListener('input', (e) => {
        currentMonthIndex = parseInt(e.target.value);
        updateDisplay();
    });

    // Playback controls
    document.getElementById('play-btn').addEventListener('click', togglePlay);
    document.getElementById('prev-btn').addEventListener('click', () => {
        if (currentMonthIndex > 0) {
            currentMonthIndex--;
            updateDisplay();
        }
    });
    document.getElementById('next-btn').addEventListener('click', () => {
        if (currentMonthIndex < filteredMonths.length - 1) {
            currentMonthIndex++;
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

// Update filtered months based on selected city
function updateFilteredMonths() {
    const MIN_EDITS = 100;

    if (selectedCity === 'all') {
        // Filter to months with at least MIN_EDITS total
        filteredMonths = allMonths.filter(month => {
            const changesets = monthlyData[month] || [];
            const totalEdits = changesets.reduce((sum, cs) => sum + cs.changes_count, 0);
            return totalEdits >= MIN_EDITS;
        });
    } else {
        // Filter to only months that have at least MIN_EDITS in the selected city
        filteredMonths = allMonths.filter(month => {
            const changesets = monthlyData[month] || [];
            const cityChangesets = changesets.filter(cs => isInCity(cs.lon, cs.lat, selectedCity));
            const totalEdits = cityChangesets.reduce((sum, cs) => sum + cs.changes_count, 0);
            return totalEdits >= MIN_EDITS;
        });
    }

    // Reset to first month if current index is out of bounds
    if (currentMonthIndex >= filteredMonths.length) {
        currentMonthIndex = 0;
    }

    // Update slider max
    const slider = document.getElementById('timeline-slider');
    slider.max = Math.max(0, filteredMonths.length - 1);
}

// Start playback
function startPlayback() {
    isPlaying = true;
    document.getElementById('play-btn').textContent = 'Pause';

    playInterval = setInterval(() => {
        if (currentMonthIndex < filteredMonths.length - 1) {
            currentMonthIndex++;
            updateDisplay();
        } else {
            stopPlayback();
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
        if (currentMonthIndex >= filteredMonths.length - 1) {
            currentMonthIndex = 0;
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
    if (filteredMonths.length === 0) {
        document.getElementById('month-display').textContent = 'No data';
        document.getElementById('stat-changesets').textContent = '0';
        document.getElementById('stat-edits').textContent = '0';
        document.getElementById('stat-users').textContent = '0';
        document.getElementById('user-list').innerHTML = '';
        markersLayer.clearLayers();
        return;
    }

    const currentMonth = filteredMonths[currentMonthIndex];

    // Update month display
    const monthDate = new Date(currentMonth + '-01');
    const monthName = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('month-display').textContent = monthName;
    document.getElementById('timeline-slider').value = currentMonthIndex;

    // Get changesets to display
    let changesets = [];
    if (showCumulative) {
        // Get all changesets up to current month
        for (let i = 0; i <= currentMonthIndex; i++) {
            if (monthlyData[filteredMonths[i]]) {
                changesets = changesets.concat(monthlyData[filteredMonths[i]]);
            }
        }
    } else {
        changesets = monthlyData[currentMonth] || [];
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
            opacity: 0.8,
            fillOpacity: 0.7
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
