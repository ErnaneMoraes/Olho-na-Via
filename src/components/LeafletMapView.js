import * as FileSystem from 'expo-file-system/legacy';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useAppSettings } from '../context/AppSettingsContext';

const NativeWebView =
  Platform.OS === 'web' ? null : require('react-native-webview').WebView;

function buildLeafletHtml(initialLat, initialLng, palette) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link id="leaflet-css" rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body, #map {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #E8EAED;
      background-image:
        linear-gradient(to right, rgba(218, 220, 224, 0.45) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(218, 220, 224, 0.45) 1px, transparent 1px);
      background-size: 32px 32px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .olho-user-dot-wrap {
      position: relative;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .olho-user-pulse {
      position: absolute;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(26, 115, 232, 0.28);
      animation: olhoPulse 2s ease-out infinite;
    }
    .olho-user-dot {
      position: relative;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: ${palette.primary};
      border: 2.5px solid #FFFFFF;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    }
    @keyframes olhoPulse {
      0% { transform: scale(0.8); opacity: 0.9; }
      75% { transform: scale(2.1); opacity: 0; }
      100% { transform: scale(2.1); opacity: 0; }
    }
    .olho-pin-far {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2.5px solid #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      font-size: 14px;
      font-weight: 800;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
      cursor: pointer;
    }
    .olho-thumb-card {
      position: relative;
      width: 48px;
      height: 48px;
      border-radius: 12px;
      overflow: hidden;
      background: #FFFFFF;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .olho-thumb-card img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .olho-thumb-badge {
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 1.5px solid #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      font-size: 9px;
      font-weight: 800;
    }
    .olho-seed-pill {
      padding: 1px 4px;
      border-radius: 4px;
      color: #FFFFFF;
      font-size: 7.5px;
      font-weight: 800;
      letter-spacing: 0.2px;
      margin-top: 2px;
    }
    .olho-attribution {
      position: fixed;
      left: 12px;
      bottom: 12px;
      z-index: 900;
      background: rgba(255, 255, 255, 0.92);
      color: #5F6368;
      border: 1px solid #DADCE0;
      border-radius: 8px;
      padding: 3px 7px;
      font-size: 10px;
      font-weight: 600;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="olho-attribution">© OpenStreetMap</div>

  <script>
    (function () {
      var INITIAL_LAT = ${Number(initialLat).toFixed(6)};
      var INITIAL_LNG = ${Number(initialLng).toFixed(6)};
      var COLOR_OPEN = '${palette.danger}';
      var COLOR_FIXED = '${palette.success}';

      var map = null;
      var markerLayer = null;
      var userMarker = null;
      var currentMarkers = [];
      var moveTimer = null;

      function postToNative(payload) {
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          } else if (window.parent && window.parent !== window) {
            var out = Object.assign({ __olhoMap: true }, payload);
            window.parent.postMessage(JSON.stringify(out), '*');
          }
        } catch (e) {}
      }

      function createPinHtml(m, zoom) {
        var isFixed = m.status === 'fixed';
        var color = isFixed ? COLOR_FIXED : COLOR_OPEN;
        var symbol = isFixed ? '&#10003;' : '!';
        var borderWidth = m.isSelected ? 3.5 : 3;

        if (zoom < 15) {
          var scale = m.isSelected ? 'transform: scale(1.15);' : '';
          return '<div class="olho-pin-far" style="background:' + color + ';' + scale + '">' + symbol + '</div>';
        }

        if (m.thumbSrc) {
          return (
            '<div class="olho-thumb-card" style="border:' + borderWidth + 'px solid ' + color + ';">' +
              '<img src="' + m.thumbSrc + '" alt="" />' +
              '<div class="olho-thumb-badge" style="background:' + color + ';">' + symbol + '</div>' +
            '</div>'
          );
        }

        var label = isFixed ? 'TAMPADO' : 'ABERTO';
        return (
          '<div class="olho-thumb-card" style="border:' + borderWidth + 'px solid ' + color + ';">' +
            '<div style="color:' + color + ';font-size:15px;font-weight:800;line-height:1;">' + symbol + '</div>' +
            '<div class="olho-seed-pill" style="background:' + color + ';">' + label + '</div>' +
          '</div>'
        );
      }

      function renderMarkers() {
        if (!map || !markerLayer || !window.L) return;
        markerLayer.clearLayers();
        var zoom = map.getZoom();
        var isClose = zoom >= 15;
        var size = isClose ? [48, 48] : [32, 32];
        var anchor = isClose ? [24, 24] : [16, 16];

        for (var i = 0; i < currentMarkers.length; i++) {
          (function (m) {
            var icon = window.L.divIcon({
              className: '',
              html: createPinHtml(m, zoom),
              iconSize: size,
              iconAnchor: anchor,
            });
            var marker = window.L.marker([m.latitude, m.longitude], { icon: icon });
            marker.on('click', function () {
              postToNative({ type: 'MARKER_PRESS', id: m.id });
            });
            markerLayer.addLayer(marker);
          })(currentMarkers[i]);
        }
      }

      function updateUserLocation(lat, lng, shouldCenter, zoomTarget) {
        if (!map || !window.L) return;
        if (!userMarker) {
          var userIcon = window.L.divIcon({
            className: '',
            html: '<div class="olho-user-dot-wrap"><div class="olho-user-pulse"></div><div class="olho-user-dot"></div></div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });
          userMarker = window.L.marker([lat, lng], {
            icon: userIcon,
            interactive: false,
            zIndexOffset: 1000,
          }).addTo(map);
        } else {
          userMarker.setLatLng([lat, lng]);
        }

        if (shouldCenter) {
          var targetZoom = Math.max(map.getZoom(), zoomTarget || 16);
          map.setView([lat, lng], targetZoom, { animate: true });
        }
      }

      function emitRegionChange() {
        if (!map) return;
        var b = map.getBounds();
        var c = map.getCenter();
        postToNative({
          type: 'REGION_CHANGE',
          bounds: {
            minLat: b.getSouth(),
            maxLat: b.getNorth(),
            minLng: b.getWest(),
            maxLng: b.getEast(),
          },
          center: { lat: c.lat, lng: c.lng },
          zoom: map.getZoom(),
        });
      }

      function initLeafletMap() {
        if (!window.L || map) return;
        map = window.L.map('map', {
          zoomControl: false,
          attributionControl: false,
        }).setView([INITIAL_LAT, INITIAL_LNG], 16);

        var tileErrorCount = 0;
        var switchedToFallback = false;
        var primaryTiles = window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap',
          crossOrigin: true,
        });

        primaryTiles.on('tileerror', function () {
          tileErrorCount += 1;
          if (!switchedToFallback && tileErrorCount >= 3) {
            switchedToFallback = true;
            try {
              map.removeLayer(primaryTiles);
            } catch (e) {}
            window.L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
              subdomains: 'abc',
              maxZoom: 19,
              attribution: '© OpenStreetMap',
            }).addTo(map);
          }
        });

        primaryTiles.addTo(map);

        markerLayer = window.L.layerGroup().addTo(map);

        map.on('zoomend', function () {
          renderMarkers();
        });

        map.on('moveend', function () {
          if (moveTimer) clearTimeout(moveTimer);
          moveTimer = setTimeout(emitRegionChange, 500);
        });

        updateUserLocation(INITIAL_LAT, INITIAL_LNG, false);
        postToNative({ type: 'MAP_READY' });
      }

      window.__olhoReceive = function (msg) {
        if (!msg || !msg.type) return;
        if (msg.type === 'SET_USER') {
          updateUserLocation(msg.latitude, msg.longitude, Boolean(msg.center), msg.zoom);
        } else if (msg.type === 'CENTER_MAP') {
          if (map) {
            var nextZoom = Math.max(map.getZoom(), msg.zoom || 16);
            map.setView([msg.latitude, msg.longitude], nextZoom, { animate: true });
          }
        } else if (msg.type === 'SET_MARKERS') {
          currentMarkers = Array.isArray(msg.markers) ? msg.markers : [];
          renderMarkers();
        }
      };

      window.addEventListener('message', function (event) {
        try {
          var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data && data.__olhoCmd) {
            window.__olhoReceive(data);
          }
        } catch (e) {}
      });

      function loadScript(src, onOk, onErr) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = onOk;
        s.onerror = onErr;
        document.body.appendChild(s);
      }

      loadScript(
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
        initLeafletMap,
        function () {
          var cssEl = document.getElementById('leaflet-css');
          if (cssEl) cssEl.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
          loadScript(
            'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
            initLeafletMap,
            function () {
              postToNative({ type: 'MAP_LOAD_ERROR' });
            }
          );
        }
      );
    })();
  </script>
