# Vendored A-Frame components

These are single-file A-Frame components vendored from npm. They were previously
installed as runtime `dependencies`, but several of them mis-declare their dev
toolchain (webpack 3/4, karma, sinon, browserify, an old `aframe@0.8.2`, etc.) as
production `dependencies`. That dragged hundreds of `npm audit` advisories into
`node_modules` even though none of it is ever bundled — each component only
registers itself against the global `AFRAME` from `vendor/aframe-master.js`.

Vendoring the actual source files removes that entire transitive mess while
keeping behavior identical. The packages are unmaintained, so there is no update
path being lost. All are MIT licensed.

These files are bundled as-is (excluded from `babel-loader` in `webpack.config.js`)
because they are already published as browser-ready builds.

| File                  | Source package (version)                | Original main                         |
| --------------------- | --------------------------------------- | ------------------------------------- |
| `aabb-collider.js`    | aframe-aabb-collider-component@3.2.2    | index.js                              |
| `atlas-uvs.js`        | aframe-atlas-uvs-component@2.1.0        | index.js                              |
| `event-set.js`        | aframe-event-set-component@4.2.1        | index.js                              |
| `geometry-merger.js`  | aframe-geometry-merger-component@2.0.1  | index.js (+ `lib/BufferGeometryUtils.js`) |
| `layout.js`           | aframe-layout-component@5.3.0           | index.js                              |
| `orbit-controls.js`   | aframe-orbit-controls@1.3.0             | index.js (+ `lib/OrbitControls.js`)   |
| `proxy-event.js`      | aframe-proxy-event-component@2.1.0      | index.js                              |
| `render-order.js`     | aframe-render-order-component@1.1.0     | index.js                              |
| `ring-shader.js`      | aframe-ring-shader@1.2.0                | dist/aframe-ring-shader.js            |
| `slice9.js`           | aframe-slice9-component@1.0.0           | index.js                              |
| `state-component.js`  | aframe-state-component@6.8.0            | dist/aframe-state-component.js        |

To update one, reinstall the package temporarily, copy its main file here, then
remove the package again.

**Do not bump `orbit-controls` past 1.3.0.** This project bundles a custom THREE
**r95** (A-Frame 0.8.2), which exposes `THREE.Math` — not `THREE.MathUtils`.
aframe-orbit-controls 1.3.1+ switched its bundled OrbitControls to r113+ APIs
(`THREE.MathUtils.DEG2RAD`), which throws at load against this THREE. 1.3.0 is the
newest version that targets `THREE.Math`. The old `^1.2.0` range silently resolved
to 1.3.2 on reinstall, which is what caused the `DEG2RAD` crash.
