import {LitElement, html, css} from 'lit';
import {map} from 'lit-html/directives/map.js';
import * as maplibregl from 'maplibre-gl';
import {
    Tabulator,
    EditModule,
    FormatModule,
    InteractionModule,
    MutatorModule,
    ResizeColumnsModule,
    ResizeTableModule,
    SortModule,
    SelectRowModule,
    FilterModule,
    GroupRowsModule
} from 'tabulator-tables';

Tabulator.registerModule([
    EditModule,
    FormatModule,
    InteractionModule,
    MutatorModule,
    ResizeColumnsModule,
    ResizeTableModule,
    SortModule,
    SelectRowModule,
    FilterModule,
    GroupRowsModule
]);

import {ExpirationChart} from "./ExpirationChart.js";
import {MeasurerStats} from "./MeasurerStats.js";
import {FrameControl} from "./FrameControl.js";
import {CoordinateOverlayControl} from "./CoordinateOverlayControl.js";


/**
 * Convert a map feature to HTML description for the popup
 */
function featureToDescription(feature, line) {
    const properties = feature.properties;
    let expiredText = ""
    if (properties.expired) {
        expiredText = "(Expired)";
    }
    return `
<h6 class="float-end">${properties.courseLength}${properties.units}</h6>
    <h5 class="lh-1">${properties.name} <span class="text-secondary"> ${expiredText}</span></h5>
    
    <div class="lh-1 d-flex flex-column gap-1">
      <a href="${properties.certificateLink}" target="_blank" data-goatcounter-click="ext-cert-${properties.certificateId}">${properties.certificateId}</a>
      ${properties.city}, ${properties.state}<br>
      Measurer: ${properties.measurer}<br>
      ${line ? `Coords: <br>${line.geometry.coordinates[0][1].toPrecision(9)}, ${line.geometry.coordinates[0][0].toPrecision(9)}<br>${line.geometry.coordinates[1][1].toPrecision(9)}, ${line.geometry.coordinates[1][0].toPrecision(9)} <br>` : ''}
      <div class="d-flex flex-row gap-2">
      ${properties.approximate ? "<span class='text-danger'>Location Approximate</span>" : 
            `<a href="https://www.google.com/maps/place/${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}">
        Google Maps
      </a>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}&travelmode=driving">
        Directions
      </a>`
    }
     </div>
     </div>
  `;
}

const COUNTRY_NAMES = {
    US: "United States",
    CA: "Canada",
    BS: "Bahamas",
    BM: "Bermuda",
    IN: "India",
    JM: "Jamaica",
    KR: "South Korea"
};

function escapeHtml(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML;
}

 function formatDisplacement(distanceMeters) {
    return distanceMeters < 1000
        ? `${distanceMeters} m`
        : `${(distanceMeters / 1000).toFixed(1)} km`;
}

function reviewFeatureToDescription(feature) {
    const properties = feature.properties;
    const proposed = feature.geometry.type === 'Point'
        ? feature.geometry.coordinates
        : properties.reviewCoordinates;
    const original = typeof properties.originalCoordinates === 'string'
        ? JSON.parse(properties.originalCoordinates)
        : properties.originalCoordinates;
    const displacement = formatDisplacement(properties.distanceMeters);
    const proposedLabel = feature.geometry.type === 'Point' ? 'Proposed' : 'Line midpoint';
    const status = properties.reviewStatus === 'accepted' ? 'Accepted' : 'Pending review';
    return `
      <h5>${escapeHtml(properties.name)}</h5>
      <div class="d-flex flex-column gap-1">
        <a href="${properties.certificateLink}" target="_blank">${properties.certificateId}</a>
        <span>${escapeHtml(properties.city)}, ${escapeHtml(properties.state)}</span>
        <span><strong>${status}</strong> · ${escapeHtml(properties.confidence)} confidence · moved ${displacement}</span>
        <span>Original: ${original[1].toFixed(6)}, ${original[0].toFixed(6)}</span>
        <span>${proposedLabel}: ${proposed[1].toFixed(6)}, ${proposed[0].toFixed(6)}</span>
        <p class="mb-0 mt-1">${escapeHtml(properties.evidence)}</p>
      </div>`;
}

export class CoursesView extends LitElement {
    static styles = css`
        courses-view {
            display: block;
        }

        .view-container {
            height: 100%;
            width: 100%;
        }

        .controls {
            display: flex;
            gap: 1rem;
            padding: 1rem;
            background-color: #f8f9fa;
            border-bottom: 1px solid #dee2e6;
        }

        .select-container {
            display: flex;
            flex-direction: column;
            flex: 1;
        }

        select {
            padding: 0.5rem;
            border-radius: 4px;
            border: 1px solid #ced4da;
        }


        .maplibregl-map {
            height: 100%;
        }

        #courses-table .tabulator-row.tabulator-group {
            position: sticky;
            top: 0;
            z-index: 3;
        }

        .course-popup {
            max-width: 300px;
        }

        .review-popup.maplibregl-popup .maplibregl-popup-content {
            max-height: min(70vh, 420px);
            overflow-y: auto;
        }

        .filter-bar {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: .6rem 1rem;
            padding: .75rem;
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: .375rem;
        }

        .filter-bar > .input-group {
            width: auto;
            flex: 1 1 15rem;
        }

        .map-legend {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: .35rem 1rem;
            flex: 1 1 100%;
            padding-top: .55rem;
            border-top: 1px solid #dee2e6;
            color: #495057;
            font-size: .875rem;
        }

        .map-legend-title {
            color: #212529;
            font-weight: 600;
        }

        .map-legend-toggle {
            display: inline-flex;
            align-items: center;
            white-space: nowrap;
            padding: .25rem .5rem;
            border: 1px solid #adb5bd;
            border-radius: 999px;
            background: #fff;
            color: inherit;
            cursor: pointer;
        }

        .map-legend-toggle:hover {
            background: #e9ecef;
        }

        .map-legend-toggle[aria-pressed="false"] {
            opacity: .48;
            text-decoration: line-through;
        }

        .map-legend-label {
            display: inline-flex;
            align-items: center;
            white-space: nowrap;
            padding: .25rem .5rem;
            color: #6c757d;
        }

        .map-legend .course-circle,
        .map-legend .course-circle-outline,
        .map-legend .course-expired {
            width: 14px;
            height: 14px;
            margin-right: 5px;
        }

        .map-legend .course-expired::before {
            font-size: 10px;
        }

        .course-line-key {
            display: inline-block;
            width: 20px;
            border-top: 3px solid #AB2129;
            margin-right: 5px;
        }

        @media (max-width: 575.98px) {
            .filter-bar,
            #map,
            #courses-table {
                margin-left: calc(var(--bs-gutter-x, 1.5rem) * -.5);
                margin-right: calc(var(--bs-gutter-x, 1.5rem) * -.5);
                border-radius: 0;
            }

            #map {
                width: auto;
            }

            .filter-bar,
            #courses-table {
                border-left: 0;
                border-right: 0;
            }
        }

        /* Break out of the container's max-width, but keep the page gutter */
        @media (min-width: 576px) and (max-width: 991.98px) {
            .filter-bar,
            #map,
            #courses-table {
                margin-left: calc(50% - 50vw + var(--bs-gutter-x, 1.5rem) * .5);
                margin-right: calc(50% - 50vw + var(--bs-gutter-x, 1.5rem) * .5);
            }

            #map {
                width: auto;
            }
        }

    `;