</body>
</html>`;
}

export const LeafletMapView = forwardRef(function LeafletMapView(
  {
    initialCenter,
    userLocation,
    markers = [],
    selectedId = null,
    onMarkerPress,
    onRegionChange,
  },
  ref
) {
  const { colors } = useAppSettings();
  const webViewRef = useRef(null);
  const iframeRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const initialCenterRef = useRef(initialCenter);
  const base64CacheRef = useRef(new Map());

  const htmlSource = useMemo(
    () =>
      buildLeafletHtml(
        initialCenterRef.current.latitude,
        initialCenterRef.current.longitude,
        colors
      ),
    [colors]
  );

  const sendCommand = useCallback((payload) => {
    if (Platform.OS === 'web') {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        win.postMessage(JSON.stringify({ __olhoCmd: true, ...payload }), '*');
      }
      return;
    }

    if (!webViewRef.current) return;
    const js = `window.__olhoReceive && window.__olhoReceive(${JSON.stringify(payload)}); true;`;
    webViewRef.current.injectJavaScript(js);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      centerOn(latitude, longitude, zoom = 16) {
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        sendCommand({ type: 'CENTER_MAP', latitude, longitude, zoom });
      },
    }),
    [sendCommand]
  );

  const pushMarkersToWebView = useCallback(async () => {
    if (!mapReady) return;
    const serialized = await Promise.all(
      markers.map(async (item) => {
        let thumbSrc = null;
        const remote = item.remoteThumbUrl;
        const localOrRemote = item.thumbUri;

        if (remote && typeof remote === 'string' && remote.startsWith('http')) {
          thumbSrc = remote;
        } else if (
          localOrRemote &&
          typeof localOrRemote === 'string' &&
          (localOrRemote.startsWith('http') ||
            localOrRemote.startsWith('data:') ||
            localOrRemote.startsWith('blob:'))
        ) {
          thumbSrc = localOrRemote;
        } else if (
          Platform.OS !== 'web' &&
          localOrRemote &&
          typeof localOrRemote === 'string' &&
          localOrRemote.startsWith('file://')
        ) {
          if (base64CacheRef.current.has(localOrRemote)) {
            thumbSrc = base64CacheRef.current.get(localOrRemote);
          } else {
            try {
              const b64 = await FileSystem.readAsStringAsync(localOrRemote, {
                encoding: 'base64',
              });
              const dataUri = `data:image/jpeg;base64,${b64}`;
              base64CacheRef.current.set(localOrRemote, dataUri);
              thumbSrc = dataUri;
            } catch {
              thumbSrc = null;
            }
          }
        }

        return {
          id: item.id,
          latitude: item.latitude,
          longitude: item.longitude,
          status: item.status === 'fixed' ? 'fixed' : 'open',
          isSelected: selectedId === item.id,
          thumbSrc,
        };
      })
    );

    sendCommand({ type: 'SET_MARKERS', markers: serialized });
  }, [mapReady, markers, selectedId, sendCommand]);

  useEffect(() => {
    if (!mapReady || !userLocation) return;
    sendCommand({
      type: 'SET_USER',
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
      center: false,
    });
  }, [mapReady, userLocation, sendCommand]);

  useEffect(() => {
    pushMarkersToWebView();
  }, [pushMarkersToWebView]);

  const dispatchBridgePayload = useCallback(
    (msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'MAP_READY') {
        setMapReady(true);
      } else if (msg.type === 'MARKER_PRESS' && msg.id) {
        onMarkerPress?.(msg.id);
      } else if (msg.type === 'REGION_CHANGE') {
        onRegionChange?.(msg);
      }
    },
    [onMarkerPress, onRegionChange]
  );

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    const onWindowMessage = (event) => {
      try {
        const parsed =
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (parsed && parsed.__olhoMap) {
          dispatchBridgePayload(parsed);
        }
      } catch {
        // Ignora mensagens externas da página
      }
    };

    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, [dispatchBridgePayload]);

  const handleNativeMessage = useCallback(
    (event) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        dispatchBridgePayload(msg);
      } catch {
        // Ignora mensagens malformadas
      }
    },
    [dispatchBridgePayload]
  );

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {React.createElement('iframe', {
          ref: iframeRef,
          srcDoc: htmlSource,
          title: 'Mapa Olho na Via',
          onLoad: () => {
            setMapReady(true);
          },
          style: {
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
          },
        })}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <NativeWebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlSource, baseUrl: 'https://olhonavia.app/' }}
        applicationNameForUserAgent="OlhoNaVia/1.5.0"
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="compatibility"
        onMessage={handleNativeMessage}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

export default LeafletMapView;
