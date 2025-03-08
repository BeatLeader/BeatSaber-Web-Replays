module.exports = {
	vertexShader: `
        varying vec2 vUv;
        varying vec3 worldPos;
    
        void main () {
        vUv = uv;
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        worldPos = (modelMatrix * vec4( position, 1.0 )).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

	fragmentShader: `
        #define PI 3.14159265358979

        uniform vec3 mainColor;
        uniform float start;
        uniform float finish;
    
        varying vec2 vUv;
        varying vec3 worldPos;
    
        void main () {
        vec2 border = vec2(0.0, 0.0);
        vec4 backCol = vec4(0,0,0,1);
        vec2 uv = vUv;
        
        // generate border mask
        vec2 mask2 = step(border, uv) * step(uv, 1.0-border);
        float mask = mask2.x*mask2.y;
        if (worldPos.z <= start && worldPos.z >= finish) {
            gl_FragColor = vec4(mainColor.x, mainColor.y, mainColor.z, 1.0);
        } else {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
        
        }
    `,
};
