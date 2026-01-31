const COLORS = require('../constants/colors.js');

const RIGHT_COLOR = new THREE.Color(COLORS.NEON_BLUE);
const WALL_BG = new THREE.Color(COLORS.SKY_RED);
const WALL_HL_COLOR = new THREE.Color('yellow');

AFRAME.registerShader('wallShader', {
	schema: {
		highlight: {type: 'bool', is: 'uniform', default: false},
		thickness: {type: 'float', is: 'uniform', default: 3.0},
		wallColor: {type: 'vec3', is: 'uniform', default: new THREE.Color(COLORS.NEON_RED)},
    zeroDuration: {type: 'bool', is: 'uniform', default: false},
	},

	vertexShader: `
  varying vec2 vUv;
    void main()	{
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, position.y + 0.5, position.z - 0.5, 1.0);
    }
  `,

	fragmentShader: `
    varying vec2 vUv;
    uniform vec3 wallColor;
    uniform bool highlight;
    uniform float thickness;
    uniform bool zeroDuration;

    #define WALL_HL_COLOR vec3(${WALL_HL_COLOR.r}, ${WALL_HL_COLOR.g}, ${WALL_HL_COLOR.b})
   	
    float edgeFactor(vec2 p){
    	vec2 grid = abs(fract(p - 0.5) - 0.5) / fwidth(p);
  		return min(grid.x, grid.y);
    }
    
    void main() {
			
      float a = edgeFactor(vUv);
      if (a < thickness && !zeroDuration) {
        gl_FragColor = mix(vec4(wallColor, 1.0), vec4(1.0, 1.0, 1.0, 1.0), 1.0 - sqrt(a / thickness));
      } else {
        gl_FragColor = vec4(wallColor * 0.4, 0.3);
      }

      if (highlight) {
        gl_FragColor = mix(gl_FragColor, vec4(WALL_HL_COLOR, 1.0), 0.4);
      }
    }
`,
});
