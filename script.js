// ── World Photos — Interactive Travel Map ───────────────────────────

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────
  const DATA_URL  = 'photos.json';
  const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> · ' +
                    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
  const DAY_MS    = 86400000;

  // ── State ──────────────────────────────────────
  let photos   = [];
  let markers  = [];
  let map, slider, clusterGroup;
  let playInterval = null;
  let globalMinTs, globalMaxTs;

  // Panel / lightbox state
  let panelPhotos = [];     // photos visible in current viewport
  let panelIndex  = 0;      // current hero image index
  let panelOpen   = false;
  let panelManualClose = false; // user explicitly closed
  let panelResizing = false;    // guard against invalidateSize re-triggering
  const PANEL_ZOOM_THRESHOLD = 10;  // show panel at this zoom+

  // Submarine state
  let subMarker = null;       // Leaflet marker for the sub on the map
  let subTrailLine = null;    // Leaflet polyline trail
  let subAnimating = false;
  let subAnimFrame = null;
  const SUB_DISTANCE_THRESHOLD = 300; // km — trigger animation above this

  // ── Helpers ────────────────────────────────────
  function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  function formatShortDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    });
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function createMarkerIcon(approximate) {
    return L.divIcon({
      className: approximate ? 'photo-marker photo-marker-approx' : 'photo-marker',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -10]
    });
  }

  // ── Submarine helpers ──────────────────────────
  // Haversine distance in km
  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Get the centroid of photos on a given day
  function getDayCentroid(ts) {
    var key = dayKey(ts);
    var pts = photos.filter(function (p) { return dayKey(p.timestamp) === key; });
    if (pts.length === 0) return null;
    var lat = 0, lng = 0;
    pts.forEach(function (p) { lat += p.lat; lng += p.lng; });
    return { lat: lat / pts.length, lng: lng / pts.length };
  }

  // Position the fixed SVG submarine to match a map latlng
  function positionSubSVG(latlng) {
    var sub = document.getElementById('submarine');
    var pt = map.latLngToContainerPoint(latlng);
    if (!pt) return;
    sub.style.left = (pt.x - 40) + 'px';
    sub.style.top  = (pt.y - 22) + 'px';
  }

  // Spawn a CSS bubble near the submarine
  function spawnBubble() {
    var sub = document.getElementById('submarine');
    if (!sub.classList.contains('sub-visible')) return;
    var rect = sub.getBoundingClientRect();
    var bubble = document.createElement('div');
    bubble.className = 'sub-bubble';
    bubble.style.left = (rect.left + 6 + Math.random() * 16) + 'px';
    bubble.style.top  = (rect.top + Math.random() * 20) + 'px';
    document.body.appendChild(bubble);
    setTimeout(function () { bubble.remove(); }, 1200);
  }

  // Animate submarine from pointA to pointB on the map
  function animateSubmarine(fromLL, toLL, callback) {
    var sub = document.getElementById('submarine');
    sub.classList.add('sub-visible', 'sub-bobbing');
    subAnimating = true;

    // Flip submarine horizontally if traveling west
    if (toLL.lng < fromLL.lng) {
      sub.style.transform = 'scaleX(-1)';
    } else {
      sub.style.transform = 'scaleX(1)';
    }

    // Draw dashed trail line on the map
    if (subTrailLine) {
      map.removeLayer(subTrailLine);
    }
    subTrailLine = L.polyline([[fromLL.lat, fromLL.lng], [toLL.lat, toLL.lng]], {
      color: '#ffe600',
      weight: 2,
      dashArray: '8 6',
      opacity: 0.5,
      className: 'sub-trail'
    }).addTo(map);

    // Fit map to show the whole journey
    var journeyBounds = L.latLngBounds(
      [fromLL.lat, fromLL.lng],
      [toLL.lat, toLL.lng]
    );
    map.fitBounds(journeyBounds.pad(0.3));

    // Animate over ~2 seconds (60 frames)
    var totalFrames = 80;
    var frame = 0;
    var bubbleCounter = 0;

    function step() {
      frame++;
      var t = frame / totalFrames;
      // Ease in-out
      t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      var lat = fromLL.lat + (toLL.lat - fromLL.lat) * t;
      var lng = fromLL.lng + (toLL.lng - fromLL.lng) * t;

      var latlng = L.latLng(lat, lng);
      var pt = map.latLngToContainerPoint(latlng);

      sub.style.left = (pt.x - 40) + 'px';
      sub.style.top  = (pt.y - 22) + 'px';

      // Spawn bubbles periodically
      bubbleCounter++;
      if (bubbleCounter % 4 === 0) {
        spawnBubble();
      }

      if (frame < totalFrames) {
        subAnimFrame = requestAnimationFrame(step);
      } else {
        // Done
        sub.classList.remove('sub-visible', 'sub-bobbing');
        sub.style.transform = '';
        subAnimating = false;
        // Fade trail after a moment
        setTimeout(function () {
          if (subTrailLine) {
            map.removeLayer(subTrailLine);
            subTrailLine = null;
          }
        }, 800);
        if (callback) callback();
      }
    }

    subAnimFrame = requestAnimationFrame(step);
  }

  function cancelSubAnimation() {
    if (subAnimFrame) {
      cancelAnimationFrame(subAnimFrame);
      subAnimFrame = null;
    }
    var sub = document.getElementById('submarine');
    sub.classList.remove('sub-visible', 'sub-bobbing');
    sub.style.transform = '';
    subAnimating = false;
    if (subTrailLine) {
      map.removeLayer(subTrailLine);
      subTrailLine = null;
    }
    // Clean up any lingering bubbles
    document.querySelectorAll('.sub-bubble').forEach(function (b) { b.remove(); });
  }

  // ── Initialise Map ─────────────────────────────
  function initMap() {
    map = L.map('map', {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(map);
  }

  // ── Build Markers ──────────────────────────────
  function buildMarkers() {
    if (clusterGroup) {
      map.removeLayer(clusterGroup);
    }
    markers = [];

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: function (cluster) {
        var count = cluster.getChildCount();
        var size = 'small';
        if (count >= 50) size = 'large';
        else if (count >= 10) size = 'medium';
        return L.divIcon({
          html: '<div><span>' + count + '</span></div>',
          className: 'photo-cluster photo-cluster-' + size,
          iconSize: L.point(44, 44)
        });
      }
    });

    photos.forEach(function (photo) {
      var approxBadge = photo.approximate
        ? '<div class="approx-badge">📍 Approximate location</div>'
        : '';

      var popup = '<div class="photo-popup">' +
        '<img src="' + photo.path + '" alt="' + (photo.filename || '') + '" loading="lazy" />' +
        '<div class="caption">' +
          '<strong>' + (photo.filename || 'Photo') + '</strong><br>' +
          formatDate(photo.timestamp) +
          approxBadge +
        '</div>' +
      '</div>';

      var marker = L.marker([photo.lat, photo.lng], { icon: createMarkerIcon(photo.approximate) })
        .bindPopup(popup, { maxWidth: 340, minWidth: 200 });

      marker._photoTimestamp = photo.timestamp;
      markers.push(marker);
    });

    clusterGroup.addLayers(markers);
    map.addLayer(clusterGroup);
  }

  // ── Filter by Date Range ───────────────────────
  function filterMarkers(minTs, maxTs) {
    if (!clusterGroup) return;

    var toAdd = [];
    var toRemove = [];
    var visibleCount = 0;

    markers.forEach(function (m) {
      var visible = m._photoTimestamp >= minTs && m._photoTimestamp <= maxTs;
      var inCluster = clusterGroup.hasLayer(m);

      if (visible) visibleCount++;

      if (visible && !inCluster) {
        toAdd.push(m);
      } else if (!visible && inCluster) {
        toRemove.push(m);
      }
    });

    if (toRemove.length) clusterGroup.removeLayers(toRemove);
    if (toAdd.length)    clusterGroup.addLayers(toAdd);

    updatePhotoCount(visibleCount);
    updateHistogramHighlight(minTs, maxTs);
  }

  // ── Photo count badge ──────────────────────────
  function updatePhotoCount(count) {
    var el = document.getElementById('photo-count');
    el.textContent = count + ' of ' + photos.length + ' photos';
  }

  // ── Histogram ──────────────────────────────────
  function buildHistogram() {
    var container = document.getElementById('histogram');
    container.innerHTML = '';

    // Build day → count map
    var dayCounts = {};
    photos.forEach(function (p) {
      var key = dayKey(p.timestamp);
      dayCounts[key] = (dayCounts[key] || 0) + 1;
    });

    // Generate all days between min and max
    var current = startOfDay(globalMinTs);
    var end     = startOfDay(globalMaxTs);
    var days    = [];

    while (current <= end) {
      var key = dayKey(current);
      days.push({ ts: current, key: key, count: dayCounts[key] || 0 });
      current += DAY_MS;
    }

    var maxCount = Math.max.apply(null, days.map(function (d) { return d.count; }));
    if (maxCount === 0) maxCount = 1;

    days.forEach(function (day) {
      var bar = document.createElement('div');
      bar.className = 'hist-bar active';
      var h = day.count > 0 ? Math.max(8, (day.count / maxCount) * 100) : 4;
      bar.style.height = h + '%';
      bar.setAttribute('data-ts', day.ts);
      bar.setAttribute('data-tooltip', formatShortDate(day.ts) + ': ' + day.count + ' photo' + (day.count !== 1 ? 's' : ''));
      container.appendChild(bar);
    });
  }

  function updateHistogramHighlight(minTs, maxTs) {
    var bars = document.querySelectorAll('.hist-bar');
    bars.forEach(function (bar) {
      var ts = Number(bar.getAttribute('data-ts'));
      if (ts >= startOfDay(minTs) && ts <= startOfDay(maxTs)) {
        bar.classList.add('active');
      } else {
        bar.classList.remove('active');
      }
    });
  }

  // ── Week ticks ─────────────────────────────────
  function buildWeekTicks() {
    var container = document.getElementById('month-ticks');
    container.innerHTML = '';

    var totalSpan = globalMaxTs - globalMinTs;
    if (totalSpan <= 0) return;

    // Start from the Monday of or after globalMinTs
    var d = new Date(globalMinTs);
    // Advance to next Monday (1 = Monday)
    var dow = d.getDay();
    var daysUntilMon = (dow === 0) ? 1 : (dow === 1 ? 0 : 8 - dow);
    d.setDate(d.getDate() + daysUntilMon);
    d.setHours(0, 0, 0, 0);

    while (d.getTime() <= globalMaxTs) {
      var tick = document.createElement('div');
      tick.className = 'tick';

      var pct = ((d.getTime() - globalMinTs) / totalSpan) * 100;
      tick.style.left = pct + '%';

      var label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      tick.setAttribute('data-label', label);

      container.appendChild(tick);

      // Advance 7 days
      d.setDate(d.getDate() + 7);
    }
  }

  // ── Initialise Timeline Slider ─────────────────
  function initSlider() {
    var timestamps = photos.map(function (p) { return p.timestamp; });
    globalMinTs = Math.min.apply(null, timestamps);
    globalMaxTs = Math.max.apply(null, timestamps);

    var label = document.getElementById('date-range-label');
    label.textContent = formatDate(globalMinTs) + ' — ' + formatDate(globalMaxTs);

    var el = document.getElementById('timeline-slider');

    slider = noUiSlider.create(el, {
      start: [globalMinTs, globalMaxTs],
      connect: true,
      range: { min: globalMinTs, max: globalMaxTs },
      step: DAY_MS,
      behaviour: 'drag-tap',
      tooltips: [
        { to: function (v) { return formatDate(v); } },
        { to: function (v) { return formatDate(v); } }
      ]
    });

    slider.on('update', function (values) {
      var lo = Number(values[0]);
      var hi = Number(values[1]);
      label.textContent = formatDate(lo) + ' — ' + formatDate(hi);
      filterMarkers(lo, hi);
    });

    // Build visual aids
    buildHistogram();
    buildWeekTicks();
    updatePhotoCount(photos.length);
  }

  // ── Play / Pause ───────────────────────────────
  function initPlayButton() {
    var btn = document.getElementById('btn-play');

    btn.addEventListener('click', function () {
      if (playInterval) {
        stopPlay();
      } else {
        startPlay();
      }
    });
  }

  function startPlay() {
    var btn = document.getElementById('btn-play');
    btn.classList.add('playing');
    btn.textContent = '⏸';

    // Play: advance a 3-day window across the timeline
    var windowSize = DAY_MS * 3;
    var current = globalMinTs;
    var lastCentroid = getDayCentroid(current);

    function advanceDay() {
      if (!playInterval) return; // stopped

      current += DAY_MS;
      var lo = current;
      var hi = Math.min(current + windowSize, globalMaxTs);

      if (lo > globalMaxTs) {
        stopPlay();
        slider.set([globalMinTs, globalMaxTs]);
        return;
      }

      // Check if there's a big distance jump → submarine time!
      var centroid = getDayCentroid(current);
      if (centroid && lastCentroid) {
        var dist = haversineKm(lastCentroid.lat, lastCentroid.lng, centroid.lat, centroid.lng);
        if (dist > SUB_DISTANCE_THRESHOLD) {
          // Pause the interval, animate the sub, then resume
          clearInterval(playInterval);
          playInterval = -1; // sentinel: still "playing" but paused for animation

          slider.set([lo, hi]);
          animateSubmarine(
            { lat: lastCentroid.lat, lng: lastCentroid.lng },
            { lat: centroid.lat, lng: centroid.lng },
            function () {
              // Resume playback after animation
              if (playInterval === -1) {
                playInterval = setInterval(advanceDay, 300);
              }
            }
          );
          lastCentroid = centroid;
          return;
        }
      }
      if (centroid) lastCentroid = centroid;

      slider.set([lo, hi]);
    }

    playInterval = setInterval(advanceDay, 300);
  }

  function stopPlay() {
    var btn = document.getElementById('btn-play');
    btn.classList.remove('playing');
    btn.textContent = '▶';
    if (playInterval && playInterval !== -1) {
      clearInterval(playInterval);
    }
    playInterval = null;
    cancelSubAnimation();
  }

  // ── Show All button ────────────────────────────
  function initShowAllButton() {
    var btn = document.getElementById('btn-show-all');
    btn.addEventListener('click', function () {
      stopPlay();
      slider.set([globalMinTs, globalMaxTs]);
    });
  }

  // ── Fit map bounds to markers ──────────────────
  function fitBounds() {
    if (photos.length === 0 || !clusterGroup) return;
    var bounds = clusterGroup.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.15));
    }
  }

  // ── Show "no data" message ─────────────────────
  function showNoData() {
    var div = document.createElement('div');
    div.className = 'no-data-msg';
    div.innerHTML =
      '<h2>No Photos Found</h2>' +
      '<p>Run <code>python extract_exif.py</code> to generate <code>photos.json</code> from your <code>/images</code> folder, then reload this page.</p>';
    document.body.appendChild(div);

    document.getElementById('date-range-label').textContent = 'No data';
  }

  // ── Photo Panel ────────────────────────────────
  function getVisiblePhotos() {
    if (!map) return [];
    var bounds = map.getBounds();
    // Also check if marker is in the cluster (timeline-filtered)
    return photos.filter(function (p) {
      if (!bounds.contains([p.lat, p.lng])) return false;
      // Find matching marker and check if visible
      for (var i = 0; i < markers.length; i++) {
        var m = markers[i];
        if (m._photoTimestamp === p.timestamp &&
            m.getLatLng().lat === p.lat &&
            m.getLatLng().lng === p.lng) {
          return clusterGroup.hasLayer(m);
        }
      }
      return false;
    });
  }

  function showPanel(visiblePhotos) {
    panelPhotos = visiblePhotos;
    panelIndex = 0;
    panelOpen = true;
    panelManualClose = false;

    var panel = document.getElementById('photo-panel');
    panel.classList.remove('panel-hidden');

    updatePanelContent();
    buildThumbnails();

    // On desktop the panel pushes the map — need invalidateSize
    // On mobile (overlay) the map size doesn't change
    var isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      panelResizing = true;
      setTimeout(function () {
        map.invalidateSize();
        setTimeout(function () { panelResizing = false; }, 100);
      }, 360);
    }
  }

  function hidePanel() {
    panelOpen = false;
    var panel = document.getElementById('photo-panel');
    panel.classList.add('panel-hidden');

    var isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      panelResizing = true;
      setTimeout(function () {
        map.invalidateSize();
        setTimeout(function () { panelResizing = false; }, 100);
      }, 360);
    }
  }

  function updatePanelContent() {
    if (panelPhotos.length === 0) return;

    var photo = panelPhotos[panelIndex];
    var heroImg = document.getElementById('hero-img');
    var caption = document.getElementById('panel-caption');
    var counter = document.getElementById('panel-counter');

    heroImg.src = photo.path;
    heroImg.alt = photo.filename || 'Photo';

    var dateStr = formatDate(photo.timestamp);
    var approx = photo.approximate ? ' · 📍 Approx. location' : '';
    caption.innerHTML = '<strong>' + (photo.filename || 'Photo') + '</strong> · ' + dateStr + approx;

    counter.textContent = (panelIndex + 1) + ' / ' + panelPhotos.length;

    // Highlight active thumb
    var thumbs = document.querySelectorAll('.thumb');
    thumbs.forEach(function (t, i) {
      t.classList.toggle('active', i === panelIndex);
    });

    // Scroll active thumb into view
    var activeThumb = document.querySelector('.thumb.active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function buildThumbnails() {
    var container = document.getElementById('panel-thumbs');
    container.innerHTML = '';

    panelPhotos.forEach(function (photo, idx) {
      var thumb = document.createElement('div');
      thumb.className = 'thumb' + (idx === panelIndex ? ' active' : '');

      var img = document.createElement('img');
      img.src = photo.path;
      img.alt = photo.filename || '';
      img.loading = 'lazy';
      thumb.appendChild(img);

      thumb.addEventListener('click', function () {
        panelIndex = idx;
        updatePanelContent();
      });

      container.appendChild(thumb);
    });
  }

  function initPanel() {
    // Close button
    document.getElementById('btn-close-panel').addEventListener('click', function () {
      panelManualClose = true;
      hidePanel();
    });

    // Prev / Next in panel
    document.getElementById('hero-prev').addEventListener('click', function () {
      if (panelPhotos.length === 0) return;
      panelIndex = (panelIndex - 1 + panelPhotos.length) % panelPhotos.length;
      updatePanelContent();
    });

    document.getElementById('hero-next').addEventListener('click', function () {
      if (panelPhotos.length === 0) return;
      panelIndex = (panelIndex + 1) % panelPhotos.length;
      updatePanelContent();
    });

    // Click hero image → fullscreen
    document.getElementById('hero-img').addEventListener('click', function () {
      if (panelPhotos.length > 0) openLightbox(panelIndex);
    });

    // Fullscreen button
    document.getElementById('hero-fullscreen').addEventListener('click', function () {
      if (panelPhotos.length > 0) openLightbox(panelIndex);
    });
  }

  // ── Map move → auto show/hide panel ────────────
  function onMapMoveEnd() {
    if (panelManualClose) return; // user closed, don't reopen until zoom changes
    if (panelResizing) return;   // ignore events from our own invalidateSize

    var zoom = map.getZoom();
    var visible = getVisiblePhotos();

    if (zoom >= PANEL_ZOOM_THRESHOLD && visible.length > 0) {
      // On mobile, only update content if panel is already open to avoid flashing
      if (panelOpen) {
        panelPhotos = visible;
        panelIndex = Math.min(panelIndex, visible.length - 1);
        updatePanelContent();
        buildThumbnails();
      } else {
        showPanel(visible);
      }
    } else if (panelOpen) {
      hidePanel();
    }
  }

  function onMapZoomEnd() {
    // Reset manual close on zoom change
    panelManualClose = false;
    onMapMoveEnd();
  }

  // ── Fullscreen Lightbox ────────────────────────
  var lightboxIndex = 0;

  function openLightbox(idx) {
    lightboxIndex = idx;
    var lb = document.getElementById('lightbox');
    lb.classList.remove('lightbox-hidden');
    updateLightbox();
    document.addEventListener('keydown', lightboxKeyHandler);
  }

  function closeLightbox() {
    var lb = document.getElementById('lightbox');
    lb.classList.add('lightbox-hidden');
    document.removeEventListener('keydown', lightboxKeyHandler);
  }

  function updateLightbox() {
    if (panelPhotos.length === 0) return;
    var photo = panelPhotos[lightboxIndex];

    document.getElementById('lightbox-img').src = photo.path;
    document.getElementById('lightbox-caption').innerHTML =
      '<strong>' + (photo.filename || 'Photo') + '</strong> · ' + formatDate(photo.timestamp);
    document.getElementById('lightbox-counter').textContent =
      (lightboxIndex + 1) + ' / ' + panelPhotos.length;
  }

  function lightboxKeyHandler(e) {
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft')  { lightboxPrev(); return; }
    if (e.key === 'ArrowRight') { lightboxNext(); return; }
  }

  function lightboxPrev() {
    lightboxIndex = (lightboxIndex - 1 + panelPhotos.length) % panelPhotos.length;
    updateLightbox();
    panelIndex = lightboxIndex;
    updatePanelContent();
  }

  function lightboxNext() {
    lightboxIndex = (lightboxIndex + 1) % panelPhotos.length;
    updateLightbox();
    panelIndex = lightboxIndex;
    updatePanelContent();
  }

  function initLightbox() {
    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-backdrop').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-prev').addEventListener('click', lightboxPrev);
    document.getElementById('lightbox-next').addEventListener('click', lightboxNext);
  }

  // ── Also open lightbox from marker popups ──────
  function initPopupFullscreen() {
    map.on('popupopen', function (e) {
      var popup = e.popup;
      var content = popup.getElement();
      if (!content) return;

      var img = content.querySelector('.photo-popup img');
      if (!img) return;

      img.style.cursor = 'pointer';
      img.addEventListener('click', function () {
        // Find which photo this popup belongs to
        var marker = popup._source;
        if (!marker) return;

        var latlng = marker.getLatLng();
        var ts = marker._photoTimestamp;

        // Build a single-photo array for the lightbox if panel isn't open
        var found = -1;
        if (panelOpen && panelPhotos.length > 0) {
          for (var i = 0; i < panelPhotos.length; i++) {
            if (panelPhotos[i].timestamp === ts && panelPhotos[i].lat === latlng.lat) {
              found = i; break;
            }
          }
        }

        if (found >= 0) {
          openLightbox(found);
        } else {
          // Find in global photos and create a temp panel set
          for (var j = 0; j < photos.length; j++) {
            if (photos[j].timestamp === ts && photos[j].lat === latlng.lat) {
              panelPhotos = [photos[j]];
              panelIndex = 0;
              openLightbox(0);
              break;
            }
          }
        }
      });
    });
  }

  // ── Boot ───────────────────────────────────────
  initMap();

  fetch(DATA_URL)
    .then(function (res) {
      if (!res.ok) throw new Error('Could not load ' + DATA_URL);
      return res.json();
    })
    .then(function (data) {
      // Sort by date
      photos = data
        .filter(function (p) { return p.lat && p.lng && p.timestamp; })
        .sort(function (a, b) { return a.timestamp - b.timestamp; });

      if (photos.length === 0) {
        showNoData();
        return;
      }

      buildMarkers();
      initSlider();
      initPlayButton();
      initShowAllButton();
      initPanel();
      initLightbox();
      initPopupFullscreen();
      fitBounds();

      // Wire up map move/zoom to auto-show panel
      map.on('moveend', onMapMoveEnd);
      map.on('zoomend', onMapZoomEnd);
    })
    .catch(function (err) {
      console.warn('photos.json not found or invalid:', err);
      showNoData();
    });

})();
