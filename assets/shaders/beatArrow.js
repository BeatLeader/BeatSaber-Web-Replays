module.exports = {
	vertexShader: `
    varying vec2 uvs;
    varying vec3 worldPos;
    void main() {
      uvs.xy = uv.xy;
      vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      worldPos = (modelMatrix * vec4( position, 1.0 )).xyz;
      gl_Position = p;
    }
  `,

	fragmentShader: `
    varying vec2 uvs;
    varying vec3 worldPos;
    uniform float start;
    uniform float finish;

    void main() {
      float mask;
      vec4 col = vec4(1, 1, 1, 1);

      if (worldPos.z >= start) {
        gl_FragColor = col * (1.0 - (worldPos.z - start) / (finish - start));
      } else if (worldPos.z >= finish) {
        gl_FragColor = col * 0.0;
      } else {
        gl_FragColor = col;
      }
    }
  `,
};