    static properties = {
        coursesUrl: {type: String},
        courseLinesUrl: {type: String},
        reviewUrl: {type: String},
        styleUrl: {type: String},
        initialCenter: {type: Array},
        calibrationCourses: {type: Array, state: true},
        filteredCourses: {type: Array, state: true},
        countries: {type: Array, state: true},
        states: {type: Array, state: true},
        locations: {type: Array, state: true},
        features: {type: Array, state: true},
        mapLoaded: {type: Boolean, state: true},
        filters: {type: Array, state: true},
        headerFilters: {type: Array, state: true},
        sorts: {type: Array, state: true},
        openCourse: {type: String, state: true},
        approximateOnly: {type: Boolean, state: true},
        locationReviewEnabled: {type: Boolean, state: true},
        linesOnly: {type: Boolean, state: true},
        reviewMode: {type: Boolean, state: true},
        reviewData: {type: Array, state: true},
        showProposedReviews: {type: Boolean, state: true},
        showAcceptedReviews: {type: Boolean, state: true},
        showStreetLocations: {type: Boolean, state: true},
        showApproximateLocations: {type: Boolean, state: true},
        showExpiredCourses: {type: Boolean, state: true},
        dataLoading: {type: Boolean, state: true},
        geolocationCoordinates: {type: Array, state: true},
        isGeolocationEnabled: {type: Boolean, state: true},
        selectedCountry: {type: String, state: true},
        selectedState: {type: String, state: true},
        selectedLocation: {type: String, state: true}
    };

    constructor() {
        super();
        this.calibrationCourses = null;
        this.calibrationCourseLines = null;
        this.reviewData = [];
        this.reviewMode = false;
        this.showProposedReviews = true;
        this.showAcceptedReviews = true;
        this.locationReviewEnabled = false;
        this.linesOnly = false;
        this.showStreetLocations = true;
        this.showApproximateLocations = true;
        this.showExpiredCourses = true;
        this.countries = [];
        this.states = [];
        this.stateCountry = {};
        this.cityStates = {};
        this.filters = [];
        this.headerFilters = [];
        this.filteredCourses = [];
        this.sorts = [{column: "properties.city", dir: "asc"},
            {column: "properties.state", dir: "asc"}];
        this.locations = [];
        this.mapLoaded = false;
        this.openCourse = undefined;
        this.dataLoading = true;
        this.dataLoadingPromise = new Promise(resolve => {
            this.dataLoadingResolve = resolve;
        });
        this.tableLoadingPromise = new Promise(resolve => {
            this.tableLoadingResolve = resolve;
        });
        this.mapLoadingPromise = new Promise(resolve => {
            this.mapLoadingResolve = resolve;
        });
        this.tableContainer = document.createElement("div")
        this.tableContainer.id = "courses-table";
        this.tableContainer.classList.add("table-sm")
        this.geolocationCoordinates = null;
        this.selectedCountry = "";
        this.selectedState = "";
        this.selectedLocation = "";
    }

    createRenderRoot() {
        // LightDOM
        return this;
    }

    connectedCallback() {
        super.connectedCallback()
        const urlParams = new URLSearchParams(window.location.search);
        this.locationReviewEnabled = urlParams.get('locationReview') === 'true';
        this.reviewMode = this.locationReviewEnabled;
        this.showProposedReviews = urlParams.get('showProposed') !== 'false';
        this.showAcceptedReviews = urlParams.get('showAccepted') !== 'false';
        this.linesOnly = urlParams.get('linesOnly') === 'true';

        const savedSorts = JSON.parse(sessionStorage.getItem('tableSorts'));
        if (savedSorts) {
            this.sorts = savedSorts;
        }
        const savedFilters = JSON.parse(sessionStorage.getItem('tableFilters'));
        if (savedFilters) {
            this.filters = savedFilters;
        }
        const savedHeaderFilters = JSON.parse(sessionStorage.getItem('tableHeaderFilters'));
        if (savedHeaderFilters) {
            this.headerFilters = savedHeaderFilters;
        }
        const urlHash = location.hash;
        if (urlHash) {
            this.openCourse = urlHash.substring(1);
        }

        this.loadData().then(() => {
            this.dataLoadingResolve(true);
            this.dataLoading = false;
        });
        window.addEventListener("hashchange", () => {
            const urlHash = location.hash;
            if (urlHash !== this.openCourse) {
                this.openCourse = urlHash.substring(1);
            }
        })
        const approximateOnly = urlParams.get('approximateOnly');
        if (approximateOnly) {
            this.approximateOnly = approximateOnly === 'true';
            this.filters = this.filters.filter(filter => filter.field !== "properties.approximate");
            this.filters.push({field: "properties.approximate", type: "=", value: true});
        } else {
            this.approximateOnly = false;
            this.filters = this.filters.filter(filter => filter.field !== "properties.approximate");
        }
        this.filters = this.filters.filter(filter =>
            filter.field !== "properties.hasLine" && filter.field !== "properties.expired"
        );
        if (this.linesOnly) {
            this.filters.push({field: "properties.hasLine", type: "=", value: true});
        }
    }

