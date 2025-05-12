
export class FrameControl {
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
        this.container.querySelector("span").style.backgroundImage = "url('data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMSIgdmlld0JveD0iMCAwIDMwIDMwIj4KICA8ZGVmcz4KICAgIDxzdHlsZT4KICAgICAgLmNscy0xIHsKICAgICAgICBmaWxsOiAjMzMzOwogICAgICAgIHN0cm9rZS13aWR0aDogMHB4OwogICAgICB9CiAgICA8L3N0eWxlPgogIDwvZGVmcz4KICA8cGF0aCBjbGFzcz0iY2xzLTEiIGQ9Ik0xOCw4aDNjLjYsMCwxLC40LDEsMXYzYzAsLjYuNCwxLDEsMWgxYy42LDAsMS0uNCwxLTF2LTZjMC0uNi0uNC0xLTEtMWgtNmMtLjYsMC0xLC40LTEsMXYxYzAsLjYuNCwxLDEsMVoiLz4KICA8cGF0aCBjbGFzcz0iY2xzLTEiIGQ9Ik04LDEydi0zYzAtLjYuNC0xLDEtMWgzYy42LDAsMS0uNCwxLTF2LTFjMC0uNi0uNC0xLTEtMWgtNmMtLjYsMC0xLC40LTEsMXY2YzAsLjYuNCwxLDEsMWgxYy42LDAsMS0uNCwxLTFaIi8+CiAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNMjIsMTh2M2MwLC42LS40LDEtMSwxaC0zYy0uNiwwLTEsLjQtMSwxdjFjMCwuNi40LDEsMSwxaDZjLjYsMCwxLS40LDEtMXYtNmMwLS42LS40LTEtMS0xaC0xYy0uNiwwLTEsLjQtMSwxWiIvPgogIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTEyLDIyaC0zYy0uNiwwLTEtLjQtMS0xdi0zYzAtLjYtLjQtMS0xLTFoLTFjLS42LDAtMSwuNC0xLDF2NmMwLC42LjQsMSwxLDFoNmMuNiwwLDEtLjQsMS0xdi0xYzAtLjYtLjQtMS0xLTFaIi8+Cjwvc3ZnPg==')";
        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}