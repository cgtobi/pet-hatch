import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** Three hard light bands: the cel-shaded look. */
function gradientMap(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toon(
  color: THREE.ColorRepresentation,
  opts: THREE.MeshToonMaterialParameters = {},
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
}

/** Deterministic pseudo-noise from a position, so duplicated seam vertices move together. */
export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719);
  return (s * 43758.5453) % 1;
}

export const TYPE_COLORS = {
  ember: '#ff9a5c',
  tide: '#6ec3f0',
  bloom: '#86d7a0',
  astral: '#b8a2ff',
} as const;

/** Faceted low-poly look: split shared vertices so every face gets its own flat normal. */
export function facet<T extends THREE.BufferGeometry>(geo: T): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  return flat;
}
