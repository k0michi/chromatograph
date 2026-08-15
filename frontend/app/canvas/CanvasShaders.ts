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

/** Performs a Porter-Duff composite operation in straight-alpha space. */
export const STRAIGHT_COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

const int COMPOSITE_OP_SOURCE_OVER = 0;
const int COMPOSITE_OP_DESTINATION_OUT = 1;
const int COMPOSITE_OP_SOURCE_IN = 2;
const int COMPOSITE_OP_SOURCE_ATOP = 3;

in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uDestination;
uniform vec2 uTargetSize;
uniform float uOpacity;
uniform int uCompositeOp;
out vec4 outColor;

void main() {
  vec4 source = texture(uSource, vUv);
  vec2 destinationUv = gl_FragCoord.xy / uTargetSize;
  vec4 destination = texture(uDestination, destinationUv);
  float sourceAlpha = source.a * uOpacity;
  float sourceFactor = 1.0;
  float destinationFactor = 1.0 - sourceAlpha;
  if (uCompositeOp == COMPOSITE_OP_DESTINATION_OUT) {
    sourceFactor = 0.0;
  } else if (uCompositeOp == COMPOSITE_OP_SOURCE_IN) {
    sourceFactor = destination.a;
    destinationFactor = 0.0;
  } else if (uCompositeOp == COMPOSITE_OP_SOURCE_ATOP) {
    sourceFactor = destination.a;
  }
  float outputAlpha = sourceAlpha * sourceFactor + destination.a * destinationFactor;
  vec3 premultiplied = source.rgb * sourceAlpha * sourceFactor
    + destination.rgb * destination.a * destinationFactor;
  vec3 straight = outputAlpha > 0.0 ? premultiplied / outputAlpha : vec3(0.0);
  outColor = vec4(straight, outputAlpha);
}
`;

/** Draws world-space tile boundaries as a screen-space overlay. */
export const TILE_GRID_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uViewportSize;
uniform vec2 uCameraPosition;
uniform float uZoom;
uniform float uGridSize;
out vec4 outColor;

void main() {
  vec2 screen = gl_FragCoord.xy - uViewportSize * 0.5;
  vec2 world = uCameraPosition + vec2(screen.x, -screen.y) / uZoom;
  vec2 cell = mod(world, uGridSize);
  vec2 distanceToLine = min(cell, uGridSize - cell) * uZoom;
  float alpha = 1.0 - smoothstep(0.5, 1.5, min(distanceToLine.x, distanceToLine.y));
  outColor = vec4(vec3(0.25), alpha * 0.65);
}
`;
import { CompositeOp } from "./Operation";
