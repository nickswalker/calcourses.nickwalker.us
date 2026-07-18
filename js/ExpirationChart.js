import { LitElement, html, svg, nothing } from 'lit';

const VALIDITY_YEARS = 10;

// Internal SVG coordinate system. The viewBox scales this to the container, so
// every position can be expressed as a percentage of these two numbers.
const WIDTH = 720;
const HEIGHT = 300;
const MARGIN = { top: 24, right: 8, bottom: 40, left: 8 };

/**
 * Rect with rounded data-end and square baseline.
 */
function barPath(x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, height, width / 2));
    return `M${x},${y + height}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}` +
        `H${x + width - r}A${r},${r} 0 0 1 ${x + width},${y + r}V${y + height}Z`;
}

export class ExpirationChart extends LitElement {
    static properties = {
        data: { type: Array },
        hovered: { state: true }
    };

    // LightDOM, so the page's Bootstrap styles apply.
    createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this.data = [];
        this.hovered = null;
    }

    /**
     * Counts of still-valid courses by the year their certificate lapses. Only
     * current records are used, so there is no truncation at either edge.
     */
    processData() {
        const currentYear = new Date().getFullYear();
        const counts = new Map();
        for (let year = currentYear; year <= currentYear + VALIDITY_YEARS; year++) {
            counts.set(year, 0);
        }

        for (const feature of this.data ?? []) {
            const { year, expired, expires } = feature.properties;
            if (!year || expired) continue;
            const expiresIn = expires ?? year + VALIDITY_YEARS;
            if (counts.has(expiresIn)) counts.set(expiresIn, counts.get(expiresIn) + 1);
        }

        return { bins: [...counts].map(([year, count]) => ({ year, count })) };
    }

    render() {
        const { bins } = this.processData();
        const active = bins.reduce((sum, bin) => sum + bin.count, 0);

        if (active === 0) {
            return html`
              <h6>Displayed courses by expiration year</h6>
              <p class="text-secondary mb-0">No courses in the current selection.</p>`;
        }

        // Every bar carries its own value, so the chart needs no y-axis and no
        // gridlines: bar length makes the comparison, the labels give the number.
        const peak = Math.max(...bins.map(bin => bin.count));
        const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
        const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
        const baseline = MARGIN.top + plotHeight;
        const band = plotWidth / bins.length;
        const barWidth = Math.min(24, band - 2);
        const yOf = count => baseline - (count / peak) * plotHeight;
        const centerOf = index => MARGIN.left + band * index + band / 2;

        const hovered = this.hovered !== null ? bins[this.hovered] : null;
        const summary = bins.map(bin => `${bin.count} in ${bin.year}`).join(', ');

        return html`
          <h6>Displayed courses by expiration year</h6>
          <p class="text-secondary small mb-1">
            ${active.toLocaleString()} displayed ${active === 1 ? 'course' : 'courses'}.
            Certificates are valid for ${VALIDITY_YEARS} years.
          </p>

          <div class="expiration-chart-plot">
            <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid meet"
                 role="img" aria-label="Displayed courses by expiration year: ${summary}.">
              <line class="expiration-chart-baseline" x1=${MARGIN.left} x2=${WIDTH - MARGIN.right}
                    y1=${baseline} y2=${baseline}></line>

              ${bins.map((bin, index) => svg`
                <path class="expiration-chart-bar"
                      d=${barPath(centerOf(index) - barWidth / 2, yOf(bin.count), barWidth, baseline - yOf(bin.count), 4)}></path>
                ${bin.count > 0 ? svg`
                  <text class="expiration-chart-value" x=${centerOf(index)} y=${yOf(bin.count) - 7}
                        text-anchor="middle">${bin.count}</text>` : nothing}
                <text class="expiration-chart-tick" x=${centerOf(index)} y=${baseline + 18}
                      text-anchor="middle">${bin.year}</text>`)}

              ${bins.map((bin, index) => svg`
                <rect class="expiration-chart-hit" x=${MARGIN.left + band * index} y=${MARGIN.top}
                      width=${band} height=${plotHeight}
                      @mouseenter=${() => { this.hovered = index; }}
                      @mouseleave=${() => { this.hovered = null; }}></rect>`)}
            </svg>

            ${hovered ? html`
              <div class="expiration-chart-tooltip"
                   style="left:${centerOf(this.hovered) / WIDTH * 100}%; top:${yOf(hovered.count) / HEIGHT * 100}%">
                <strong>${hovered.count}</strong>
                ${hovered.count === 1 ? 'course' : 'courses'} expire${hovered.count === 1 ? 's' : ''}
                in ${hovered.year}
                <div class="text-secondary">Measured ${hovered.year - VALIDITY_YEARS}</div>
              </div>` : nothing}
          </div>
        `;
    }
}

customElements.define('expiration-chart', ExpirationChart);