    firstUpdated() {
        // These need the DOM to be fully initialized, which happens sometime after connectedCallback (DOM connection)
        this.initializeMap();
        this.initializeTable();
        Promise.all([this.tableLoadingPromise, this.dataLoadingPromise]).then(() => {
            this.table.replaceData(this.calibrationCourses)
        })
        Promise.all([this.mapLoadingPromise, this.tableLoadingPromise, this.dataLoadingPromise]).then(() => {
          this.matchMapToTableData(this.table.getRows("active"))
        })

    }

    async loadData() {
        try {
            const [coursesResponse, courseLinesResponse, reviewResponse] = await Promise.all([
                fetch(this.coursesUrl),
                fetch(this.courseLinesUrl),
                this.locationReviewEnabled && this.reviewUrl ? fetch(this.reviewUrl) : Promise.resolve(null)
            ]);

            if (!coursesResponse.ok) {
                throw new Error(`Failed to fetch course data: ${coursesResponse.status} ${coursesResponse.statusText}`);
            }

            if (!courseLinesResponse.ok) {
                throw new Error(`Failed to fetch course lines data: ${courseLinesResponse.status} ${courseLinesResponse.statusText}`);
            }

            const [coursesData, courseLinesData, reviewData] = await Promise.all([
                coursesResponse.json(),
                courseLinesResponse.json(),
                reviewResponse?.ok ? reviewResponse.json() : Promise.resolve({features: []})
            ]);

            this.calibrationCourses = coursesData.features;
            this.calibrationCourseLines = courseLinesData.features;
            this.reviewData = reviewData.features;

            this.processData();
        } catch (error) {
            console.error('Error loading calibration courses data:', error);
            this.renderError(error);
        } finally {
            this.filteredCourses = this.calibrationCourses;
            this.dataLoading = false;
        }
    }

    processData() {
        const countriesSet = new Set();
        const statesSet = new Set();
        const locationsSet = new Set();
        const stateCountry = {};
        const cityStates = {};
        const currentYear = new Date().getFullYear();
        const coursesWithLines = new Set(
            this.calibrationCourseLines.map(line => line.properties.certificateId)
        );

        for (const [id, course] of Object.entries(this.calibrationCourses)) {
            // Extract state and location information for dropdowns
            const properties = course.properties;
            if (properties.country) {
                countriesSet.add(properties.country);
            }
            if (properties.state) {
                statesSet.add(properties.state);
                if (properties.country) {
                    stateCountry[properties.state] = properties.country;
                }
            }

            if (properties.city) {
                locationsSet.add(properties.city);
                if (properties.state) {
                    (cityStates[properties.city] ??= new Set()).add(properties.state);
                }
            }

            // Prefer a server-computed year (all new data, US and Canadian).
            // Otherwise fall back to parsing it out of the certificateId:
            // US-style ids start with letters then a 2-digit year (AK13003FW),
            // Canadian ids start with a province code then a 4-digit year (ON-2025-017-LJJL).
            let courseYear = properties.year;
            if (courseYear == null) {
                const usYearMatch = properties.certificateId.match(/^[A-Za-z]+(\d{2})/);
                if (usYearMatch && usYearMatch[1]) {
                    courseYear = parseInt("20" + usYearMatch[1]);
                } else {
                    const caYearMatch = properties.certificateId.match(/^[A-Z]{2}-(\d{4})-/);
                    if (caYearMatch && caYearMatch[1]) {
                        courseYear = parseInt(caYearMatch[1]);
                    } else {
                        // Handle the case where no matching pattern is found
                        console.warn("Could not extract year from certificateId:", properties.certificateId);
                    }
                }
            }
            if (courseYear != null) {
                course.properties.year = courseYear;
                course.properties.expired = currentYear > (properties.expires ?? courseYear + 10);
            }
            course.properties.courseLengthMeters = course.properties.courseLength
            if (course.properties.units === "ft") {
                course.properties.courseLengthMeters = course.properties.courseLength * .3048
            }
            course.properties.hasLine = coursesWithLines.has(properties.certificateId);
        }

        this.countries = [...countriesSet].sort();
        this.states = [...statesSet].sort();
        this.stateCountry = stateCountry;
        this.cityStates = cityStates;
        this.locations = [...locationsSet].sort();
    }

