import {LitElement, html, css} from 'lit';
import {map} from 'lit-html/directives/map.js';
import maplibregl from 'maplibre-gl';
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

import {StackedBarChart} from "./StackedBarChart.js";
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

export class CoursesView extends LitElement {
    static styles = css`
        courses-view {
            display: block;
        }

        .container {
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

        #courses-table {
            overflow: auto;
            height: 500px;
        }

        .course-popup {
            max-width: 300px;
        }
    `;

    static properties = {
        coursesUrl: {type: String},
        courseLinesUrl: {type: String},
        styleUrl: {type: String},
        initialCenter: {type: Array},
        calibrationCourses: {type: Array, state: true},
        filteredCourses: {type: Array, state: true},
        states: {type: Array, state: true},
        locations: {type: Array, state: true},
        features: {type: Array, state: true},
        mapLoaded: {type: Boolean, state: true},
        filters: {type: Array, state: true},
        headerFilters: {type: Array, state: true},
        sorts: {type: Array, state: true},
        openCourse: {type: String, state: true},
        approximateOnly: {type: Boolean, state: true},
        dataLoading: {type: Boolean, state: true},
        geolocationCoordinates: {type: Array, state: true},
        isGeolocationEnabled: {type: Boolean, state: true},
        selectedState: {type: String, state: true},
        selectedLocation: {type: String, state: true}
    };

    constructor() {
        super();
        this.calibrationCourses = null;
        this.calibrationCourseLines = null;
        this.states = [];
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
        this.selectedState = "";
        this.selectedLocation = "";
    }

    createRenderRoot() {
        // LightDOM
        return this;
    }

