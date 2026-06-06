function requireAll(req) {
	req.keys().forEach(req);
}

console.time = () => {};
console.timeEnd = () => {};

require('../vendor/BufferGeometryUtils');

require('./vendor/aframe-components/aabb-collider');
require('./vendor/aframe-components/atlas-uvs');
require('./vendor/aframe-components/event-set');
require('./vendor/aframe-components/geometry-merger');
require('./vendor/aframe-components/layout');
require('./vendor/aframe-components/orbit-controls');
require('./vendor/aframe-components/proxy-event');
require('./vendor/aframe-components/ring-shader');
require('./vendor/aframe-components/state-component');
require('./vendor/aframe-components/slice9');
require('./vendor/aframe-components/render-order');

requireAll(require.context('./components/', true, /\.js$/));
requireAll(require.context('./state/', true, /\.js$/));

require('./index.styl');
