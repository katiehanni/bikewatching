import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoieWVyYmFtYXRlcXVlZW4iLCJhIjoiY21od2NuNHV5MDV5bTJrb2NueDlpYjI5NiJ9.Zw3_kRHuvzuP3lNKqNBp_A';
const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRIPS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

if (!MAPBOX_ACCESS_TOKEN || MAPBOX_ACCESS_TOKEN.includes('YOUR_MAPBOX_ACCESS_TOKEN_HERE')) {
  console.warn(
    '⚠️ Please replace MAPBOX_ACCESS_TOKEN with your actual Mapbox public token from https://account.mapbox.com/.',
  );
}

mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select('#map').select('svg');
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
const radiusScale = d3.scaleSqrt().range([0, 25]);

const departuresByMinute = Array.from({ length: 1440 }, () => []);
const arrivalsByMinute = Array.from({ length: 1440 }, () => []);

const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

let baseStations = [];
let circles;

function normalizeStation(station) {
  const lat = Number(
    station.lat ?? station.Lat ?? station.latitude ?? station.y ?? station.latitud,
  );
  const lon = Number(
    station.lon ?? station.Long ?? station.longitude ?? station.x ?? station.longitud,
  );
  const shortName =
    station.short_name ??
    station.Number ??
    station.station_short_name ??
    station.station_id ??
    station.id ??
    station.name;

  return {
    ...station,
    lat,
    lon,
    short_name: shortName,
    name: station.name ?? station.NAME ?? station.title ?? station.label ?? shortName,
  };
}

function formatTime(minutes) {
  const reference = new Date(0);
  reference.setHours(0, minutes, 0, 0);
  return reference.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  }

  return tripsByMinute.slice(minMinute, maxMinute).flat();
}

function computeStationTraffic(stations, timeFilter = -1) {
  const filteredDepartures = filterByMinute(departuresByMinute, timeFilter);
  const filteredArrivals = filterByMinute(arrivalsByMinute, timeFilter);

  const departuresRollup = d3.rollup(
    filteredDepartures,
    (group) => group.length,
    (trip) => trip.start_station_id ?? trip.start_station_code ?? trip.start_station,
  );

  const arrivalsRollup = d3.rollup(
    filteredArrivals,
    (group) => group.length,
    (trip) => trip.end_station_id ?? trip.end_station_code ?? trip.end_station,
  );

  return stations.map((station) => {
    const id = station.short_name;
    const departures = departuresRollup.get(id) ?? 0;
    const arrivals = arrivalsRollup.get(id) ?? 0;
    const totalTraffic = departures + arrivals;

    return {
      ...station,
      departures,
      arrivals,
      totalTraffic,
    };
  });
}

function getCoords(mapInstance, station) {
  const point = new mapboxgl.LngLat(Number(station.lon), Number(station.lat));
  const { x, y } = mapInstance.project(point);
  return { cx: x, cy: y };
}

function updatePositions(mapInstance) {
  if (!circles) return;

  circles
    .attr('cx', (d) => getCoords(mapInstance, d).cx)
    .attr('cy', (d) => getCoords(mapInstance, d).cy);
}

function updateTooltip(selection) {
  selection.selectAll('title').remove();
  selection.append('title').text((d) => {
    const departures = d.departures ?? 0;
    const arrivals = d.arrivals ?? 0;
    const total = d.totalTraffic ?? 0;
    return `${d.name ?? d.short_name}\n${total} trips (${departures} departures, ${arrivals} arrivals)`;
  });
}

function updateLegendVisibility(timeFilter) {
  if (!selectedTime || !anyTimeLabel) return;

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }
}

