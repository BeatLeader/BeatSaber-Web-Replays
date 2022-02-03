const TRAILS = {
  bright: {
    width: 0.9,
    fragmentShader: `
      uniform vec4 bladeColor;
      varying vec2 uv0;
      
      #define tipColor vec4(1.0, 1.0, 1.0, 1.0)
      
      vec4 lerpColor(const vec4 a, const vec4 b, const float t) {
        return vec4(
          a.r + (b.r - a.r) * t,
          a.g + (b.g - a.g) * t,
          a.b + (b.b - a.b) * t,
          a.a + (b.a - a.a) * t
        );
      }
      
      void main() {
        float nullFade = pow(uv0.y, 2.0) * pow(uv0.x, 0.5);
        float tipFade = 0.8 * pow(uv0.x, 10.0 + 60.0 * (1.0 - uv0.y)) * pow(uv0.y, 0.4);
        vec4 col = bladeColor * nullFade;
        col = lerpColor(col, tipColor, tipFade);
        gl_FragColor = col;
      }`
  },
  dim: {
    width: 0.3,
    fragmentShader: `
      uniform vec4 bladeColor;
      varying vec2 uv0;
      
      #define tipColor vec4(1.0, 1.0, 1.0, 1.0)
      
      vec4 lerpColor(const vec4 a, const vec4 b, const float t) {
        return vec4(
          a.r + (b.r - a.r) * t,
          a.g + (b.g - a.g) * t,
          a.b + (b.b - a.b) * t,
          a.a + (b.a - a.a) * t
        );
      }
      
      void main() {
        float nullFade = pow(uv0.y, 2.0) * pow(uv0.x, 0.8);
        float tipFade = 0.2 * pow(uv0.x, 10.0 + 60.0 * (1.0 - uv0.y)) * pow(uv0.y, 0.4);
        vec4 col = bladeColor * nullFade;
        col = lerpColor(col, tipColor, tipFade);
        gl_FragColor = col;
      }`
  },
  slim: {
    width: 0.05,
    fragmentShader: `
      uniform vec4 bladeColor;
      varying vec2 uv0;
      
      #define pi 3.1415926
      #define tip_color vec4(1.0, 1.0, 1.0, 1.0)
      #define start_curve_to 0.1
      #define start_curve_maximum 1.0
      #define middle_curve_to 0.5
      #define middle_curve_minimum 0.4
      #define end_curve_to 1.0
      #define end_curve_maximum 0.0
      
      float lerp(const float a, const float b, const float t) {
        return a + (b - a) * t;
      }
      
      vec4 lerpColor(const vec4 a, const vec4 b, const float t) {
        return vec4(
          a.r + (b.r - a.r) * t,
          a.g + (b.g - a.g) * t,
          a.b + (b.b - a.b) * t,
          a.a + (b.a - a.a) * t
        );
      }
      
      float start_curve(const float t)
      {
          return pow(t, 0.6) * start_curve_maximum;
      }
      
      float middle_curve(const float t)
      {
          float lerp_t = (cos(pi * (1.0 - t)) + 1.0) / 2.0;
          return lerp(start_curve_maximum, middle_curve_minimum, lerp_t);
      }
      
      float end_curve(const float t)
      {
          float lerp_t = (cos(pi * (1.0 - t)) + 1.0) / 2.0;
          return lerp(middle_curve_minimum, end_curve_maximum, lerp_t);
      }
      
      float get_range_ratio(const float range_start, const float range_end, const float value)
      {
          float range_amplitude = range_end - range_start;
          return (value - range_start) / range_amplitude;
      }
      
      float get_fade_value(const float x, const float y)
      {
          float start_curve_ratio = get_range_ratio(0.0, start_curve_to, y);
          float middle_curve_ratio = get_range_ratio(start_curve_to, middle_curve_to, y);
          float end_curve_ratio = get_range_ratio(middle_curve_to, end_curve_to, y);
          
          float start_curve_value = ((start_curve_ratio >= 0.0 && start_curve_ratio <= 1.0) ? 1.0 : 0.0) * start_curve(start_curve_ratio);
          float middle_curve_value = ((middle_curve_ratio > 0.0 && middle_curve_ratio <= 1.0) ? 1.0 : 0.0) * middle_curve(middle_curve_ratio);
          float end_curve_value = ((end_curve_ratio > 0.0 && end_curve_ratio <= 1.0) ? 1.0 : 0.0) * end_curve(end_curve_ratio);
          
          return (x < start_curve_value + middle_curve_value + end_curve_value) ? 1.0 : 0.0;
      }
      
      void main() {
        float x = abs(uv0.x - 0.5) * 2.0;
        float y = 1.0 - uv0.y;
        float fade_value = get_fade_value(x, y);
        vec4 col = lerpColor(bladeColor, tip_color, 0.4);
        gl_FragColor = col * fade_value;
      }`
  }
}

