module.exports = {
vertexShader : `
    varying vec2 vUv;

    void main () {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`,

fragmentShader: `
    #extension GL_OES_standard_derivatives : enable
    #define PI 3.14159265358979
    uniform float progress;

    varying vec2 vUv;

    void main () {
    vec2 border = vec2(0.0, 0.0);
    vec4 backCol = vec4(0,0,0,1);
    vec2 uv = vUv;
    
    // generate border mask
	vec2 mask2 = step(border, uv) * step(uv, 1.0-border);
    float mask = mask2.x*mask2.y;

    float blend = ((uv.x - progress) <= 0.0 ? 1.0 : 0.0) * mask;
    vec4 foreCol = vec4(1.0, progress, progress, 1.0);
    gl_FragColor = foreCol*blend + backCol*(1.0-blend);
    }
`};