/* global AFRAME */

if (typeof AFRAME === 'undefined') {
  throw new Error('Component attempted to register before AFRAME was available.');
}

/**
 * Slice9 component for A-Frame.
 */
AFRAME.registerComponent('slice9', {
  schema: {
    width: {default: 1, min: 0},
    height: {default: 1, min: 0},
    left: {default: 0, min: 0},
    right: {default: 0, min: 0},
    bottom: {default: 0, min: 0},
    top: {default: 0, min: 0},
    side: {default: 'front', oneOf: ['front', 'back', 'double']},
    padding: {default: 0.1, min: 0.01},
    color: {type: 'color', default: '#fff'},
    opacity: {default: 1.0, min: 0, max: 1},
    transparent: {default: true},
    debug: {default: false},
    src: {type: 'map'}
  },

  /**
   * Set if component needs multiple instancing.
   */
  multiple: false,

  /**
   * Called once when component is attached. Generally for initial setup.
   */
  init: function () {
    var data = this.data;
    var material = this.material = new THREE.MeshBasicMaterial({color: data.color, opacity: data.opacity, transparent: data.transparent, wireframe: data.debug});
    var geometry = this.geometry = new THREE.PlaneBufferGeometry(data.width, data.height, 3, 3);

    var textureLoader = new THREE.TextureLoader();
    this.plane = new THREE.Mesh(geometry, material);
    this.el.setObject3D('mesh', this.plane);
    this.textureSrc = null;
  },

  updateMap: function () {
    var src = this.data.src;

    if (src) {
      if (src === this.textureSrc) { return; }
      // Texture added or changed.
      this.textureSrc = src;
      this.el.sceneEl.systems.material.loadTexture(src, {src: src}, setMap.bind(this));
      return;
    }

    // Texture removed.
    if (!this.material.map) { return; }
    setMap(null);


    function setMap (texture) {
      this.material.map = texture;
      this.material.needsUpdate = true;
      this.regenerateMesh();
    }
  },

  regenerateMesh: function () {
    var data = this.data;
    var pos = this.geometry.attributes.position.array;
    var uvs = this.geometry.attributes.uv.array;
    var image = this.material.map.image;

    if (!image) {return;}

    /*
      0--1------------------------------2--3
      |  |                              |  |
      4--5------------------------------6--7
      |  |                              |  |
      |  |                              |  |
      |  |                              |  |
      8--9-----------------------------10--11
      |  |                              |  |
      12-13----------------------------14--15
    */
    function setPos(id, x, y) {
      pos[3 * id] = x;
      pos[3 * id + 1] = y;
    }

    function setUV(id, u, v) {
      uvs[2 * id] = u;
      uvs[2 * id + 1] = v;
    }

    // Update UVS
    var uv = {
      left: data.left / image.width,
      right: data.right / image.width,
      top: data.top / image.height,
      bottom: data.bottom / image.height
    };

    setUV(1,  uv.left,  1);
    setUV(2,  uv.right, 1);

    setUV(4,  0,        uv.bottom);
    setUV(5,  uv.left,  uv.bottom);
    setUV(6,  uv.right, uv.bottom);
    setUV(7,  1,        uv.bottom);

    setUV(8,  0,        uv.top);
    setUV(9,  uv.left,  uv.top);
    setUV(10, uv.right, uv.top);
    setUV(11, 1,        uv.top);

    setUV(13, uv.left,  0);
    setUV(14, uv.right, 0);

    // Update vertex positions
    var w2 = data.width / 2;
    var h2 = data.height / 2;
    var left = -w2 + data.padding;
    var right = w2 - data.padding;
    var top = h2 - data.padding;
    var bottom = -h2 + data.padding;

    setPos(0, -w2,    h2);
    setPos(1, left,   h2);
    setPos(2, right,  h2);
    setPos(3, w2,     h2);

    setPos(4, -w2,    top);
    setPos(5, left,   top);
    setPos(6, right,  top);
    setPos(7, w2,     top);

    setPos(8, -w2,    bottom);
    setPos(9, left,   bottom);
    setPos(10, right, bottom);
    setPos(11, w2,    bottom);

    setPos(13, left,  -h2);
    setPos(14, right, -h2);
    setPos(12, -w2,   -h2);
    setPos(15, w2,    -h2);

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.uv.needsUpdate = true;
  },

  /**
   * Called when component is attached and when component data changes.
   * Generally modifies the entity based on the data.
   */
   update: function (oldData) {
     var data = this.data;

     this.material.color.setStyle(data.color);
     this.material.opacity = data.opacity;
     this.material.transparent = data.transparent;
     this.material.wireframe = data.debug;
     this.material.side = parseSide(data.side);

     var diff = AFRAME.utils.diff(data, oldData);
     if ('src' in diff) {
       this.updateMap();
     }
     else if ('width' in diff || 'height' in diff || 'padding' in diff || 'left' in diff || 'top' in diff || 'bottom' in diff || 'right' in diff) {
       this.regenerateMesh();
     }
   },

  /**
   * Called when a component is removed (e.g., via removeAttribute).
   * Generally undoes all modifications to the entity.
   */
  remove: function () { },

  /**
   * Called on each scene tick.
   */
  // tick: function (t) { },

  /**
   * Called when entity pauses.
   * Use to stop or remove any dynamic or background behavior such as events.
   */
  pause: function () { },

  /**
   * Called when entity resumes.
   * Use to continue or add any dynamic or background behavior such as events.
   */
  play: function () { }
});

function parseSide (side) {
  switch (side) {
    case 'back': {
      return THREE.BackSide;
    }
    case 'double': {
      return THREE.DoubleSide;
    }
    default: {
      // Including case `front`.
      return THREE.FrontSide;
    }
  }
}