    connectedCallback() {
        super.connectedCallback()
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
        const urlParams = new URLSearchParams(window.location.search);
        const approximateOnly = urlParams.get('approximateOnly');
        if (approximateOnly) {
            this.approximateOnly = approximateOnly === 'true';
            this.filters = this.filters.filter(filter => filter.field !== "properties.approximate");
            this.filters.push({field: "properties.approximate", type: "=", value: true});
        } else {
            this.approximateOnly = false;
            this.filters = this.filters.filter(filter => filter.field !== "properties.approximate");
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
          this.matchMapToTableData(this.table.getRows())
        })

    }

    async loadData() {
        try {
            const [coursesResponse, courseLinesResponse] = await Promise.all([
                fetch(this.coursesUrl),
                fetch(this.courseLinesUrl)
            ]);

            if (!coursesResponse.ok) {
                throw new Error(`Failed to fetch course data: ${coursesResponse.status} ${coursesResponse.statusText}`);
            }

            if (!courseLinesResponse.ok) {
                throw new Error(`Failed to fetch course lines data: ${courseLinesResponse.status} ${courseLinesResponse.statusText}`);
            }

            const [coursesData, courseLinesData] = await Promise.all([
                coursesResponse.json(),
                courseLinesResponse.json()
            ]);

            this.calibrationCourses = coursesData.features;
            this.calibrationCourseLines = courseLinesData.features;

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
        const statesSet = new Set();
        const locationsSet = new Set();
        const currentYear = new Date().getFullYear();

        for (const [id, course] of Object.entries(this.calibrationCourses)) {
            // Extract state and location information for dropdowns
            const properties = course.properties;
            if (properties.state) {
                statesSet.add(properties.state);
            }

            if (properties.city && properties.state) {
                locationsSet.add(properties.city + ', ' + properties.state);
            }

            // Extract the first two digits after any letters at the beginning
            const yearMatch = properties.certificateId.match(/^[A-Za-z]+(\d{2})/);
            if (yearMatch && yearMatch[1]) {
                const courseYear = parseInt("20" + yearMatch[1]);
                course.properties.year = courseYear;
                course.properties.expired = currentYear > (courseYear + 10)
            } else {
                // Handle the case where no matching pattern is found
                console.warn("Could not extract year from certificateId:", properties.certificateId);
            }
            course.properties.courseLengthMeters = course.properties.courseLength
            if (course.properties.units === "ft") {
                course.properties.courseLengthMeters = course.properties.courseLength * .3048
            }
        }

        this.states = [...statesSet].sort();
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

            // Show popup on hover
            this.map.on('mouseenter', 'unclustered-point', (e) => {
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
            });

            // Hide popup on mouse leave
            this.map.on('mouseleave', 'unclustered-point', (e) => {
                this.map.getCanvas().style.cursor = '';
                if (this.openCourse) return;
                this.popup.remove();
            });

            // Pin popup on click
            this.map.on('click', 'unclustered-point', (e) => {
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

                        leaves = leaves.sort((a, b) => a.properties.year < b.properties.year)
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

    initializeTable() {
        this.table = new Tabulator(this.tableContainer, {
            index: "properties.certificateId",
            data: [],
            pagination: true,
            paginationSize: 15,
            layout: "fitDataFill",
            paginationSizeSelector: [10, 15, 25, 50, 100],
            placeholder: "No Data Available",
            groupBy: "properties.state", // Group by state
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
                {title: "City", field: "properties.city", sorter: "string", headerSort: false, headerFilter: true},
                {title: "State", field: "properties.state", sorter: "string", headerSort: false, headerFilter: true},
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
            this.matchMapToTableData(rows)

            const stateFilter = this.table.getHeaderFilters().find(f => f.field === "properties.state");
            const cityFilter = this.table.getHeaderFilters().find(f => f.field === "properties.city");

            // Update state selection based on filter
            if (stateFilter && this.states.includes(stateFilter.value)) {
                this.selectedState = stateFilter.value;
            } else {
                this.selectedState = "";
            }

            // Update location selection based on filter
            if (cityFilter && stateFilter) {
                const potentialLocation = `${cityFilter.value}, ${stateFilter.value}`;
                if (this.locations.includes(potentialLocation)) {
                    this.selectedLocation = potentialLocation;
                } else {
                    this.selectedLocation = "";
                }
            } else {
                this.selectedLocation = "";
            }

            this.headerFilters = this.table.getHeaderFilters();

            sessionStorage.setItem('tableFilters', JSON.stringify(this.table.getFilters()));
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
            this.tableLoadingResolve(true);
        })
    }

    matchMapToTableData(rows) {
        if (!this.map || !this.map.isStyleLoaded()) return;
        if (!this.calibrationCourses || !this.calibrationCourseLines || !this.map || !this.table) return;
        // Extract the IDs of all visible rows after filtering
        const visibleRowIds = rows.map(row => row.getData().properties.certificateId);

        // Filter the map features to only show those that match the visible rows
        const filteredFeatures = this.calibrationCourses.filter(feature =>
            visibleRowIds.includes(feature.properties.certificateId)
        );
        this.filteredCourses = filteredFeatures.slice();


        const filteredLineFeatures = this.calibrationCourseLines.filter(feature =>
            visibleRowIds.includes(feature.properties.certificateId)
        );

        // Update the map source with the filtered features
        this.map.getSource("course-points").setData({
            type: 'FeatureCollection',
            features: filteredFeatures
        });
        this.map.getSource("course-lines").setData({
            type: 'FeatureCollection',
            features: filteredLineFeatures
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

    handleStateChange(e) {
        const value = e.target.value;
        this.selectedState = value;

        if (value) {
            this.table.setHeaderFilterValue("properties.state", value);
            this.headerFilters = this.headerFilters.filter(filter => filter.field !== "properties.state");
            // This will trigger dataFiltered and update the map
            this.headerFilters = [...this.headerFilters, {field: "properties.state", type: "=", value: value}];
            this.zoomToFilteredFeatures();
        } else {
            this.table.setHeaderFilterValue("properties.state", "");
            this.headerFilters = this.headerFilters.filter(filter => filter.field !== "properties.state");
        }
    }

    handleLocationChange(e) {
        const value = e.target.value;
        this.selectedLocation = value;

        if (value) {
            const [city, state] = value.split(', ');
            this.headerFilters = this.headerFilters.filter(filter => (filter.field !== "properties.state") && (filter.field !== "properties.city"));

            this.headerFilters = [...this.headerFilters,
                {field: "properties.city", type: "=", value: city},
                {field: "properties.state", type: "=", value: state}
            ];
            // This will trigger dataFiltered
            this.table.setHeaderFilterValue("properties.city", city);
            this.table.setHeaderFilterValue("properties.state", state);

            this.zoomToFilteredFeatures();
        } else {

            this.headerFilters = this.headerFilters.filter(filter => (filter.field !== "properties.state") && (filter.field !== "properties.city"));
            // This will trigger dataFiltered
            this.table.setHeaderFilterValue("properties.city", "");
            this.table.setHeaderFilterValue("properties.state", "");
        }
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

    handleIncludeExpired(e) {
        if (!this.isFilterActive("properties.expired", "=", false)) {
            this.filters = [...this.filters, {field: "properties.expired", type: "=", value: false}];
        } else {
            this.filters = this.filters.filter(value => value.field !== "properties.expired");
        }
        this.requestUpdate()
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
            <div class="container">
                <style>
                    ${this.constructor.styles}
                </style>
                <div class="btn-toolbar gap-2 mb-2 row align-items-center" role="toolbar">
                    <div class="input-group">
                        <label class="input-group-text" for="states-select">State</label>
                        <select class="form-select" id="states-select" .value=${this.selectedState} @change=${this.handleStateChange}>
                            <option value="">All States</option>
                            ${map(this.states, state => html`
                                <option value=${state}>${state}</option>
                            `)}
                        </select>
                    </div>

                    <div class="input-group">
                        <label class="input-group-text" for="locations-select">Location</label>
                        <select class="form-select" id="locations-select" .value=${this.selectedLocation} @change=${this.handleLocationChange}>
                            <option value="">All Locations</option>
                            ${map(this.locations, location => html`
                                <option value=${location}>${location}</option>
                            `)}
                        </select>
                    </div>

                    <div class="col-auto">
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" id="include-expired" value="include-expired"
                                   .checked="${!this.isFilterActive('properties.expired', "=", false)}"
                                   @change=${this.handleIncludeExpired}>
                            <label class="form-check-label" for="include-expired">
                                Include Expired
                            </label>
                        </div>
                    </div>
                </div>

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
                                <stacked-bar-chart .data="${this.filteredCourses}"></stacked-bar-chart>`}
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