export class CoordinateOverlayControl {
    constructor(getCoords) {
        this._getCoords = getCoords;
        this._mode = 'decimal';
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

        this._label = document.createElement('div');
        this._label.style.padding = '5px';
        this._label.style.cursor = 'pointer';
        this._container.appendChild(this._label);

        this._label.addEventListener('click', () => {
            this._cycleMode();
            this._update();
        });
    }

    onAdd(map) {
        this._map = map;
        this._update();
        return this._container;
    }

    onRemove() {
        this._container.remove();
        this._map = undefined;
    }
    getPrecisionFromAccuracy(accuracy) {
        if (accuracy > 1000) return 2;
        if (accuracy > 100) return 3;
        if (accuracy > 10) return 4;
        if (accuracy > 1) return 5;
        return 6;
    }

    update(coords) {
        this._coords = coords;
        this._update();
    }

    _update() {
        if (!this._coords) {
            this._label.textContent = '';
            this._container.setAttribute("hidden", "true");
            return;
        }
        this._container.removeAttribute("hidden");
        const prec = this.getPrecisionFromAccuracy(this._coords.accuracy);

        const lat = this._coords.latitude;
        const lng = this._coords.longitude;
        const accuracy = this._coords.accuracy;
        switch (this._mode) {
            case 'decimal':
                this._label.textContent = `${lat.toFixed(prec)}, ${lng.toFixed(prec)}`;
                break;
            case 'dms':
                this._label.textContent = `${this._toDMS(lat, accuracy,'NS')} ${this._toDMS(lng, accuracy,'EW')}`;
                break;
            case 'cardinal':
                this._label.textContent = `${this._toCardinal(lat,prec, 'NS')}, ${this._toCardinal(lng,prec, 'EW')}`;
                break;
        }
    }

    _cycleMode() {
        this._mode = this._mode === 'decimal' ? 'dms' :
            this._mode === 'dms' ? 'cardinal' : 'decimal';
    }

    _toDMS(deg, accuracy, axis) {
        const abs = Math.abs(deg);
        const d = Math.floor(abs);
        const mFloat = (abs - d) * 60;
        const m = Math.floor(mFloat);
        const sFloat = (mFloat - m) * 60;

        const dir = deg >= 0 ? axis[0] : axis[1];

        if (accuracy > 10000) {
            return `${d}° ${dir}`; // ~11 km+
        } else if (accuracy > 1000) {
            return `${d}°${m}′ ${dir}`; // ~1 km
        } else {
            let decimals;
            if (accuracy > 100) decimals = 0;
            else if (accuracy > 10) decimals = 1;
            else if (accuracy > 1) decimals = 2;
            else decimals = 3;

            const s = sFloat.toFixed(decimals);
            return `${d}°${m}′${s}″ ${dir}`;
        }
    }

    _toCardinal(deg, prec, axis) {
        const abs = Math.abs(deg).toFixed(prec);
        const dir = deg >= 0 ? axis[0] : axis[1];
        return `${abs}° ${dir}`;
    }
}