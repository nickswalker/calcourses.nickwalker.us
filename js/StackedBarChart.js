import { LitElement, html } from 'lit';
import * as d3 from 'd3';

export class StackedBarChart extends LitElement {
    static properties = {
        data: { type: Array },
        height: { type: Number }
    };

    constructor() {
        super();
        this.data = [];
        this.height = 500;
        this.margin = { top: 40, right: 30, bottom: 60, left: 60 }; // Reduced right margin
        this._resizeHandler = this._handleResize.bind(this);
    }

    // Override createRenderRoot to use Light DOM
    createRenderRoot() {
        return this;
    }

    static get styles() {
        return `
        stacked-bar-chart {
            display: block;
            width: 100%;
        }

        .chart-container {
            position: relative;
            width: 100%;
        }

        stacked-bar-chart svg {
            width: 100%;
            height: auto;
        }

        .tooltip {
            position: absolute;
            background: rgba(255, 255, 255, 0.95);
            border: 1px solid #ccc;
            border-radius: 5px;
            padding: 10px;
            font-size: 12px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            z-index: 100;
            max-width: 200px;
        }

        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 300px;
            font-style: italic;
            color: #666;
        }
        `;
    }

    // Inject styles into document head
    _injectStyles() {
        if (!document.querySelector('#stacked-bar-chart-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'stacked-bar-chart-styles';
            styleEl.textContent = StackedBarChart.styles;
            document.head.appendChild(styleEl);
        }
    }

    connectedCallback() {
        super.connectedCallback();
        this._injectStyles();
        window.addEventListener('resize', this._resizeHandler);
        // Wait for the next tick to ensure the DOM is ready
        setTimeout(() => {
            this.renderChart();
        }, 0);
    }

    disconnectedCallback() {
        window.removeEventListener('resize', this._resizeHandler);
        super.disconnectedCallback();
    }

    _handleResize() {
        this.renderChart();
    }

    updated(changedProperties) {
        if (changedProperties.has('data')) {
            this.renderChart();
        }
    }

    getChartWidth() {
        const chartContainer = this.querySelector('.chart-container');
        return chartContainer ? chartContainer.clientWidth : 800;
    }

    processData() {
        if (!this.data || this.data.length === 0) return [];

        // Group courses by year
        const yearGroups = {};

        // iterate over years from 2013 to present
        const currentYear = new Date().getFullYear();
        for (let year = 2013; year <= currentYear; year++) {
            // Each is an array of 11 elements, each representing a course age
            yearGroups[year] = Array(11).fill(0);
        }

        this.data.forEach(feature => {
            const year = feature.properties.year;
            // For each yearGroup, increment the count for number of courses of age
            for (let i = 0; i < 11; i++) {
                const yearIndex = year + i;
                if (yearGroups[yearIndex]) {
                    yearGroups[yearIndex][i]++;
                }
            }
        });

        // Convert to array format for D3
        const result = Object.keys(yearGroups).map(year => {
            const yearData = { year: +year };
            yearGroups[year].forEach((count, index) => {
                yearData[`age${index}`] = count;
            });
            return yearData;
        });

        return result.sort((a, b) => a.year - b.year);
    }

    // Smart tooltip positioning function
    positionTooltip(tooltip, mouseX, mouseY, containerRect, tooltipWidth) {
        const buffer = 10; // Space between cursor and tooltip
        const rightEdge = containerRect.width;

        // Check if tooltip would exceed right edge
        if (mouseX + tooltipWidth + buffer > rightEdge) {
            // Position to the left of the cursor
            tooltip
                .style('left', `${mouseX - tooltipWidth - buffer}px`)
                .style('top', `${mouseY - 40}px`);
        } else {
            // Position to the right of the cursor (default)
            tooltip
                .style('left', `${mouseX + buffer}px`)
                .style('top', `${mouseY - 40}px`);
        }
    }

    renderChart() {
        const chartContainer = this.querySelector('.chart-container');
        if (!chartContainer) return;

        // Clear previous chart
        chartContainer.innerHTML = '';

        if (!this.data || this.data.length === 0) {
            chartContainer.innerHTML = '<div class="loading">No data available</div>';
            return;
        }

        const data = this.processData();
        if (data.length === 0) {
            chartContainer.innerHTML = '<div class="loading">No data available after processing</div>';
            return;
        }

        // Find all age keys
        const ageKeys = [];
        for (let i = 0; i < 11; i++) {
            ageKeys.push(`age${i}`);
        }

        const width = this.getChartWidth();
        const effectiveWidth = width - this.margin.right - this.margin.left;

        // Create SVG with viewBox for responsiveness
        const svg = d3.create('svg')
            .attr('viewBox', `0 0 ${width} ${this.height}`)
            .attr('preserveAspectRatio', 'xMidYMid meet');

        // Create tooltip
        const tooltip = d3.select(chartContainer)
            .append('div')
            .attr('class', 'tooltip');

        // Setup scales
        const x = d3.scaleBand()
            .domain(data.map(d => d.year))
            .range([this.margin.left, width - this.margin.right])
            .padding(0.1);

        // Create stack generator
        const stack = d3.stack()
            .keys(ageKeys)
            .order(d3.stackOrderNone)
            .offset(d3.stackOffsetNone);

        const series = stack(data);

        // Calculate max y value
        const yMax = d3.max(series, layer => d3.max(layer, d => d[1]));

        const y = d3.scaleLinear()
            .domain([0, yMax])
            .range([this.height - this.margin.bottom, this.margin.top]);

        // Calculate totals for each year
        const yearTotals = data.map(d => {
            return {
                year: d.year,
                total: ageKeys.reduce((sum, key) => sum + d[key], 0)
            };
        });

        // Color scale - use d3.schemeSpectral for age visualization
        // Reverse the colors so younger ages are warmer (red/orange) and older ages are cooler (blue/purple)
        const colorScale = d3.scaleOrdinal()
            .domain(ageKeys)
            .range(d3.schemeSpectral[11].slice());

        // Draw bars
        svg.append('g')
            .selectAll('g')
            .data(series)
            .join('g')
            .attr('fill', d => colorScale(d.key))
            .selectAll('rect')
            .data(d => d)
            .join('rect')
            .attr('x', d => x(d.data.year))
            .attr('y', d => y(d[1]))
            .attr('height', d => y(d[0]) - y(d[1]))
            .attr('width', x.bandwidth())
            .on('mouseover', (event, d) => {
                const ageKey = d3.select(event.currentTarget.parentNode).datum().key;
                const ageYear = parseInt(ageKey.replace('age', ''));
                const count = d[1] - d[0];
                const birthYear = d.data.year - ageYear;

                // Get container bounds
                const containerRect = chartContainer.getBoundingClientRect();

                // Calculate position relative to container
                const mouseX = event.clientX - containerRect.left;
                const mouseY = event.clientY - containerRect.top;

                // Show tooltip
                tooltip
                    .style('opacity', 1)
                    .html(`
                    <div><strong>Year:</strong> ${d.data.year}</div>
                    <div><strong>Course Age:</strong> ${ageYear} ${ageYear === 1 ? 'year' : 'years'}</div>
                    <div><strong>Measured Year:</strong> ${birthYear}</div>
                    <div><strong>Count:</strong> ${count}</div>
                  `);

                // Get tooltip dimensions AFTER content is set
                const tooltipNode = tooltip.node();
                const tooltipWidth = tooltipNode.offsetWidth;

                // Position tooltip smartly
                this.positionTooltip(tooltip, mouseX, mouseY, containerRect, tooltipWidth);
            })
            .on('mouseout', function() {
                tooltip.style('opacity', 0);
            });

        // Add total counts on top of each stack with less emphasis
        svg.append('g')
            .selectAll('text')
            .data(yearTotals)
            .join('text')
            .attr('x', d => x(d.year) + x.bandwidth() / 2)
            .attr('y', d => y(d.total) - 5) // Position above the top of each bar
            .attr('text-anchor', 'middle')
            .attr('font-size', '11px')
            .attr('fill', '#666')
            .text(d => d.total);

        // Add axes
        svg.append('g')
            .attr('transform', `translate(0,${this.height - this.margin.bottom})`)
            .call(d3.axisBottom(x)
                .tickSizeOuter(0)
                .tickFormat(d => `'${String(d).slice(2)}`)
            )
            .call(g => g.append('text')
                .attr('x', width / 2)
                .attr('y', 40)
                .attr('fill', 'currentColor')
                .attr('text-anchor', 'middle')
                .attr("class","h6")
                .attr('font-size', '13px')
                .text('Year'));

        // Modify Y-axis to only display integer values
        svg.append('g')
            .attr('transform', `translate(${this.margin.left},0)`)
            .call(d3.axisLeft(y)
                .tickFormat(d3.format('d'))  // Format as integer (no decimal places)
                .ticks(Math.min(10, Math.floor(yMax)))  // Limit ticks to integer values
            )
            .call(g => g.append('text')
                .attr('x', -40)
                .attr('y', this.height / 2)
                .attr('fill', 'currentColor')
                .attr('text-anchor', 'middle')
                .attr('transform', `rotate(-90,-40,${this.height / 2})`)
                .attr('font-size', '13px')
                .attr("class","h6")
                .text('Count'));

        // Add compact legend in the upper left
        const legendBlockWidth = 20; // Width of each color block
        const legendTotalWidth = legendBlockWidth * ageKeys.length;

        // Create legend container - position just right of y-axis, near the top
        const legend = svg.append('g')
            .attr('transform', `translate(${this.margin.left + 15}, ${this.margin.top + 10})`);

        // Add subtle legend title
        legend.append('text')
            .attr('x', 0)
            .attr('y', -5)
            .attr('font-size', '10px')
            .text('Course Age (years)');

        // Add legend items with color blocks butted together
        ageKeys.forEach((key, i) => {
            const age = parseInt(key.replace('age', ''));
            const g = legend.append('g')
                .attr('transform', `translate(${i * legendBlockWidth}, 0)`);

            // Color block
            g.append('rect')
                .attr('width', legendBlockWidth)
                .attr('height', 12)
                .attr('fill', colorScale(key));

            // Label below color block
            g.append('text')
                .attr('x', legendBlockWidth / 2)
                .attr('y', 24)
                .attr('text-anchor', 'middle')
                .attr('font-size', '9px')
                .text(`${age}`);
        });

        // Add title
        svg.append('text')
            .attr('x', this.margin.left)
            .attr('y', this.margin.top / 2)
            .attr('text-anchor', 'left')
            .attr("class", "h5")
            .text('Course Age Distribution Over Time');

        // Append to container
        chartContainer.appendChild(svg.node());
    }

    render() {
        return html`<div class="chart-container"></div>`;
    }
}

// Define the custom element
customElements.define('stacked-bar-chart', StackedBarChart);