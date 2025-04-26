import { LitElement, html, css } from 'lit';
import { map } from 'lit-html/directives/map.js';
import { repeat } from 'lit-html/directives/repeat.js';

export class MeasurerStats extends LitElement {
    // Use LightDOM instead of ShadowDOM
    createRenderRoot() {
        return this;
    }

    static properties = {
        data: { type: Array },
        limit: { type: Number }
    };

    constructor() {
        super();
        this.data = [];
        this.limit = 10; // Default to showing top 10 measurers
    }

    calculateMeasurerStats() {
        if (!this.data || this.data.length === 0) {
            return [];
        }

        // Create a map to count courses per measurer
        const measurerMap = new Map();

        // Count courses for each measurer
        this.data.forEach(course => {
            const measurer = course.properties.measurer;
            if (measurer) {
                if (measurerMap.has(measurer)) {
                    measurerMap.set(measurer, measurerMap.get(measurer) + 1);
                } else {
                    measurerMap.set(measurer, 1);
                }
            }
        });

        // Convert map to array and sort by count (descending) then by name (ascending) for ties
        const measurerStats = Array.from(measurerMap, ([name, count]) => ({ name, count }))
            .sort((a, b) => {
                // First sort by count (descending)
                if (b.count !== a.count) {
                    return b.count - a.count;
                }
                // If counts are equal (tie), sort alphabetically by name
                return a.name.localeCompare(b.name);
            });

        // Add rank property to each measurer, accounting for ties
        let currentRank = 1;
        let previousCount = null;
        let rankToAssign = 1;

        measurerStats.forEach((measurer, index) => {
            // If this count differs from previous, update the rankToAssign
            if (measurer.count !== previousCount) {
                rankToAssign = currentRank;
            }

            // Assign the current rank
            measurer.rank = rankToAssign;

            // Always increment currentRank for the next item
            currentRank++;

            // Store this count for next comparison
            previousCount = measurer.count;
        });

        return measurerStats;
    }

    render() {
        const measurerStats = this.calculateMeasurerStats();
        const totalMeasurers = measurerStats.length;
        const displayStats = this.limit > 0 ? measurerStats.slice(0, this.limit) : measurerStats;

        return html`
          <div class="container">
            <h6>Measurers by Course Count</h6>

            ${measurerStats.length > 0
                    ? html`
                      <ol class="measurer-list">
                        ${repeat(displayStats, measurer => measurer.name, (measurer, index) => html`
                          <li class="measurer-item" value="${measurer.rank}">
                            ${measurer.name} <span class="measurer-count text-secondary">(${measurer.count})</span>
                          </li>
                        `)}
                      </ol>

                      <div class="text-secondary">
                        ${displayStats.length < totalMeasurers
                                ? html`Showing top ${displayStats.length} of ${totalMeasurers} measurers`
                                : html`Showing all ${totalMeasurers} measurers`}
                      </div>
                    `
                    : html`<div>No measurer data available</div>`
            }
          </div>
        `;
    }
}

customElements.define('measurer-stats', MeasurerStats);