AFRAME.registerComponent('trail', {
  schema: {
    color: {type: 'color'},
    enabled: {default: false},
    hand: {type: 'string'},
    trailType: {default: 'bright'}
  },

  init: function () {
    //TRAIL CONFIG ---------------------------------------------------------------------
    //You must call init (and potentially dispose already existing mesh) after any config change
    this.lifetime = 20; //frames
    this.verticalResolution = 120; //quads
    this.horizontalResolution = 2; //quads
    //TRAIL CONFIG ---------------------------------------------------------------------

    this.saberEl = this.el.querySelector('.blade');

    this.verticalRatioPerStep = 1 / this.verticalResolution;
    this.horizontalRatioPerStep = 1 / this.horizontalResolution;
    this.columnsCount = this.horizontalResolution + 1;
    this.rowsCount = this.verticalResolution + 1;
  },

  createMesh: function () {
    const quadCount = this.verticalResolution * this.horizontalResolution;

    const geometry = this.geometry = new THREE.BufferGeometry();
    const vertices = this.vertices = new Float32Array(quadCount * 6 * 3);
    const uv = this.uv = new Float32Array(quadCount * 6 * 2);

    geometry.addAttribute('position', new THREE.BufferAttribute(vertices, 3).setDynamic(true));
    geometry.addAttribute('uv', new THREE.BufferAttribute(uv, 2).setDynamic(true));

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    mesh.vertices = vertices;
    mesh.uv = uv;
    mesh.renderOrder = 5;
    this.el.sceneEl.setObject3D(`trail__${this.data.hand}`, mesh);

    this.fillUvArray();
    return mesh;
  },

  createMaterial: function () {
    const vertexShader = `
      varying vec2 uv0;
      
      void main() {
        uv0 = uv;
        vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
      }`;

    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: vertexShader,
      fragmentShader: this.trailType.fragmentShader,
      uniforms: {
        bladeColor: {value: {x: 0, y: 0, z: 0, w: 0}}
      }
    });
  },

  fillUvArray: function () {
    const uv = this.geometry.attributes.uv.array;

    let verticalRatio = 1;
    for (let rowIndex = 0; rowIndex < (this.rowsCount - 1); rowIndex++, verticalRatio -= this.verticalRatioPerStep) {
      const nextVerticalRatio = verticalRatio - this.verticalRatioPerStep

      let horizontalRatio = 0;
      for (let columnIndex = 0; columnIndex < (this.columnsCount - 1); columnIndex++, horizontalRatio += this.horizontalRatioPerStep) {
        const nextHorizontalRatio = horizontalRatio + this.horizontalRatioPerStep

        const uvIndexOffset = (rowIndex * this.horizontalResolution + columnIndex) * 6 * 2;

        uv[uvIndexOffset] = nextHorizontalRatio;
        uv[uvIndexOffset + 1] = verticalRatio;

        uv[uvIndexOffset + 2] = horizontalRatio;
        uv[uvIndexOffset + 3] = nextVerticalRatio;

        uv[uvIndexOffset + 4] = horizontalRatio;
        uv[uvIndexOffset + 5] = verticalRatio;

        uv[uvIndexOffset + 6] = nextHorizontalRatio;
        uv[uvIndexOffset + 7] = verticalRatio;

        uv[uvIndexOffset + 8] = nextHorizontalRatio;
        uv[uvIndexOffset + 9] = nextVerticalRatio;

        uv[uvIndexOffset + 10] = horizontalRatio;
        uv[uvIndexOffset + 11] = nextVerticalRatio;
      }
    }

    this.geometry.attributes.uv.needsUpdate = true;
  },

  updateColor: function () {
    const bladeColor = new THREE.Color(this.data.color);
    this.material.uniforms.bladeColor.value = {
      x: bladeColor.r,
      y: bladeColor.g,
      z: bladeColor.b,
      w: 1
    };
    this.material.uniformsNeedUpdate = true;
  },

  update: function (oldData) {
    this.trailType = TRAILS[this.data.trailType];

    this.previousTipPosition = new THREE.Vector3(0, 0, 0);
    this.material = this.createMaterial();
    this.mesh = this.createMesh();
    this.updateColor();

    this.handlesArray = [];
    this.curvedSegmentsArray = [];
    this.linearSegment = null;
    this.lastAddedNode = null;

    if (!oldData.enabled && this.data.enabled) {
      this.enabledTime = this.el.sceneEl.time;
      this.mesh.visible = false;
    }

    if (oldData.enabled && !this.data.enabled) {
      this.mesh.visible = false;
    }
  },

  tick: function (time, delta) {
    if (!this.data.enabled) {
      return;
    }
    // Delay before showing after enabled to prevent flash from old saber position.
    if (!this.mesh.visible && time > this.enabledTime + 250) {
      this.mesh.visible = true;
    }

    if (!this.addNode(this.createNewNode())) return;
    this.updateMesh(this.calculateRowNodes());
  },

  updateMesh: function (rowNodes) {
    const vertices = this.geometry.attributes.position.array;

    const horizontalRatioPerStep = 1 / this.horizontalResolution;

    for (let rowIndex = 0; rowIndex < (this.rowsCount - 1); rowIndex++) {
      const currentNode = rowNodes[rowIndex];
      const nextNode = rowNodes[rowIndex + 1];

      let currentHorizontalRatio = 0;
      for (let columnIndex = 0; columnIndex < (this.columnsCount - 1); columnIndex++, currentHorizontalRatio += horizontalRatioPerStep) {
        const nextHorizontalRatio = currentHorizontalRatio + horizontalRatioPerStep;

        const topLeftVertex = this.lerpNode(currentNode, currentHorizontalRatio);
        const topRightVertex = this.lerpNode(currentNode, nextHorizontalRatio);
        const bottomLeftVertex = this.lerpNode(nextNode, currentHorizontalRatio);
        const bottomRightVertex = this.lerpNode(nextNode, nextHorizontalRatio);

        const vertexIndexOffset = (rowIndex * this.horizontalResolution + columnIndex) * 6 * 3;

        vertices[vertexIndexOffset] = topRightVertex.x;
        vertices[vertexIndexOffset + 1] = topRightVertex.y;
        vertices[vertexIndexOffset + 2] = topRightVertex.z;

        vertices[vertexIndexOffset + 3] = bottomLeftVertex.x;
        vertices[vertexIndexOffset + 4] = bottomLeftVertex.y;
        vertices[vertexIndexOffset + 5] = bottomLeftVertex.z;

        vertices[vertexIndexOffset + 6] = topLeftVertex.x;
        vertices[vertexIndexOffset + 7] = topLeftVertex.y;
        vertices[vertexIndexOffset + 8] = topLeftVertex.z;

        vertices[vertexIndexOffset + 9] = topRightVertex.x;
        vertices[vertexIndexOffset + 10] = topRightVertex.y;
        vertices[vertexIndexOffset + 11] = topRightVertex.z;

        vertices[vertexIndexOffset + 12] = bottomRightVertex.x;
        vertices[vertexIndexOffset + 13] = bottomRightVertex.y;
        vertices[vertexIndexOffset + 14] = bottomRightVertex.z;

        vertices[vertexIndexOffset + 15] = bottomLeftVertex.x;
        vertices[vertexIndexOffset + 16] = bottomLeftVertex.y;
        vertices[vertexIndexOffset + 17] = bottomLeftVertex.z;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
  },

  createNewNode: function () {
    const saberObject = this.saberEl.object3D;

    let newNode;

    switch (this.trailType) {
      case TRAILS.bright:
      case TRAILS.dim:
        newNode = {
          from: new THREE.Vector3(0, -0.5 + this.trailType.width, 0),
          to: new THREE.Vector3(0, -0.5, 0)
        }
        break;
      case TRAILS.slim:
        newNode = {
          from: new THREE.Vector3(this.trailType.width / 2.0, -0.5, 0),
          to: new THREE.Vector3(-this.trailType.width / 2.0, -0.5, 0)
        }
        break;
    }

    saberObject.parent.updateMatrixWorld();
    saberObject.localToWorld(newNode.from);
    saberObject.localToWorld(newNode.to);

    return newNode;
  },

  addNode: function (newNode) {
    const newTipPosition = newNode.from;
    let totalDifference = 0.0;
    totalDifference += Math.abs(this.previousTipPosition.x - newTipPosition.x);
    totalDifference += Math.abs(this.previousTipPosition.y - newTipPosition.y);
    totalDifference += Math.abs(this.previousTipPosition.z - newTipPosition.z);
    if (totalDifference < 0.0001) return false;
    this.previousTipPosition = newTipPosition;

    if (this.lastAddedNode) {
      const linearFrom = this.divideNode(this.sumNodes(this.lastAddedNode, newNode), 2);
      this.linearSegment = this.createLinearSegment(linearFrom, newNode);
      this.lastAddedNode = newNode;
    } else {
      this.lastAddedNode = newNode;
    }

    const handlesArray = this.handlesArray;
    if (handlesArray.length === 3) {
      handlesArray.shift();
    }
    handlesArray.push(newNode);

    if (handlesArray.length < 3) return false;

    const newSegment = this.createCurvedSegment(handlesArray[0], handlesArray[1], handlesArray[2])
    if (this.curvedSegmentsArray.length === this.lifetime) {
      this.curvedSegmentsArray.shift()
    }
    this.curvedSegmentsArray.push(newSegment)
    return true;
  },

  createLinearSegment: function (from, to) {
    return {
      from: from,
      amplitude: this.subtractNodes(to, from)
    }
  },

  createCurvedSegment: function (handleA, handleB, handleC) {
    const p00 = this.divideNode(this.sumNodes(handleA, handleB), 2);
    const p01 = handleB;
    const p02 = this.divideNode(this.sumNodes(handleB, handleC), 2);
    const v00 = this.subtractNodes(p01, p00);
    const v01 = this.subtractNodes(p02, p01);
    return {
      p00: p00,
      p01: p01,
      v00: v00,
      v01: v01
    }
  },

  calculateRowNodes: function () {
    const rowNodesArray = [];

    const linearWeight = 0.5;
    const splinesWeight = this.curvedSegmentsArray.length;
    const totalWeight = linearWeight + splinesWeight;
    const linearAmplitude = linearWeight / totalWeight;
    const splinesAmplitude = splinesWeight / totalWeight;

    let i;
    let t = 0.0;
    let localT;
    const tPerStep = 1 / this.verticalResolution;

    for (i = 0; i < this.rowsCount; i++, t += tPerStep) {
      if (t <= linearAmplitude) {
        localT = 1 - t / linearAmplitude;
        rowNodesArray.push(this.getPointLinear(localT));
      } else {
        localT = 1 - (t - linearAmplitude) / splinesAmplitude;
        rowNodesArray.push(this.getPointSplines(localT));
      }
    }

    return rowNodesArray;
  },

  getPointLinear: function (localT) {
    const linearSegment = this.linearSegment;
    return this.sumNodes(linearSegment.from, this.multiplyNode(linearSegment.amplitude, localT))
  },

  getPointSplines: function (localT) {
    const tPerSpline = 1 / this.curvedSegmentsArray.length;
    let splineIndex = Math.floor(localT / tPerSpline);
    if (splineIndex < 0) splineIndex = 0;
    if (splineIndex >= this.curvedSegmentsArray.length) splineIndex = this.curvedSegmentsArray.length - 1;
    const splineT = (localT - tPerSpline * splineIndex) / tPerSpline;
    return this.evaluateCurvedSegment(this.curvedSegmentsArray[splineIndex], splineT);
  },

  evaluateCurvedSegment: function (segment, t) {
    const p10 = this.sumNodes(segment.p00, this.multiplyNode(segment.v00, t));
    const p11 = this.sumNodes(segment.p01, this.multiplyNode(segment.v01, t));
    const v10 = this.subtractNodes(p11, p10);
    return this.sumNodes(p10, this.multiplyNode(v10, t));
  },

  lerpNode: function (node, t) {
    return new THREE.Vector3().lerpVectors(node.from, node.to, t);
  },

  sumNodes: function (nodeA, nodeB) {
    return {
      from: new THREE.Vector3().addVectors(nodeA.from, nodeB.from),
      to: new THREE.Vector3().addVectors(nodeA.to, nodeB.to)
    }
  },

  subtractNodes: function (nodeA, nodeB) {
    return {
      from: new THREE.Vector3().subVectors(nodeA.from, nodeB.from),
      to: new THREE.Vector3().subVectors(nodeA.to, nodeB.to)
    }
  },

  multiplyNode: function (node, number) {
    return {
      from: new THREE.Vector3().copy(node.from).multiplyScalar(number),
      to: new THREE.Vector3().copy(node.to).multiplyScalar(number)
    }
  },

  divideNode: function (node, number) {
    return {
      from: node.from.clone().divideScalar(number),
      to: node.to.clone().divideScalar(number)
    }
  },
});
