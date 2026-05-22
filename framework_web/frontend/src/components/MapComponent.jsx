import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';

const RISK_PALETTE = [
  '#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24',
  '#F87171', '#EF4444', '#DC2626', '#991B1B',
];

export function useMap(containerId, options = {}) {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);

  useEffect(() => {
    if (mapRef.current || !containerId) return;

    const mapInstance = new maplibregl.Map({
      container: containerId,
      style: {
        version: 8,
        sources: {
          'carto-light': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
              'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
              'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
              'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            ],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap &copy; CARTO',
          },
          'carto-dark': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
              'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
              'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
              'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            ],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap &copy; CARTO',
          },
          'satellite': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            attribution: '&copy; Esri',
          },
        },
        layers: [
          {
            id: 'carto-light-layer',
            type: 'raster',
            source: 'carto-light',
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      },
      center: options.center || [-0.4, 39.43],
      zoom: options.zoom || 11,
      minZoom: options.minZoom || 9,
      maxZoom: options.maxZoom || 18,
      maxBounds: options.maxBounds || null,
    });

    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');

    mapInstance.on('load', () => {
      setMap(mapInstance);
    });

    mapRef.current = mapInstance;

    return () => {
      mapInstance.remove();
      mapRef.current = null;
    };
  }, [containerId]);

  const setBasemap = (name) => {
    if (!map) return;
    const layers = map.getStyle().layers;
    layers.forEach((layer) => {
      if (layer.id.endsWith('-layer')) {
        map.removeLayer(layer.id);
      }
    });
    map.addLayer({
      id: 'carto-light-layer',
      type: 'raster',
      source: name === 'dark' ? 'carto-dark' : name === 'satellite' ? 'satellite' : 'carto-light',
      minzoom: 0,
      maxzoom: 22,
    });
  };

  return { map, mapRef, setBasemap };
}

export function getRiskStyle(feature) {
  const props = feature.properties || {};
  const color = props.color || '#FCD34D';
  return {
    fillColor: color,
    fillOpacity: 0.6,
    color,
    weight: 0,
    opacity: 0,
  };
}

export function addGeoJSONLayer(map, id, geojson, styleFn) {
  if (!map || !map.getSource(id)) {
    map.addSource(id, {
      type: 'geojson',
      data: geojson,
    });
  }

  if (map.getLayer(id)) {
    map.removeLayer(id);
  }

  const defaultStyle = {
    id: id,
    type: 'fill',
    source: id,
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': 0.6,
    },
  };

  map.addLayer(styleFn ? { ...defaultStyle, paint: styleFn(geojson) } : defaultStyle);
}

export function fitToBbox(map, bbox, padding = 16) {
  if (!map || !bbox) return;
  const [w, s, e, n] = bbox;
  map.fitBounds([[s, w], [n, e]], { padding, maxZoom: 14 });
}

export function MapComponent({ id, className = '', style = {}, center = [39.43, -0.4], zoom = 11, children }) {
  const { map, setBasemap } = useMap(id, { center, zoom });
  const [basemap, setBasemapState] = useState('light');

  useEffect(() => {
    if (!map) return;
    map.setBasemap = setBasemap;
    map.getBasemap = () => basemap;
    map.setBasemapState = setBasemapState;
  }, [map, basemap]);

  return (
    <div id={id} className={className} style={{ height: '100%', width: '100%', ...style }}>
      {children}
    </div>
  );
}