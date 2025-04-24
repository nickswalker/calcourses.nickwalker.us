import { LitElement, html, css } from 'lit';
import { map } from 'lit-html/directives/map.js';
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

/**
 * Custom Home Control for MapLibre
 */
class HomeControl {
    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

        this.container.innerHTML = `
      <div class="tools-box">
        <button>
          <span class="maplibregl-ctrl-icon" aria-hidden="true" title="Zoom to fit"></span>
        </button>
      </div>
    `;
        this.container.querySelector("span").style.backgroundImage = "url('fullscreen-frame-icon.svg')";
        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}

/**
 * Convert a map feature to HTML description for the popup
 */
function featureToDescription(feature) {
    const properties = feature.properties;
    let expiredText = ""
    if (properties.expired) {
        expiredText = "(Expired)";
    }
    return `
    <h4 class="lh-1">${properties.name} <span class="text-secondary"> ${expiredText}</span></h4>
    <p class="lh-1 d-flex flex-column gap-1">
      <a href="${properties.certificateLink}">${properties.certificateId}</a>
      ${properties.city}, ${properties.state}<br>
      Measurer: ${properties.measurer}<br>
      <a href="https://www.google.com/maps/place/${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}">
        Google Maps
      </a>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}&travelmode=driving">
        Driving directions to course
      </a>
    </p>
  `;
}

export class CoursesView extends LitElement {
    static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    
    .container {
      display: grid;
      grid-template-rows: auto 1fr;
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
    
    .map-table-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      height: 100%;
    }
    