    initializeMap() {
        // Get saved map state or use defaults
        const center = sessionStorage.getItem('mapCenter')
            ? JSON.parse(sessionStorage.getItem('mapCenter'))
            : this.initialCenter;

        const zoom = Number(sessionStorage.getItem('mapZoom')) || 2;
        const pitch = Number(sessionStorage.getItem('mapPitch')) || 0;
        const bearing = Number(sessionStorage.getItem('mapBearing')) || 0;

        this.map = new maplibregl.Map({
            container: this.querySelector('#map'),
            style: this.styleUrl,
            center,
            zoom,
            pitch,
            bearing,
            maxZoom: 18
        });

        this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
        this.map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        const coordinateOverlay = new CoordinateOverlayControl(()=> {
            return this.geolocationCoordinates
        })
        this.map.addControl(coordinateOverlay, 'bottom-left');
        const geolocateControl = new maplibregl.GeolocateControl({
            positionOptions: {enableHighAccuracy: true},
            trackUserLocation: true
        })
        this.map.addControl(geolocateControl, 'top-right');

        this.frameControl = new FrameControl();
        this.map.addControl(this.frameControl);

        // Set up event listeners after map loads
        this.map.on('load', () => {
            // Create popup for displaying course information
            this.popup = new maplibregl.Popup({
                closeButton: true,
                closeOnClick: false,
                className: 'course-popup',
                focusAfterOpen: false,
                offset: 12,
                anchor: 'left'
            });
            this.popup.on("close", () => {
                this.openCourse = undefined;
            })

            // Separate popup for review proposals: evidence text can be long, so this one
            // scrolls internally (see .review-popup CSS) and lets maplibre auto-pick an anchor
            // that keeps it inside the map instead of the fixed left anchor used for course popups.
            this.reviewPopup = new maplibregl.Popup({
                closeButton: true,
                closeOnClick: false,
                className: 'course-popup review-popup',
                focusAfterOpen: false,
                maxWidth: '320px'
            });

            const pointLayerIds = ['overview-point', 'unclustered-point'];

            this.map.addSource('location-review', {
                type: 'geojson',
                data: {type: 'FeatureCollection', features: []}
            });
            this.map.addLayer({
                id: 'location-review-connectors',
                type: 'line',
                source: 'location-review',
                filter: ['==', ['get', 'role'], 'connector'],
                paint: {
                    'line-color': '#F59E0B',
                    'line-width': 2,
                    'line-dasharray': [2, 2],
                    'line-opacity': 0.85
                }
            });
            this.map.addLayer({
                id: 'location-review-proposal-lines',
                type: 'line',
                source: 'location-review',
                filter: ['all', ['==', ['get', 'role'], 'review'], ['==', ['geometry-type'], 'LineString']],
                paint: {
                    'line-color': ['match', ['get', 'reviewStatus'], 'accepted', '#198754', '#087EA4'],
                    'line-width': 4,
                    'line-opacity': 0.9
                }
            });
            this.map.addLayer({
                id: 'location-review-proposals',
                type: 'circle',
                source: 'location-review',
                filter: ['==', ['get', 'role'], 'review'],
                paint: {
                    'circle-color': ['match', ['get', 'reviewStatus'], 'accepted', '#198754', '#087EA4'],
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 10, 7],
                    'circle-stroke-color': '#FFFFFF',
                    'circle-stroke-width': 2
                }
            });

            const reviewProposalLayerIds = ['location-review-proposals', 'location-review-proposal-lines'];
            reviewProposalLayerIds.forEach(layerId => this.map.on('mouseenter', layerId, () => {
                this.map.getCanvas().style.cursor = 'pointer';
            }));
            reviewProposalLayerIds.forEach(layerId => this.map.on('mouseleave', layerId, () => {
                this.map.getCanvas().style.cursor = '';
            }));
            const showReviewProposal = (e) => {
                const feature = e.features[0];
                const popupNode = document.createElement('div');
                popupNode.className = 'course-popup';
                popupNode.innerHTML = reviewFeatureToDescription(feature);
                this.reviewPopup
                    .setLngLat(feature.geometry.type === 'Point'
                        ? feature.geometry.coordinates
                        : feature.properties.reviewCoordinates)
                    .setDOMContent(popupNode)
                    .addTo(this.map);
            };
            reviewProposalLayerIds.forEach(layerId => this.map.on('click', layerId, showReviewProposal));

            // Show popup on hover
            const showPointPopup = (e) => {
                this.map.getCanvas().style.cursor = 'pointer';
                if (this.openCourse) return;

                const feature = e.features[0];
                const coordinates = feature.geometry.coordinates.slice();

                const popupNode = document.createElement('div');
                popupNode.className = 'course-popup';
                const matchingLine = this.calibrationCourseLines.find(line => line.properties.certificateId === feature.properties.certificateId);
                // Render the HTML description into the node
                const description = featureToDescription(feature, matchingLine);
                popupNode.innerHTML = description;

                this.popup
                    .setLngLat(coordinates)
                    .setDOMContent(popupNode)
                if (!this.popup.isOpen()) {
                    this.popup.addTo(this.map)
                }
            };

            // Hide popup on mouse leave
            const hidePointPopup = () => {
                this.map.getCanvas().style.cursor = '';
                if (this.openCourse) return;
                this.popup.remove();
            };

            // Pin popup on click
            const pinPointPopup = (e) => {
                const clickedId = e.features[0].properties.certificateId;
                if (this.openCourse === clickedId) return;
                this.openCourse = clickedId;
                const coordinates = e.features[0].geometry.coordinates.slice();
                const popupNode = document.createElement('div');
                popupNode.className = 'course-popup';
                const description = featureToDescription(e.features[0]);
                popupNode.innerHTML = description;
                this.popup
                    .setLngLat(coordinates)
                    .setDOMContent(popupNode)
                if (!this.popup.isOpen()) {
                    this.popup.addTo(this.map)
                }
            };

            pointLayerIds.forEach(layerId => {
                this.map.on('mouseenter', layerId, showPointPopup);
                this.map.on('mouseleave', layerId, hidePointPopup);
                this.map.on('click', layerId, pinPointPopup);
            });

            // Handle cluster clicks
            this.map.on('click', 'clusters', (e) => {
                this.openCourse = undefined;
                const features = this.map.queryRenderedFeatures(e.point, {
                    layers: ['clusters']
                });

                const clusterId = features[0].properties.cluster_id;
                const coursesSource = this.map.getSource('course-points')
                coursesSource.getClusterExpansionZoom(
                    clusterId
                ).then((clusterExpansionZoom) => {
                    this.map.easeTo({
                        center: features[0].geometry.coordinates,
                        zoom: clusterExpansionZoom
                    });
                    if (clusterExpansionZoom <= this.map.getMaxZoom()) {
                        return
                    }
                    coursesSource.getClusterLeaves(clusterId).then((leaves) => {
                        const coordinates = features[0].geometry.coordinates;

                        leaves = leaves.sort((a, b) => b.properties.year - a.properties.year)
                        const courseLines = leaves.map(leave => {
                            return this.calibrationCourseLines.find(line => line.properties.certificateId === leave.properties.certificateId);
                        });
                        // Zip and iterate over the two arrays
                        let description = leaves.map((leave, index) => {
                            const line = courseLines[index];
                            return featureToDescription(leave, line);
                        });


                        description = description.reduce((a, b) => a + "<hr/>" + b);
                        const popupNode = document.createElement('div');
                        popupNode.className = 'course-popup';
                        popupNode.innerHTML = description;


                        this.popup
                            .setLngLat(coordinates)
                            .setDOMContent(popupNode)
                        if (!this.popup.isOpen()) {
                            this.popup.addTo(this.map)
                        }
                    })

                });
            });

            // Change cursor on cluster hover
            this.map.on('mouseenter', 'clusters', () => {
                this.map.getCanvas().style.cursor = 'pointer';
            });

            this.map.on('mouseleave', 'clusters', () => {
                this.map.getCanvas().style.cursor = '';
            });

            geolocateControl.on('geolocate', (e) => {
                this.geolocationCoordinates = e.coords
                coordinateOverlay.update(e.coords);
            })


            this.frameControl.container.addEventListener('click', () => {
                this.zoomToFilteredFeatures();
            });

            // Right-click / Long-press GPS popup
            this.map.on('contextmenu', (e) => {
                const coordinates = e.lngLat;
                const popupNode = document.createElement('div');
                popupNode.innerHTML = this._formatCoordsForPopup(coordinates);

                new maplibregl.Popup()
                    .setLngLat(coordinates)
                    .setDOMContent(popupNode)
                    .addTo(this.map);
            });

            // Long-press detection for mobile
            let touchTimer;
            this.map.on('touchstart', (e) => {
                if (e.points.length !== 1) return;
                touchTimer = setTimeout(() => {
                    const coordinates = e.lngLat;
                    const popupNode = document.createElement('div');
                    popupNode.innerHTML = this._formatCoordsForPopup(coordinates);

                    new maplibregl.Popup()
                        .setLngLat(coordinates)
                        .setDOMContent(popupNode)
                        .addTo(this.map);
                }, 600);
            });

            this.map.on('touchend', () => {
                clearTimeout(touchTimer);
            });

            this.map.on('touchmove', () => {
                clearTimeout(touchTimer);
            });
        });

