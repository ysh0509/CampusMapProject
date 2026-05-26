export function initMap(containerId) {
  const map = L.map(containerId).setView([37.5585, 126.9980], 18);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'OSM'
  }).addTo(map);

  return map;
}