    #map {
      height: 100%;
    }
    
    #courses-table {
      height: 100%;
      overflow: auto;
    }
    
    .course-popup {
      max-width: 300px;
    }
    
    @media (max-width: 768px) {
      .map-table-container {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr 1fr;
      }
    }
  `;

    static properties = {
        dataUrl: { type: String },
        styleUrl: { type: String },
        initialCenter: { type: Array },
        calibrationCourses: { type: Object, state: true },
        states: { type: Array, state: true },
        locations: { type: Array, state: true },
        features: { type: Array, state: true },
        mapLoaded: { type: Boolean, state: true },
        filters: { type: Array, state: true },
        headerFilters: { type: Array, state: true },
        sorts: { type: Array, state: true },
        openCourse: { type: String, state: true },
    };

    constructor() {
        super();
        this.calibrationCourses = {};
        this.states = [];
        this.filters = [];
        this.headerFilters = [];
        this.sorts = [   {column: "properties.city", dir: "asc"},
            {column: "properties.state", dir: "asc"}];
        this.locations = [];
        this.mapLoaded = false;
        this.openCourse = undefined;
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
        this.loadData();
        window.addEventListener("hashchange", () => {
            const urlHash = location.hash;
            if (urlHash !== this.openCourse) {
                this.openCourse = urlHash.substring(1);
            }
        })
    }

    async loadData() {
        try {
            const response = await fetch(this.dataUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch course data: ${response.status} ${response.statusText}`);
            }

            this.calibrationCourses = (await response.json()).features;
            this.processData();
            this.initializeMap();
        } catch (error) {
            console.error('Error loading calibration courses data:', error);
            this.renderError(error);
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

            const courseYear = parseInt("20" + properties.certificateId.substring(2, 4));
            this.calibrationCourses[id].properties.expired = currentYear > (courseYear + 10)
            this.calibrationCourses[id].properties.courseLengthMeters = this.calibrationCourses[id].properties.courseLength
            if (this.calibrationCourses[id].properties.units === "ft") {
                this.calibrationCourses[id].properties.courseLengthMeters = this.calibrationCourses[id].properties.courseLength * .3048
            }
        }

        this.states = [...statesSet].sort();
        this.locations = [...locationsSet].sort();
    }

    computeDisplayFeatures() {
        // Eventually, we'll also incorporate non-course-point features
        return this.calibrationCourses.filter(feature => true)
    }

    initializeMap() {
        // Get saved map state or use defaults
        const center = sessionStorage.getItem('mapCenter')
            ? JSON.parse(sessionStorage.getItem('mapCenter'))
            : this.initialCenter;

        const zoom = Number(sessionStorage.getItem('mapZoom')) || 9;
        const pitch = Number(sessionStorage.getItem('mapPitch')) || 0;
        const bearing = Number(sessionStorage.getItem('mapBearing')) || 0;

        this.map = new maplibregl.Map({
            container: this.renderRoot.querySelector('#map'),
            style: this.styleUrl,
            center,
            zoom,
            pitch,
            bearing,
            maxZoom: 18
        });

        this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
        this.map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        this.map.addControl(new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true
        }), 'top-right');

        this.homeControl = new HomeControl();
        this.map.addControl(this.homeControl);

        // Set up event listeners after map loads
        this.map.on('load', () => {
            // Create popup for displaying course information
            this.popup = new maplibregl.Popup({
                closeButton: true,
                closeOnClick: false,
                className: 'course-popup'
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

                // Ensure popup appears over the feature
                while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                    coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                }

                const popupNode = document.createElement('div');
                popupNode.className = 'course-popup';

                // Render the HTML description into the node
                const description = featureToDescription(feature);
                if (typeof description === 'string') {
                    popupNode.innerHTML = description;
                } else {
                    // If it's a lit-html template, render it
                    import('lit').then(({ render }) => {
                        render(description, popupNode);
                    });
                }

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
                if (this.openCourse === clickedId ) return;
                this.openCourse = clickedId;
                const coordinates = e.features[0].geometry.coordinates.slice();

                // Ensure popup appears over the feature
                while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                    coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                }

                const popupNode = document.createElement('div');
                popupNode.className = 'course-popup';
                const description = featureToDescription(e.features[0]);
                if (typeof description === 'string') {
                    popupNode.innerHTML = description;
                } else {
                    // If it's a lit-html template, render it
                    import('lit').then(({ render }) => {
                        render(description, popupNode);
                    });
                }

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
                const coursesSource = this.map.getSource('courses')
                coursesSource.getClusterExpansionZoom(
                    clusterId
                ).then((clusterExpansionZoom) => {
                    this.map.easeTo({
                        center: features[0].geometry.coordinates,
                        zoom: clusterExpansionZoom
                    });
                    if (clusterExpansionZoom > this.map.getMaxZoom()) {
                        coursesSource.getClusterLeaves(clusterId).then((leaves) => {
                            const coordinates = features[0].geometry.coordinates;
                            let description = leaves.map(leave => featureToDescription(leave)
                            );
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
                    }
                });
            });

            // Change cursor on cluster hover
            this.map.on('mouseenter', 'clusters', () => {
                this.map.getCanvas().style.cursor = 'pointer';
            });

            this.map.on('mouseleave', 'clusters', () => {
                this.map.getCanvas().style.cursor = '';
            });
            this.initializeTable();

            // Mark map as loaded to update UI
            this.mapLoaded = true;

            // Setup home control action
            this.homeControl.container.addEventListener('click', () => {
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
    }





    initializeTable() {
        this.table = new Tabulator(this.renderRoot.querySelector("#courses-table"), {
            data: this.calibrationCourses,
            index: "properties.certificateId",
            pagination: true,
            paginationSize: 15,
            paginationSizeSelector: [10, 15, 25, 50, 100],
            placeholder: "No Data Available",
            groupBy: "properties.state", // Group by state
            groupHeader: function(value, count) {
                return value + " <span class='text-muted'>(" + count + " courses)</span>";
            },
            groupToggleElement: "header",
            initialSort: this.sorts,
            initialFilter: this.filters,
            initialHeaderFilter: this.headerFilters,
            columns: [
                {title: "Certificate", field: "properties.certificateId", sorter: "string", headerSort: true, headerFilter: true,
                    formatter: function(cell) {
                        const data = cell.getRow().getData();
                        const id = data.properties.certificateId;
                        const link = data.properties.certificateLink || `https://www.certifiedroadraces.com/certificate?type=c&id=${id}`;
                        return id ? `<a href="${link}" target="_blank">${id}</a>` : "";
                    }
                },
                {title: "Course Name", field: "properties.name", sorter: "string", headerSort: true, headerFilter: true, formatter: function(cell) {
                    const data = cell.getRow().getData();
                    if (data.properties.expired) {
                        return data.properties.name + " <span class='text-secondary'>(Expired)</span>";
                    }
                    else return data.properties.name;
                    }},
                {title: "City", field: "properties.city", sorter: "string", headerSort: true, headerFilter: true},
                {title: "State", field: "properties.state", sorter: "string", headerSort: true, headerFilter: true},
                {title: "Length", field: "properties.courseLengthMeters", sorter: "string", headerSort: true, formatter: function (cell){
                    const data = cell.getRow().getData()
                        return data.properties.courseLength + data.properties.units;
                    }},
                {title: "Measurer", field: "properties.measurer", sorter: "string", headerSort: true, headerFilter: true},
                {title: "Expired", field: "properties.expired", sorter: "string", headerSort: true, headerFilter: true, visible: false}, // just for filtering on
                {
                    title: "Actions",
                    formatter: function(cell) {
                        const data = cell.getRow().getData();
                        return `
              <div class="btn-group btn-group-sm" role="group">
                <a href="https://www.google.com/maps/place/${data.geometry.coordinates[1]},${data.geometry.coordinates[0]}" target="_blank" class="btn btn-outline-primary btn-sm">
                  <i class="bi bi-map"></i> Map
                </a>
                <a href="https://www.google.com/maps/dir/?api=1&destination=${data.geometry.coordinates[1]},${data.geometry.coordinates[0]}&travelmode=driving" target="_blank" class="btn btn-outline-primary btn-sm">
                  <i class="bi bi-signpost"></i> Directions
                </a>
              </div>`;
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
            this.matchMapToTableData(rows)
            sessionStorage.setItem('tableFilters', JSON.stringify(this.filters));
            sessionStorage.setItem('tableHeaderFilters', JSON.stringify(this.headerFilters));
            console.log(this.filters, this.headerFilters);
        });

        this.table.on('dataSorted', (sorters) => {
            sessionStorage.setItem('tableSorts', JSON.stringify(this.sorts.map(value => {return {dir: value.dir, params: value.params}})));
            console.log(this.sorts)
        });

        // Reset map when filters are cleared
        this.table.on("dataFilterCleared", () => {
            // Reset to show all features
            this.matchMapToTableData(this.table.getRows())
        });



    }

    matchMapToTableData(rows) {
        console.log("Match")
        // Extract the IDs of all visible rows after filtering
        const visibleRowIds = rows.map(row => row.getData().properties.certificateId);

        // Filter the map features to only show those that match the visible rows
        const filteredFeatures = this.computeDisplayFeatures().filter(feature =>
            visibleRowIds.includes(feature.properties.certificateId)
        );

        // Update the map source with the filtered features
        this.map.getSource("courses").setData({
            type: 'FeatureCollection',
            features: filteredFeatures
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

        if (value) {
            this.table.setHeaderFilterValue("properties.state", value);
            this.headerFilters = this.headerFilters.filter(filter => filter.field === "properties.state");
            // This will trigger dataFiltered and update the map
            this.headerFilters = [...this.headerFilters, {field: "properties.state", type: "=", value: value}];
            this.zoomToFilteredFeatures();
        } else {
            this.table.setHeaderFilterValue("properties.state", "");
            this.headerFilters = this.headerFilters.filter(filter => filter.field === "properties.state");
        }
        this.requestUpdate()
    }

    handleLocationChange(e) {
        const value = e.target.value;

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
        this.requestUpdate()
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

    handleIncludeExpired(e)
    {
        if (!this.isFilterActive("properties.expired", "=", false)) {
            this.filters = [...this.filters, {field: "properties.expired", type: "=", value:false}];
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
        const description = featureToDescription(targetFeature);

        if (typeof description === 'string') {
            popupNode.innerHTML = description;
        } else {
            // If it's a lit-html template, render it
            import('lit').then(({ render }) => {
                render(description, popupNode);
            });
        }

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
            this.filters.map(filter => {this.table.setFilter(filter.field, filter.type, filter.value);})
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
        <div class="btn-toolbar gap-3 mb-3" role="toolbar">
          <div class="input-group">
            <label class="input-group-text" for="states-select">State</label>
            <select class="form-select" id="states-select" @change=${this.handleStateChange}>
              <option value="">All States</option>
              ${map(this.states, state => html`
                <option value=${state}>${state}</option>
              `)}
            </select>
          </div>

          <div class="input-group">
            <label class="input-group-text" for="locations-select">Location</label>
            <select class="form-select" id="locations-select" @change=${this.handleLocationChange}>
              <option value="">All Locations</option>
              ${map(this.locations, location => html`
                <option value=${location}>${location}</option>
              `)}
            </select>
          </div>

          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="include-expired" value="include-expired" .checked="${!this.isFilterActive('properties.expired', "=", false)}" @change=${this.handleIncludeExpired}>
            <label class="form-check-label" for="include-expired">
              Include Expired
            </label>
          </div>
        </div>


        
        <div class="map-table-container">
          <div id="map"></div>
          <div id="courses-table"></div>
        </div>
      </div>
    `;
    }
}

// Define the custom element
customElements.define('courses-view', CoursesView);