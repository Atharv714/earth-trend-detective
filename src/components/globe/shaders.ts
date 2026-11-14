// Earth: NASA Blue Marble by day, Black Marble city lights by night,
// a sun glint on the oceans and a thin blue limb of air.

export const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const earthFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D waterMap;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float ndl = dot(n, sunDir);

    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    float water = texture2D(waterMap, vUv).r;

    float light = smoothstep(-0.18, 0.35, ndl);
    vec3 lit = day * (0.18 + 1.05 * max(ndl, 0.0));
    vec3 lights = pow(night, vec3(1.6)) * vec3(1.0, 0.78, 0.5) * 2.2;
    vec3 col = mix(lights + day * 0.035, lit, light);

    // Ocean glint
    vec3 h = normalize(sunDir + v);
    float spec = pow(max(dot(n, h), 0.0), 60.0) * water * light;
    col += vec3(0.75, 0.85, 1.0) * spec * 0.55;

    // Air seen edge-on scatters blue; warmer near the terminator
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.2);
    vec3 air = mix(vec3(1.0, 0.55, 0.3), vec3(0.35, 0.65, 1.0), smoothstep(-0.1, 0.4, ndl));
    col += air * fres * (0.1 + 0.9 * light) * 0.6;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const atmosphereVertex = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vPosV;
  void main() {
    vNormalV = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPosV = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

export const atmosphereFragment = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vPosV;
  void main() {
    vec3 v = normalize(-vPosV);
    float d = dot(vNormalV, v);
    // Back faces: d is 0 at the halo's outer rim and about -0.39 where it
    // meets the planet's edge, so the glow hugs the limb and fades outward.
    float glow = pow(smoothstep(0.0, 0.39, -d), 4.5);
    gl_FragColor = vec4(vec3(0.32, 0.58, 1.0) * glow * 0.7, glow);
  }
`;
