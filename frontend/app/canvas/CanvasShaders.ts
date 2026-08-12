/** Transforms a unit quad and forwards its texture coordinates. */
export const CANVAS_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aUv;

uniform mat3 uMvp;

out vec2 vUv;

void main() {
  vUv = aUv;
  vec3 clip = uMvp * vec3(aPosition, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

/** Converts a straight-alpha texture to premultiplied output for final canvas blending. */
export const CANVAS_DISPLAY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uImage;
uniform float uOpacity;

out vec4 outColor;

void main() {
  vec4 straight = texture(uImage, vUv);
  float alpha = straight.a * uOpacity;
  outColor = vec4(straight.rgb * alpha, alpha);
}
`;

/** Copies a straight-alpha snapshot without changing its alpha representation. */
export const SNAPSHOT_COPY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uImage;
uniform float uOpacity;
out vec4 outColor;

void main() {
  outColor = texture(uImage, vUv) * uOpacity;
}
`;

/** Performs source-over in straight-alpha space and writes another straight-alpha snapshot. */
export const STRAIGHT_COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uDestination;
uniform vec2 uTargetSize;
uniform float uOpacity;
out vec4 outColor;

void main() {
  vec4 source = texture(uSource, vUv);
  vec2 destinationUv = gl_FragCoord.xy / uTargetSize;
  vec4 destination = texture(uDestination, destinationUv);
  float sourceAlpha = source.a * uOpacity;
  float inverseSourceAlpha = 1.0 - sourceAlpha;
  float outputAlpha = sourceAlpha + destination.a * inverseSourceAlpha;
  vec3 premultiplied = source.rgb * sourceAlpha
    + destination.rgb * destination.a * inverseSourceAlpha;
  vec3 straight = outputAlpha > 0.0 ? premultiplied / outputAlpha : vec3(0.0);
  outColor = vec4(straight, outputAlpha);
}
`;