function updateScatterPlot(mapInstance, enhancedStations, timeFilter) {
  const filteredStations = computeStationTraffic(enhancedStations, timeFilter);
  const maxTraffic = d3.max(filteredStations, (station) => station.totalTraffic) ?? 0;
  radiusScale.domain([0, maxTraffic]);

  if (timeFilter === -1) {
    radiusScale.range([0, 25]);
  } else {
    radiusScale.range([3, 50]);
  }

  circles = svg
    .selectAll('circle')
    .data(filteredStations, (station) => station.short_name)
    .join(
      (enter) =>
        enter
          .append('circle')
          .attr('r', 0)
          .call(updateTooltip)
          .attr('cx', (d) => getCoords(mapInstance, d).cx)
          .attr('cy', (d) => getCoords(mapInstance, d).cy),
      (update) => update,
      (exit) => exit.transition().duration(150).attr('r', 0).remove(),
    )
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
      isFinite(d.totalTraffic) && d.totalTraffic > 0
        ? stationFlow(d.departures / d.totalTraffic)
        : stationFlow(0.5),
    );

  circles.call(updateTooltip);
  updatePositions(mapInstance);
}

function initialiseSlider(mapInstance, stationsWithTraffic) {
  if (!timeSlider) return;

  const handleInput = (event) => {
    const timeFilter = Number(event.target.value);
    updateLegendVisibility(timeFilter);
    requestAnimationFrame(() => updateScatterPlot(mapInstance, stationsWithTraffic, timeFilter));
  };

  timeSlider.addEventListener('input', handleInput);
  handleInput({ target: timeSlider });
}

map.on('load', async () => {
  try {
    svg.attr('aria-hidden', false);

    const [stationJSON] = await Promise.all([d3.json(STATIONS_URL)]);
    const stations = stationJSON?.data?.stations ?? [];
    baseStations = stations.map(normalizeStation);

    const trips = await d3.csv(TRIPS_URL, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      const departureMinute = minutesSinceMidnight(trip.started_at);
      const arrivalMinute = minutesSinceMidnight(trip.ended_at);

      if (!Number.isNaN(departureMinute)) {
        departuresByMinute[departureMinute].push(trip);
      }

      if (!Number.isNaN(arrivalMinute)) {
        arrivalsByMinute[arrivalMinute].push(trip);
      }

      return trip;
    });

    if (!stations.length || !trips.length) {
      console.error('Unable to load station or trip data. Check network access and URLs.');
      return;
    }

    const stationsWithTraffic = computeStationTraffic(baseStations);
    const maxTraffic = d3.max(stationsWithTraffic, (station) => station.totalTraffic) ?? 0;
    radiusScale.domain([0, maxTraffic]);

    circles = svg
      .selectAll('circle')
      .data(stationsWithTraffic, (station) => station.short_name)
      .enter()
      .append('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .attr('cx', (d) => getCoords(map, d).cx)
      .attr('cy', (d) => getCoords(map, d).cy)
      .style('--departure-ratio', (d) =>
        isFinite(d.totalTraffic) && d.totalTraffic > 0
          ? stationFlow(d.departures / d.totalTraffic)
          : stationFlow(0.5),
      );

    circles.call(updateTooltip);

    map.addSource('boston-bike-lanes', {
      type: 'geojson',
      data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });

    map.addLayer({
      id: 'boston-bike-lanes',
      type: 'line',
      source: 'boston-bike-lanes',
      paint: {
        'line-color': '#3EC70B',
        'line-width': 2.5,
        'line-opacity': 0.55,
      },
    });

    map.addSource('cambridge-bike-lanes', {
      type: 'geojson',
      data: 'https://dsc106.com/labs/lab07/data/cambridge-bike-network.geojson',
    });

    map.addLayer({
      id: 'cambridge-bike-lanes',
      type: 'line',
      source: 'cambridge-bike-lanes',
      paint: {
        'line-color': '#22A699',
        'line-width': 2.5,
        'line-opacity': 0.55,
      },
    });

    const updatePositionsBound = () => updatePositions(map);
    map.on('move', updatePositionsBound);
    map.on('zoom', updatePositionsBound);
    map.on('resize', updatePositionsBound);
    map.on('moveend', updatePositionsBound);

    initialiseSlider(map, baseStations);
  } catch (error) {
    console.error('Error initialising map:', error);
  }
});

map.on('error', (event) => {
  if (event && event.error) {
    console.error('Map error:', event.error);
  }
});

