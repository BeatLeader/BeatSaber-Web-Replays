const TRAILS = {
	bright: {
		vertexShader: `
      attribute vec4 vertexData;
      varying vec2 uv0;
      
      void main() {
      	float forward_offset = 0.1 + 0.9 * uv.x;
      	vec3 offset = normalize(vertexData.xyz) * forward_offset;
      
        uv0 = uv;
        vec4 modelViewPosition = modelViewMatrix * vec4(position + offset, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
      }`,
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
        float edgeFade = clamp((1.0 - uv0.x) / 0.014, 0.0, 1.0);
        float nullFade = pow(uv0.y, 2.0) * pow(uv0.x, 0.4);
        float tipFade = 0.8 * pow(uv0.x, 10.0 + 60.0 * (1.0 - uv0.y)) * pow(uv0.y, 0.4);
        vec4 col = bladeColor * nullFade;
        col = lerpColor(col, tipColor, tipFade);
        gl_FragColor = col * edgeFade * bladeColor.w;
      }`,
	},
	dim: {
		vertexShader: `
      attribute vec4 vertexData;
      varying vec2 uv0;
      
      void main() {
      	float forward_offset = 0.6 + 0.4 * uv.x;
      	vec3 offset = normalize(vertexData.xyz) * forward_offset;
      
        uv0 = uv;
        vec4 modelViewPosition = modelViewMatrix * vec4(position + offset, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
      }`,
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
        float edgeFade = clamp((1.0 - uv0.x) / 0.022, 0.0, 1.0);
        float nullFade = pow(uv0.y, 0.8) * pow(uv0.x, 0.6);
        float tipFade = 0.2 * pow(uv0.x, 10.0 + 60.0 * (1.0 - uv0.y)) * pow(uv0.y, 0.4);
        vec4 col = bladeColor * nullFade;
        col = lerpColor(col, tipColor, tipFade);
        gl_FragColor = col * edgeFade * bladeColor.w;
      }`,
	},
	timeDependence: {
		vertexShader: `
      attribute vec4 vertexData;
      varying vec2 uv0;
      varying float td;
      
      void main() {
      	float forward_offset = 0.1 + 0.9 * uv.x;
      	vec3 offset = normalize(vertexData.xyz) * forward_offset;
      
        uv0 = uv;
        td = vertexData.w;
        vec4 modelViewPosition = modelViewMatrix * vec4(position + offset, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
      }`,
		fragmentShader: `
      uniform vec4 bladeColor;
      varying vec2 uv0;
      varying float td;
      
      #define goodTdValue 0.0
      #define goodTdColor vec4(0.0, 1.0, 0.0, 1.0)
      
      #define neutralTdValue 0.15
      #define neutralTdColor vec4(1.0, 1.0, 0.0, 1.0)
      
      #define badTdValue 0.3
      #define badTdColor vec4(1.0, 0.0, 0.0, 1.0)
      
      float inverseLerpClamped01(const float from, const float to, const float value) {
        return clamp((value - from) / (to - from), 0.0, 1.0);
      }
      
      vec4 lerpColor(const vec4 a, const vec4 b, const float t) {
        return vec4(
          a.r + (b.r - a.r) * t,
          a.g + (b.g - a.g) * t,
          a.b + (b.b - a.b) * t,
          a.a + (b.a - a.a) * t
        );
      }
      
      void main() {
        float edgeFade = clamp((1.0 - uv0.x) / 0.022, 0.0, 1.0);
        float nullFade = pow(uv0.y, 1.0) * pow(uv0.x, 0.2);
        
        float neutralTdRatio = inverseLerpClamped01(goodTdValue, neutralTdValue, td);
        float badTdRatio = inverseLerpClamped01(neutralTdValue, badTdValue, td);
        
        vec4 col = goodTdColor;
        col = lerpColor(col, neutralTdColor, neutralTdRatio);
        col = lerpColor(col, badTdColor, badTdRatio);
        gl_FragColor = col * nullFade * edgeFade * bladeColor.w;
      }`,
	},
	slim: {
		vertexShader: `
      attribute vec4 vertexData;
      varying vec2 uv0;
      
      #define thickness 0.06
      
      vec3 get_cam_pos(const mat4 a_modelView)
      {
        mat3 rotMat = mat3(a_modelView);
        vec3 d = vec3(a_modelView[3]);
        vec3 retVec = -d * rotMat;
        return retVec;
      }
			
      void main() {
      	vec3 cam_pos = get_cam_pos(modelViewMatrix);
      	
      	vec3 forward = normalize(vertexData.xyz);
    		vec3 velocity = vec3(0, 1, 0);
    		vec3 look_from = position + forward;
		
    		float x_offset = (uv.x - 0.5) * thickness;
    		vec3 look_up = cam_pos - look_from;
    		vec3 look_z_axis = normalize(velocity);
    		vec3 look_x_axis = normalize(cross(look_up, look_z_axis));
    		vec3 pos = look_from + look_x_axis * x_offset;
      
        uv0 = uv;
        vec4 modelViewPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
      }`,
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
          
          float diff = (start_curve_value + middle_curve_value + end_curve_value) - x;
          return clamp(diff/0.3, 0.0, 1.0);
      }
      
      void main() {
        float x = abs(uv0.x - 0.5) * 2.0;
        float y = 1.0 - uv0.y;
        float fade_value = get_fade_value(x, y);
        vec4 col = lerpColor(bladeColor, tip_color, 0.4);
        gl_FragColor = col * fade_value * bladeColor.w;
      }`,
	},
};

AFRAME.registerComponent('trail', {
	schema: {
		color: {type: 'color'},
		opacity: {default: 1.0},
		enabled: {default: false},
		eliminated: {default: false},
		hand: {type: 'string'},
		trailType: {default: 'bright'},
		index: {default: 0},
		lifetime: {default: 20}, //frames
	},

	init: function () {
		//TRAIL CONFIG ---------------------------------------------------------------------
		//You must call init (and potentially dispose already existing mesh) after any config change
		this.verticalResolution = 120; //quads
		this.horizontalResolution = 2; //quads
		//TRAIL CONFIG ---------------------------------------------------------------------

		this.saberEl = this.el.querySelector('.blade');

		this.verticalRatioPerStep = 1 / this.verticalResolution;
		this.horizontalRatioPerStep = 1 / this.horizontalResolution;
		this.columnsCount = this.horizontalResolution + 1;
		this.rowsCount = this.verticalResolution + 1;
		this.cutPlane = new THREE.Plane();
	},

	createMesh: function () {
		const quadCount = this.verticalResolution * this.horizontalResolution;

		const geometry = (this.geometry = new THREE.BufferGeometry());
		const vertices = (this.vertices = new Float32Array(quadCount * 6 * 3));
		const uv = (this.uv = new Float32Array(quadCount * 6 * 2));
		const vertexData = (this.vertexData = new Float32Array(quadCount * 6 * 4));

		geometry.addAttribute('position', new THREE.BufferAttribute(vertices, 3).setDynamic(true));
		geometry.addAttribute('uv', new THREE.BufferAttribute(uv, 2).setDynamic(true));
		geometry.addAttribute('vertexData', new THREE.BufferAttribute(vertexData, 4).setDynamic(true));

		const mesh = new THREE.Mesh(geometry, this.material);
		mesh.frustumCulled = false;
		mesh.vertices = vertices;
		mesh.uv = uv;
		mesh.renderOrder = 5;
		this.el.sceneEl.setObject3D(`trail__${this.data.hand}${this.data.index}`, mesh);

		this.fillUvArray();
		return mesh;
	},

	createMaterial: function () {
		return new THREE.ShaderMaterial({
			side: THREE.DoubleSide,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			vertexShader: this.trailType.vertexShader,
			fragmentShader: this.trailType.fragmentShader,
			uniforms: {
				bladeColor: {value: {x: 0, y: 0, z: 0, w: 0}},
			},
		});
	},

	fillUvArray: function () {
		const uv = this.geometry.attributes.uv.array;

		let verticalRatio = 1;
		for (let rowIndex = 0; rowIndex < this.rowsCount - 1; rowIndex++, verticalRatio -= this.verticalRatioPerStep) {
			const nextVerticalRatio = verticalRatio - this.verticalRatioPerStep;

			let horizontalRatio = 0;
			for (let columnIndex = 0; columnIndex < this.columnsCount - 1; columnIndex++, horizontalRatio += this.horizontalRatioPerStep) {
				const nextHorizontalRatio = horizontalRatio + this.horizontalRatioPerStep;

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
			w: this.data.opacity,
		};
		this.material.uniformsNeedUpdate = true;
	},

	update: function (oldData) {
		this.trailType = TRAILS[this.data.trailType];
		this.lifetime = this.data.lifetime;

		this.previousTipPosition = new THREE.Vector3(0, 0, 0);
		this.material = this.createMaterial();
		this.mesh = this.createMesh();
		this.updateColor();

		this.handlesArray = [];
		this.curvedSegmentsArray = [];
		this.linearSegment = null;
		this.lastAddedNode = null;

		if (!oldData.enabled && this.data.enabled && !this.data.eliminated) {
			this.enabledTime = this.el.sceneEl.time;
			this.mesh.visible = false;
		}

		if (oldData.enabled && !this.data.enabled) {
			this.mesh.visible = false;
		}
	},

	tick: function (time, delta) {
		if (!this.data.enabled || this.data.eliminated) {
			return;
		}
		// Delay before showing after enabled to prevent flash from old saber position.
		if (!this.mesh.visible && time > this.enabledTime + 250) {
			this.mesh.visible = true;
		}

		const song = this.el.sceneEl.components.song;
		if (song) {
			this.hotUpdateLifetime(this.data.lifetime / song.speed);
		}

		if (!this.addNewNode()) return;
		this.updateMesh(this.calculateRowNodes());
	},

	hotUpdateLifetime: function (newLifetime) {
		if (newLifetime < 1) newLifetime = 1;
		if (newLifetime > 200) newLifetime = 200;
		if (this.lifetime === newLifetime) return;
		this.lifetime = newLifetime;

		if (this.curvedSegmentsArray.length > this.lifetime) {
			this.curvedSegmentsArray = this.curvedSegmentsArray.slice(0, this.lifetime);
		}
	},

	updateMesh: function (rowNodes) {
		const positionsArray = this.geometry.attributes.position.array;
		const dataArray = this.geometry.attributes.vertexData.array;

		let setVertexData = function (positionsOffset, dataOffset, quadVertexIndex, node) {
			positionsArray[positionsOffset + quadVertexIndex * 3] = node.position.x;
			positionsArray[positionsOffset + quadVertexIndex * 3 + 1] = node.position.y;
			positionsArray[positionsOffset + quadVertexIndex * 3 + 2] = node.position.z;
			dataArray[dataOffset + quadVertexIndex * 4] = node.forward.x;
			dataArray[dataOffset + quadVertexIndex * 4 + 1] = node.forward.y;
			dataArray[dataOffset + quadVertexIndex * 4 + 2] = node.forward.z;
			dataArray[dataOffset + quadVertexIndex * 4 + 3] = node.timeDependence;
		};

		for (let rowIndex = 0; rowIndex < this.rowsCount - 1; rowIndex++) {
			const currentNode = rowNodes[rowIndex];
			const nextNode = rowNodes[rowIndex + 1];

			for (let columnIndex = 0; columnIndex < this.columnsCount - 1; columnIndex++) {
				const quadIndex = rowIndex * this.horizontalResolution + columnIndex;
				const positionsOffset = quadIndex * 6 * 3;
				const dataOffset = quadIndex * 6 * 4;

				//   Quad:
				//   V0---V1   <-- Current Node
				//   |   / |
				//   |T0/T1|
				//   | /   |
				//   V2---V3   <-- Next Node

				//<------ T0 - V0 ------>
				setVertexData(positionsOffset, dataOffset, 0, currentNode);
				//<------ T0 - V2 ------>
				setVertexData(positionsOffset, dataOffset, 1, nextNode);
				//<------ T0 - V1 ------>
				setVertexData(positionsOffset, dataOffset, 2, currentNode);

				//<------ T1 - V1 ------>
				setVertexData(positionsOffset, dataOffset, 3, currentNode);
				//<------ T1 - V3 ------>
				setVertexData(positionsOffset, dataOffset, 4, nextNode);
				//<------ T1 - V2 ------>
				setVertexData(positionsOffset, dataOffset, 5, nextNode);
			}
		}

		this.geometry.attributes.position.needsUpdate = true;
		this.geometry.attributes.vertexData.needsUpdate = true;
	},

	addNewNode: function () {
		const saberObject = this.saberEl.object3D;
		saberObject.parent.updateMatrixWorld();
		const hiltPosition = new THREE.Vector3(0, 0.5, 0);
		const tipPosition = new THREE.Vector3(0, -0.5, 0);
		saberObject.localToWorld(hiltPosition);
		saberObject.localToWorld(tipPosition);

		let totalDifference = 0.0;
		totalDifference += Math.abs(this.previousTipPosition.x - tipPosition.x);
		totalDifference += Math.abs(this.previousTipPosition.y - tipPosition.y);
		totalDifference += Math.abs(this.previousTipPosition.z - tipPosition.z);
		if (totalDifference < 0.0001) return false;
		const cutPlane = this.cutPlane.setFromCoplanarPoints(this.previousTipPosition, tipPosition, hiltPosition);
		this.previousTipPosition.copy(tipPosition);

		const newNode = {
			position: hiltPosition,
			forward: tipPosition.subVectors(tipPosition, hiltPosition),
			timeDependence: Math.abs(cutPlane.normal.z),
		};

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

		const newSegment = this.createCurvedSegment(handlesArray[0], handlesArray[1], handlesArray[2]);
		if (this.curvedSegmentsArray.length >= this.lifetime) {
			this.curvedSegmentsArray.shift();
		}
		this.curvedSegmentsArray.push(newSegment);
		return true;
	},

	createLinearSegment: function (from, to) {
		return {
			from: from,
			amplitude: this.subtractNodes(to, from),
		};
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
			v01: v01,
		};
	},

	calculateRowNodes: function () {
		const rowNodesArray = [];

		const linearWeight = 0.5;
		const splinesWeight = this.curvedSegmentsArray.length;
		const totalWeight = linearWeight + splinesWeight;
		const linearAmplitude = linearWeight / totalWeight;
		const splinesAmplitude = splinesWeight / totalWeight;

		for (let i = 0; i < this.rowsCount; i++) {
			const t = i / this.verticalResolution;

			if (t <= linearAmplitude) {
				const localT = 1 - t / linearAmplitude;
				rowNodesArray.push(this.getPointLinear(localT));
			} else {
				const localT = 1 - (t - linearAmplitude) / splinesAmplitude;
				rowNodesArray.push(this.getPointSplines(localT));
			}
		}

		return rowNodesArray;
	},

	getPointLinear: function (localT) {
		const linearSegment = this.linearSegment;
		const result = this.sumNodes(linearSegment.from, this.multiplyNode(linearSegment.amplitude, localT));
		result.forward.normalize();
		return result;
	},

	getPointSplines: function (localT) {
		const tPerSpline = 1 / this.curvedSegmentsArray.length;
		let splineIndex = Math.floor(localT / tPerSpline);
		if (splineIndex < 0) splineIndex = 0;
		if (splineIndex >= this.curvedSegmentsArray.length) splineIndex = this.curvedSegmentsArray.length - 1;
		const splineT = (localT - tPerSpline * splineIndex) / tPerSpline;
		const result = this.evaluateCurvedSegment(this.curvedSegmentsArray[splineIndex], splineT);
		result.forward.normalize();
		return result;
	},

	evaluateCurvedSegment: function (segment, t) {
		const p10 = this.sumNodes(segment.p00, this.multiplyNode(segment.v00, t));
		const p11 = this.sumNodes(segment.p01, this.multiplyNode(segment.v01, t));
		const v10 = this.subtractNodes(p11, p10);
		return this.sumNodes(p10, this.multiplyNode(v10, t));
	},

	sumNodes: function (nodeA, nodeB) {
		return {
			position: new THREE.Vector3().addVectors(nodeA.position, nodeB.position),
			forward: new THREE.Vector3().addVectors(nodeA.forward, nodeB.forward),
			timeDependence: nodeA.timeDependence + nodeB.timeDependence,
		};
	},

	subtractNodes: function (nodeA, nodeB) {
		return {
			position: new THREE.Vector3().subVectors(nodeA.position, nodeB.position),
			forward: new THREE.Vector3().subVectors(nodeA.forward, nodeB.forward),
			timeDependence: nodeA.timeDependence - nodeB.timeDependence,
		};
	},

	multiplyNode: function (node, number) {
		return {
			position: node.position.clone().multiplyScalar(number),
			forward: node.forward.clone().multiplyScalar(number),
			timeDependence: node.timeDependence * number,
		};
	},

	divideNode: function (node, number) {
		return {
			position: node.position.clone().divideScalar(number),
			forward: node.forward.clone().divideScalar(number),
			timeDependence: node.timeDependence / number,
		};
	},
});
