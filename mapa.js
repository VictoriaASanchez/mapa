/* Mapa de puntos de venta: Leaflet + markercluster + Google Sheets (CSV) */
(function () {
  'use strict';

  var CFG = window.MAPA_PV_CONFIG || {};
  var CSV_URL = CFG.csvUrl || '';
  var TILE_URL = CFG.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTR = CFG.tileAttribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  var PAGE = 50;

  var root = document.getElementById('pv-app');
  if (!root || !window.L) return;
  var elInput = root.querySelector('.pv-input');
  var elCount = root.querySelector('.pv-count');
  var elList = root.querySelector('.pv-list');
  var elMap = root.querySelector('.pv-map');

  var PIN_SVG = '<svg viewBox="0 0 24 30" fill="currentColor" aria-hidden="true"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 30 12 30s12-10 12-18.4C24 5.2 18.6 0 12 0zm0 16a4.4 4.4 0 1 1 0-8.8 4.4 4.4 0 0 1 0 8.8z"/></svg>';

  /* ---------- utilidades ---------- */
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { // acepta -34.60 y -34,60
    return parseFloat(String(v == null ? '' : v).trim().replace(',', '.'));
  }
  function fmt(n) { return n.toLocaleString('es-AR'); }

  function parseCSV(text) { // respeta comillas, comas y saltos de línea dentro de celdas
    var rows = [], row = [], f = '', q = false, i, c;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; rows.push(row); row = [];
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  /* ---------- mapa ---------- */
  var map = L.map(elMap, { minZoom: 2, worldCopyJump: true }).setView([-38, -63], 4);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);

  var pinIcon = L.divIcon({ className: 'pv-pin', html: PIN_SVG, iconSize: [28, 36], iconAnchor: [14, 34], popupAnchor: [0, -32] });

  var cluster = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 100,
    chunkDelay: 30,
    maxClusterRadius: 60,
    showCoverageOnHover: false,
    removeOutsideVisibleBounds: true,
    iconCreateFunction: function (c) {
      var n = c.getChildCount();
      var s = n < 100 ? 44 : n < 1000 ? 54 : 64;
      return L.divIcon({ className: 'pv-cluster', html: '<span>' + fmt(n) + '</span>', iconSize: [s, s] });
    }
  });
  map.addLayer(cluster);

  /* ---------- datos ---------- */
  var ITEMS = [], filtered = [], shown = 0, activeLi = null;

  function popupHtml(it) {
    var dir = 'https://www.google.com/maps/dir/?api=1&destination=' + it.lat + ',' + it.lng;
    return '<div class="pv-pop"><strong>' + esc(it.nombre) + '</strong><span>' + esc(it.direccion) + '</span><span>' +
      esc([it.provincia, it.pais].filter(Boolean).join(', ')) + '</span><a href="' + dir + '" target="_blank" rel="noopener">Cómo llegar</a></div>';
  }

  function load() {
    if (!CSV_URL) { elCount.textContent = 'Falta configurar la URL de la hoja.'; return; }
    elCount.textContent = 'Cargando puntos de venta…';
    var bust = (CSV_URL.indexOf('?') > -1 ? '&' : '?') + 't=' + Math.floor(Date.now() / 300000); // nueva copia cada 5 min
    fetch(CSV_URL + bust)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(build)
      .catch(function (e) {
        console.error('Mapa PV:', e);
        elCount.textContent = 'No se pudieron cargar los puntos de venta. Intentá de nuevo en unos minutos.';
      });
  }

  function build(text) {
    var rows = parseCSV(text), head = (rows.shift() || []).map(norm), idx = {}, skipped = 0;
    var alias = { pais: ['pais'], provincia: ['provincia'], nombre: ['nombre'], direccion: ['direccion'], lat: ['lat', 'latitud'], lng: ['lng', 'lon', 'longitud'] };
    Object.keys(alias).forEach(function (k) {
      idx[k] = -1;
      alias[k].forEach(function (a) { if (idx[k] < 0) idx[k] = head.indexOf(a); });
    });
    if (idx.lat < 0 || idx.lng < 0 || idx.nombre < 0) {
      elCount.textContent = 'La hoja no tiene las columnas esperadas (pais, provincia, nombre, direccion, lat, lng).';
      return;
    }
    function get(r, k) { return idx[k] > -1 ? (r[idx[k]] || '').trim() : ''; }

    rows.forEach(function (r) {
      var lat = num(get(r, 'lat')), lng = num(get(r, 'lng'));
      if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || !get(r, 'nombre')) { skipped++; return; }
      var it = { pais: get(r, 'pais'), provincia: get(r, 'provincia'), nombre: get(r, 'nombre'), direccion: get(r, 'direccion'), lat: lat, lng: lng };
      it.key = norm([it.pais, it.provincia, it.nombre, it.direccion].join(' '));
      it.sort = norm(it.nombre);
      it.marker = L.marker([lat, lng], { icon: pinIcon, title: it.nombre }).bindPopup(function () { return popupHtml(it); });
      ITEMS.push(it);
    });
    if (skipped) console.warn('Mapa PV: ' + skipped + ' filas ignoradas (coordenadas o nombre inválidos).');
    ITEMS.sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
    apply(true);
  }

  /* ---------- filtro y listado ---------- */
  function apply(fit) {
    var terms = norm(elInput.value).split(/\s+/).filter(Boolean);
    filtered = !terms.length ? ITEMS : ITEMS.filter(function (it) {
      return terms.every(function (t) { return it.key.indexOf(t) > -1; });
    });

    cluster.clearLayers();
    cluster.addLayers(filtered.map(function (it) { return it.marker; }));

    elCount.innerHTML = '<strong>' + fmt(filtered.length) + '</strong> puntos de venta';
    elList.innerHTML = '';
    elList.scrollTop = 0;
    shown = 0;
    activeLi = null;
    if (!filtered.length) {
      elList.innerHTML = '<li class="pv-empty">No encontramos puntos de venta con esa búsqueda. Probá con otro país, provincia o nombre.</li>';
      return;
    }
    more();
    if (fit) map.fitBounds(L.latLngBounds(filtered.map(function (it) { return [it.lat, it.lng]; })), { padding: [40, 40], maxZoom: 15 });
  }

  function more() {
    var frag = document.createDocumentFragment(), end = Math.min(shown + PAGE, filtered.length);
    for (; shown < end; shown++) frag.appendChild(itemEl(filtered[shown]));
    elList.appendChild(frag);
  }

  function itemEl(it) {
    var li = document.createElement('li');
    li.className = 'pv-item';
    li.innerHTML = '<button type="button">' + PIN_SVG + '<span><span class="pv-name">' + esc(it.nombre) +
      '</span><span class="pv-addr">' + esc([it.direccion, it.provincia].filter(Boolean).join(', ')) + '</span></span></button>';
    li.firstChild.addEventListener('click', function () {
      if (activeLi) activeLi.classList.remove('is-active');
      li.classList.add('is-active');
      activeLi = li;
      if (window.matchMedia('(max-width: 767px)').matches) elMap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      map.closePopup();
      cluster.zoomToShowLayer(it.marker, function () { it.marker.openPopup(); });
    });
    return li;
  }

  elList.addEventListener('scroll', function () { // scroll infinito
    if (shown < filtered.length && elList.scrollTop + elList.clientHeight > elList.scrollHeight - 200) more();
  });

  var timer;
  elInput.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { apply(true); }, 250);
  });

  load();
})();