        // Save map state on move
        this.map.on('moveend', () => {
            sessionStorage.setItem('mapCenter', JSON.stringify(this.map.getCenter()));
            sessionStorage.setItem('mapZoom', JSON.stringify(this.map.getZoom()));
            sessionStorage.setItem('mapPitch', JSON.stringify(this.map.getPitch()));
            sessionStorage.setItem('mapBearing', JSON.stringify(this.map.getBearing()));
        });

        this.map.once('idle', () => {
            this.mapLoaded = true;
            this.mapLoadingResolve(true);
        })
    }

    _formatCoordsForPopup(lngLat) {
        const lat = lngLat.lat;
        const lng = lngLat.lng;
        return `
            <div class="p-2">
                <strong>GPS Coordinates</strong><br>
                ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
                <span class="text-secondary small">
                    ${this._toDMS(lat, 'NS')} ${this._toDMS(lng, 'EW')}
                </span>
            </div>
        `;
    }

    _toDMS(deg, axis) {
        const abs = Math.abs(deg);
        const d = Math.floor(abs);
        const mFloat = (abs - d) * 60;
        const m = Math.floor(mFloat);
        const sFloat = (mFloat - m) * 60;
        const s = sFloat.toFixed(1);

        const dir = deg >= 0 ? axis[0] : axis[1];
        return `${d}° ${m}' ${s}" ${dir}`;
    }

    initializeTable() {
        this.table = new Tabulator(this.tableContainer, {
            index: "properties.certificateId",
            data: [],
            pagination: true,
            paginationSize: 15,
            height: "500px",
            layout: "fitDataStretch",
            paginationSizeSelector: [10, 15, 25, 50, 100],
            placeholder: "No Data Available",
            groupBy: this.reviewMode ? undefined : "properties.state", // Group by state, except when reviewing proposals
            groupHeader: function (value, count) {
                return value + " <span class='text-muted'>(" + count + " courses)</span>";
            },
            groupToggleElement: "header",
            initialSort: this.sorts,
            initialFilter: this.filters,
            initialHeaderFilter: this.headerFilters,
            footerElement: "<footer class='tabulator-footer text-secondary fw-normal'><span id='course-count'></span> courses, <span id='after-filter-count'></span> after filters</footer>",
            columns: [
                {
                    title: "Certificate",
                    field: "properties.certificateId",
                    sorter: "string",
                    headerSort: true,
                    headerFilter: true,
                    formatter: function (cell) {
                        const data = cell.getRow().getData();
                        const id = data.properties.certificateId;
                        const link = data.properties.certificateLink || `https://www.certifiedroadraces.com/certificate?type=c&id=${id}`;
                        return id ? `<a href="${link}" target="_blank" data-goatcounter-click="ext-cert-${data.properties.certificateId}">${id}</a>` : "";
                    }
                },
                {
                    title: "Course Name",
                    field: "properties.nameAbbreviated",
                    sorter: "string",
                    headerSort: false,
                    headerFilter: true,
                    formatter: function (cell) {
                        const data = cell.getRow().getData();
                        if (data.properties.expired) {
                            return data.properties.nameAbbreviated + " <span class='text-secondary'>(Expired)</span>";
                        } else return `<span title="${data.properties.name}">${data.properties.nameAbbreviated}</span>`;
                    }
                },
                ...(this.reviewMode ? [{
                    title: "Status",
                    field: "properties.certificateId",
                    sorter: (_a, _b, aRow, bRow) => this.getReviewStatus(
                        aRow.getData().properties.certificateId
                    ).localeCompare(this.getReviewStatus(bRow.getData().properties.certificateId)),
                    headerSort: true,
                    formatter: (cell) => this.getReviewStatus(
                        cell.getRow().getData().properties.certificateId
                    ) === 'accepted' ? 'Accepted' : 'Proposed'
                }, {
                    title: "Displacement",
                    field: "properties.certificateId",
                    sorter: (_a, _b, aRow, bRow) => {
                        const aMeters = this.getDisplacementMeters(aRow.getData().properties.certificateId);
                        const bMeters = this.getDisplacementMeters(bRow.getData().properties.certificateId);
                        return (aMeters ?? -1) - (bMeters ?? -1);
                    },
                    headerSort: true,
                    formatter: (cell) => {
                        const meters = this.getDisplacementMeters(cell.getRow().getData().properties.certificateId);
                        return meters === null ? "" : formatDisplacement(meters);
                    }
                }, {
                    title: "Line",
                    field: "properties.certificateId",
                    sorter: (_a, _b, aRow, bRow) => Number(
                        this.hasReviewLine(aRow.getData().properties.certificateId)
                    ) - Number(this.hasReviewLine(bRow.getData().properties.certificateId)),
                    headerSort: true,
                    formatter: (cell) => this.hasReviewLine(
                        cell.getRow().getData().properties.certificateId
                    ) ? "Yes" : ""
                }] : []),
                {title: "City", field: "properties.city", sorter: "string", headerSort: false, headerFilter: true, headerFilterFunc: "=", headerFilterPlaceholder: " "},
                {title: "State/Province", field: "properties.state", sorter: "string", headerSort: false, headerFilter: true, headerFilterFunc: "=", headerFilterPlaceholder: " "},
                {
                    title: "Country",
                    field: "properties.country",
                    sorter: "string",
                    headerSort: false,
                    headerFilter: true,
                    headerFilterFunc: "=",
                    visible: false
                }, // just for filtering on
                {
                    title: "Length",
                    field: "properties.courseLengthMeters",
                    sorter: "string",
                    headerSort: true,
                    formatter: function (cell) {
                        const data = cell.getRow().getData()
                        return data.properties.courseLength + data.properties.units;
                    }
                },
                {
                    title: "Measurer",
                    field: "properties.measurer",
                    sorter: "string",
                    headerSort: true,
                    headerFilter: true
                },
                {
                    title: "Expired",
                    field: "properties.expired",
                    sorter: "string",
                    headerSort: true,
                    headerFilter: true,
                    visible: false
                }, // just for filtering on
                {
                    title: "Approximate",
                    field: "properties.approximate",
                    sorter: "string",
                    headerSort: false,
                    headerFilter: true,
                    visible: false
                }, // just for filtering on
                {
                    title: "Has Line",
                    field: "properties.hasLine",
                    sorter: "boolean",
                    visible: false
                }, // query-param filter only
                {
                    title: "Year",
                    field: "properties.year",
                    sorter: "string",
                    headerSort: true,
                    headerFilter: true,
                    visible: true
                },
                {
                    title: "Actions",
                    formatter: function (cell) {
                        const data = cell.getRow().getData();
                        if (data.properties.approximate) {
                            return ''
                        }
                        return `
                <div class="d-flex gap-2">
                <a href="https://www.google.com/maps/place/${data.geometry.coordinates[1]},${data.geometry.coordinates[0]}" target="_blank" class="link-secondary">
                   Map
                </a>
                <a href="https://www.google.com/maps/dir/?api=1&destination=${data.geometry.coordinates[1]},${data.geometry.coordinates[0]}&travelmode=driving" target="_blank" class="link-secondary">
                   Directions
                </a>
                </div>
             `;
                    },
                    headerSort: false,
                    hozAlign: "center"
                }
            ]
        });

        // Handle row clicks to fly map to location
        this.table.on("rowClick", (e, row) => {
            const rowData = row.getData();
            const center = rowData.geometry.coordinates;
            this.openCourse = rowData.properties.certificateId;
            this.map.flyTo({
                center: center,
                zoom: 15,
                duration: 2500
            });
        });

        // Update map when table is filtered
        this.table.on("dataFiltered", (filters, rows) => {
            this.table.footerManager.element.querySelector("#course-count").innerText = this.table.getData().length;
            this.table.footerManager.element.querySelector("#after-filter-count").innerText = rows.length
            this.scheduleMapToTableData()

            const activeHeaderFilters = this.table.getHeaderFilters();
            const countryFilter = activeHeaderFilters.find(f => f.field === "properties.country");
            const stateFilter = activeHeaderFilters.find(f => f.field === "properties.state");
            const cityFilter = activeHeaderFilters.find(f => f.field === "properties.city");

            // Keep the dropdown selections in sync with the header filters
            this.selectedCountry = countryFilter && this.countries.includes(countryFilter.value)
                ? countryFilter.value : "";
            this.selectedState = stateFilter && this.states.includes(stateFilter.value)
                ? stateFilter.value : "";
            this.selectedLocation = cityFilter && this.locations.includes(cityFilter.value)
                ? cityFilter.value : "";

            this.headerFilters = activeHeaderFilters;

            sessionStorage.setItem('tableFilters', JSON.stringify(this.filters));
            sessionStorage.setItem('tableHeaderFilters', JSON.stringify(this.headerFilters));
        });

        this.table.on('dataSorted', (sorters) => {
            sessionStorage.setItem('tableSorts', JSON.stringify(this.sorts.map(value => {
                return {dir: value.dir, params: value.params}
            })));
        });

        // Reset map when filters are cleared
        this.table.on("dataFilterCleared", () => {
            // Reset to show all features
            //this.matchMapToTableData(this.table.getRows())
        });
        this.table.on("tableBuilt", () => {
            this.legendFilter = data => {
                const properties = data.properties;
                const locationTypeVisible = properties.approximate
                    ? this.showApproximateLocations
                    : this.showStreetLocations;
                return locationTypeVisible && (this.showExpiredCourses || !properties.expired);
            };
            this.table.addFilter(this.legendFilter);

            if (this.reviewMode) {
                this.table.addFilter(data => this.getReviewFeature(data.properties.certificateId) !== undefined);
                this.applyReviewVisibilityFilter();
            }

            ['properties.city', 'properties.state'].forEach(field => {
                const headerCell = this.tableContainer.querySelector(`[tabulator-field="${field}"]`);
                if (!headerCell) return;
                const lock = (input) => {
                    input.readOnly = true;
                    input.tabIndex = -1;
                    input.style.cursor = 'default';
                    input.style.pointerEvents = 'none';
                    input.style.color = '#6c757d';
                    input.style.fontStyle = 'italic';
                    input.style.background = "#eee";
                    //input.style.borderColor = 'transparent';
                };
                const input = headerCell.querySelector('.tabulator-header-filter input');
                if (input) lock(input);
                new MutationObserver(() => {
                    const el = headerCell.querySelector('.tabulator-header-filter input');
                    if (el && !el.readOnly) lock(el);
                }).observe(headerCell, {childList: true, subtree: true});
            });
            this.tableLoadingResolve(true);
        })
    }

    matchMapToTableData(rows) {
        if (!this.map || !this.map.isStyleLoaded()) return;
        if (!this.calibrationCourses || !this.calibrationCourseLines || !this.map || !this.table) return;
        // Extract the IDs of all visible rows after filtering
        const visibleRowIds = rows.map(row => row.getData().properties.certificateId);
        this.matchMapToCourseIds(visibleRowIds);
    }

    scheduleMapToTableData() {
        clearTimeout(this.mapFilterUpdateTimer);
        this.mapFilterUpdateTimer = setTimeout(() => {
            // Header filters may be applied in several steps. Read the settled table
            // instead of using a transient row set from an earlier dataFiltered event.
            this.matchMapToTableData(this.table.getRows("active"));
        }, 0);
    }

    getDisplacementMeters(certificateId) {
        const feature = this.getReviewFeature(certificateId);
        return feature ? feature.properties.distanceMeters : null;
    }

    hasReviewLine(certificateId) {
        return this.reviewData.some(feature =>
            feature.properties.role === 'review' &&
            feature.properties.certificateId === certificateId &&
            feature.geometry.type === 'LineString'
        );
    }

    getReviewFeature(certificateId) {
        return this.reviewData.find(feature =>
            feature.properties.role === 'review' && feature.properties.certificateId === certificateId
        );
    }

    getReviewStatus(certificateId) {
        return this.getReviewFeature(certificateId)?.properties.reviewStatus || '';
    }

    applyReviewVisibilityFilter() {
        if (this.reviewVisibilityFilter) {
            this.table?.removeFilter(this.reviewVisibilityFilter);
            this.reviewVisibilityFilter = undefined;
        }
        this.reviewVisibilityFilter = data => {
            const status = this.getReviewStatus(data.properties.certificateId);
            return (status === 'pending' && this.showProposedReviews) ||
                (status === 'accepted' && this.showAcceptedReviews);
        };
        this.table?.addFilter(this.reviewVisibilityFilter);
    }

    matchMapToCourseIds(visibleRowIds) {
        const reviewIds = new Set(this.reviewData
            .filter(feature => feature.properties.role === 'review')
            .map(feature => feature.properties.certificateId));
        const mapRowIds = this.reviewMode
            ? visibleRowIds.filter(certificateId => reviewIds.has(certificateId))
            : visibleRowIds;
        // Filter the map features to only show those that match the visible rows
        const filteredFeatures = this.calibrationCourses.filter(feature =>
            mapRowIds.includes(feature.properties.certificateId)
        );
        this.filteredCourses = filteredFeatures.slice();


        const filteredLineFeatures = this.calibrationCourseLines.filter(feature =>
            mapRowIds.includes(feature.properties.certificateId)
        );

        // Update the map source with the filtered features
        ["course-points", "course-points-overview"].forEach(sourceId => {
            this.map.getSource(sourceId).setData({
                type: 'FeatureCollection',
                features: filteredFeatures
            });
        });
        this.map.getSource("course-lines").setData({
            type: 'FeatureCollection',
            features: filteredLineFeatures
        });
        this.map.getSource('location-review')?.setData({
            type: 'FeatureCollection',
            features: this.reviewMode
                ? this.reviewData.filter(feature => mapRowIds.includes(feature.properties.certificateId))
                : []
        });
    }

    zoomToFilteredFeatures() {
        const visibleRows = this.table.getData("active");

        if (visibleRows.length > 0) {
            const bounds = new maplibregl.LngLatBounds();
            visibleRows.forEach(course => {
                bounds.extend(course.geometry.coordinates);
            });

            this.map.fitBounds(bounds, {
                padding: 50
            });
        }
    }

    handleCountryChange(e) {
        const value = e.target.value;
        this.selectedCountry = value;
        this.selectedState = "";
        this.selectedLocation = "";
        this.headerFilters = this.headerFilters.filter(filter =>
            filter.field !== "properties.country" && filter.field !== "properties.state" && filter.field !== "properties.city"
        );
        this.table.setHeaderFilterValue("properties.state", "");
        this.table.setHeaderFilterValue("properties.city", "");

        if (value) {
            // This will trigger dataFiltered and update the map
            this.table.setHeaderFilterValue("properties.country", value);
            this.headerFilters = [...this.headerFilters, {field: "properties.country", type: "=", value: value}];
            this.zoomToFilteredFeatures();
        } else {
            this.table.setHeaderFilterValue("properties.country", "");
        }
    }

    handleStateChange(e) {
        const value = e.target.value;
        this.selectedState = value;
        this.selectedLocation = "";
        this.headerFilters = this.headerFilters.filter(filter =>
            filter.field !== "properties.state" && filter.field !== "properties.city"
        );
        this.table.setHeaderFilterValue("properties.city", "");

        if (value) {
            this.table.setHeaderFilterValue("properties.state", value);
            // This will trigger dataFiltered and update the map
            this.headerFilters = [...this.headerFilters, {field: "properties.state", type: "=", value: value}];
            this.zoomToFilteredFeatures();
        } else {
            this.table.setHeaderFilterValue("properties.state", "");
        }
    }

    handleLocationChange(e) {
        const value = e.target.value;
        this.selectedLocation = value;
        this.headerFilters = this.headerFilters.filter(filter => filter.field !== "properties.city");

        if (value) {
            // This will trigger dataFiltered
            this.table.setHeaderFilterValue("properties.city", value);
            this.headerFilters = [...this.headerFilters, {field: "properties.city", type: "=", value: value}];
            this.zoomToFilteredFeatures();
        } else {
            this.table.setHeaderFilterValue("properties.city", "");
        }
    }

    get visibleStates() {
        if (!this.selectedCountry) return this.states;
        return this.states.filter(state => this.stateCountry[state] === this.selectedCountry);
    }

    get visibleCities() {
        if (!this.selectedState && !this.selectedCountry) return this.locations;
        return this.locations.filter(city => {
            const states = this.cityStates[city];
            if (!states) return false;
            if (this.selectedState) return states.has(this.selectedState);
            return [...states].some(state => this.stateCountry[state] === this.selectedCountry);
        });
    }

    renderError(error) {
        const mapElement = this.renderRoot.querySelector('#map');
        if (mapElement) {
            mapElement.innerHTML = `
        <div class="alert alert-danger" role="alert">
          <h4 class="alert-heading">Error loading map data</h4>
          <p>There was a problem loading the calibration courses data: ${error.message}</p>
          <hr>
          <p class="mb-0">Please check that the course data file ${this.dataURL} exists and is properly formatted.</p>
        </div>
      `;
        }
    }

    toggleLegendItem(item) {
        if (item === 'street') this.showStreetLocations = !this.showStreetLocations;
        if (item === 'approximate') this.showApproximateLocations = !this.showApproximateLocations;
        if (item === 'expired') this.showExpiredCourses = !this.showExpiredCourses;
        if (item === 'proposed') this.showProposedReviews = !this.showProposedReviews;
        if (item === 'accepted') this.showAcceptedReviews = !this.showAcceptedReviews;
        if (item === 'proposed' || item === 'accepted') this.applyReviewVisibilityFilter();
        this.table.refreshFilter();
    }

    isFilterActive(field, operator, value) {
        // Check if the filters array contains a filter matching these criteria
        return this.filters.some(filter =>
            filter.field === field &&
            filter.type === operator &&
            filter.value === value
        );
    }

    openPopupFromHash() {
        if (!this.openCourse || !this.mapLoaded) return;

        // Remove the # from the hash
        const courseId = this.openCourse.replace('#', '');

        // Find the feature with this certificate ID
        const targetFeature = this.calibrationCourses.find(
            feature => feature.properties.certificateId === courseId
        );

        if (!targetFeature) {
            console.warn(`Course with ID ${courseId} not found`);
            return;
        }

        // Fly to the feature
        const coordinates = targetFeature.geometry.coordinates.slice();
        this.map.flyTo({
            center: coordinates,
            zoom: 15,
            duration: 1000
        });

        // Create and show popup
        const popupNode = document.createElement('div');
        popupNode.className = 'course-popup';
        const matchingLine = this.calibrationCourseLines.find(line => line.properties.certificateId === targetFeature.properties.certificateId);
        const description = featureToDescription(targetFeature, matchingLine);
        popupNode.innerHTML = description;
        this.popup
            .setLngLat(coordinates)
            .setDOMContent(popupNode);

        if (!this.popup.isOpen()) {
            this.popup.addTo(this.map);
        }
    }

    updated(changedProperties) {
        if (!this.map) {
            return;
        }

        if (changedProperties.has("filters")) {
            this.filters.map(filter => {
                this.table.addFilter(filter.field, filter.type, filter.value);
            })
            this.table.getFilters().map(filter => {
                if (!this.isFilterActive(filter.field, filter.type, filter.value)) {
                    this.table.removeFilter(filter.field, filter.type, filter.value);
                }
            })
        }

        if (changedProperties.has("mapLoaded") && this.mapLoaded && this.openCourse) {
            // Slight delay to ensure the map and popup are ready
            setTimeout(() => this.openPopupFromHash(), 500);
        }

        if (changedProperties.has("openCourse")) {
            location.hash = this.openCourse ?? "";
            if (this.mapLoaded && this.openCourse) {
                this.openPopupFromHash();
            }
        }
    }

    render() {
        return html`
            <div class="view-container">
                <style>
                    ${this.constructor.styles}
                </style>
                <div class="filter-bar mb-2" role="toolbar" aria-label="Course filters and map legend">
                    <div class="input-group">
                        <label class="input-group-text" for="countries-select">Country</label>
                        <select class="form-select" id="countries-select" .value=${this.selectedCountry} @change=${this.handleCountryChange}>
                            <option value="">All Countries</option>
                            ${map(this.countries, country => html`
                                <option value=${country}>${COUNTRY_NAMES[country] ?? country}</option>
                            `)}
                        </select>
                    </div>

                    <div class="input-group">
                        <label class="input-group-text" for="states-select">State/Province</label>
                        <select class="form-select" id="states-select" .value=${this.selectedState} @change=${this.handleStateChange}>
                            <option value="">All States/Provinces</option>
                            ${map(this.visibleStates, state => html`
                                <option value=${state}>${state}</option>
                            `)}
                        </select>
                    </div>

                    <div class="input-group">
                        <label class="input-group-text" for="locations-select">City</label>
                        <select class="form-select" id="locations-select" .value=${this.selectedLocation} @change=${this.handleLocationChange}>
                            <option value="">All Cities</option>
                            ${map(this.visibleCities, city => html`
                                <option value=${city}>${city}</option>
                            `)}
                        </select>
                    </div>

                    <div class="map-legend" aria-label="Map legend">
                      <span class="map-legend-title">Map key</span>
                      <button type="button" class="map-legend-toggle" aria-pressed=${this.showStreetLocations}
                              title="Show or hide street locations" @click=${() => this.toggleLegendItem('street')}>
                        <span class="course-circle"></span>Street location
                      </button>
                      <button type="button" class="map-legend-toggle" aria-pressed=${this.showApproximateLocations}
                              title="Show or hide approximate locations" @click=${() => this.toggleLegendItem('approximate')}>
                        <span class="course-circle-outline"></span>Approximate
                      </button>
                      <button type="button" class="map-legend-toggle" aria-pressed=${this.showExpiredCourses}
                              title="Show or hide expired courses" @click=${() => this.toggleLegendItem('expired')}>
                        <span class="course-expired"></span>Expired
                      </button>
                      <span class="map-legend-label" title="Shown when available for a visible course">
                        <span class="course-line-key"></span>Measured line
                      </span>
                    </div>
                </div>

                ${this.reviewMode ? html`
                  <div class="alert alert-info py-2 mb-2" role="status">
                    Reviewing ${this.reviewData.filter(feature => feature.properties.role === 'review' && feature.properties.reviewStatus === 'pending').length} proposed candidates and ${this.reviewData.filter(feature => feature.properties.role === 'review' && feature.properties.reviewStatus === 'accepted').length} accepted records:
                    <span class="review-key review-key-original"></span> original location,
                    <span class="review-line"></span> displacement. Click a point or line for evidence.
                    <span class="review-status-filters">
                      <button type="button" class="map-legend-toggle" aria-pressed=${this.showProposedReviews}
                              title="Show or hide proposed locations" @click=${() => this.toggleLegendItem('proposed')}>
                        <span class="review-key review-key-proposed"></span>Proposed
                      </button>
                      <button type="button" class="map-legend-toggle" aria-pressed=${this.showAcceptedReviews}
                              title="Show or hide accepted locations" @click=${() => this.toggleLegendItem('accepted')}>
                        <span class="review-key review-key-accepted"></span>Accepted
                      </button>
                    </span>
                  </div>
                  <style>
                    .review-key { display:inline-block; width:12px; height:12px; border-radius:50%; vertical-align:-1px; margin-left:.4rem; }
                    .review-key-original { background-color:#AB2129; }
                    .review-key-proposed { background:#087EA4; border:2px solid white; box-shadow:0 0 0 1px #087EA4; }
                    .review-key-accepted { background:#198754; border:2px solid white; box-shadow:0 0 0 1px #198754; }
                    .review-line { display:inline-block; width:22px; border-top:2px dashed #F59E0B; vertical-align:4px; margin-left:.4rem; }
                    .review-status-filters { display:inline-flex; gap:.35rem; margin-left:.75rem; }
                  </style>` : ''}

                <div class="map-table-container">
                  <div id="map"></div>
                    ${this.tableContainer}
                </div>
            </div>
            <div class="row mt-4">
                <div class="col-lg-9">
                    ${this.dataLoading ? html`
                                <div class="spinner-border" role="status">` :
                            html`
                                <expiration-chart .data="${this.filteredCourses}"></expiration-chart>`}
                </div>
                <div class="col-lg-3">
                    ${this.dataLoading ? html`
                                <div class="spinner-border" role="status">` :
                            html`
                                <measurer-stats .data="${this.filteredCourses}" .limit="${10}"></measurer-stats>`}
                </div>
            </div>
        `;
    }
}

// Define the custom element
customElements.define('courses-view', CoursesView);
