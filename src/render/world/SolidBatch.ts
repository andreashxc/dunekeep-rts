import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Point = readonly [number, number, number];

/** Painted geometry, not image textures. One material/draw call for an entire prop cluster. */
export class SolidBatch {
  private pieces: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, position: Point = [0, 0, 0], rotation: Point = [0, 0, 0], scale: Point = [1, 1, 1]): this {
    const piece = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    piece.deleteAttribute("uv");
    piece.deleteAttribute("uv1");
    if (!piece.getAttribute("normal")) piece.computeVertexNormals();
    const tint = new THREE.Color(color);
    const colors = new Float32Array(piece.getAttribute("position").count * 3);
    for (let index = 0; index < colors.length; index += 3) {
      colors[index] = tint.r;
      colors[index + 1] = tint.g;
      colors[index + 2] = tint.b;
    }
    piece.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    );
    piece.applyMatrix4(matrix);
    this.pieces.push(piece);
    return this;
  }

  box(x: number, y: number, z: number, width: number, height: number, depth: number, color: THREE.ColorRepresentation, yaw = 0): this {
    return this.add(new THREE.BoxGeometry(width, height, depth), color, [x, y, z], [0, yaw, 0]);
  }

  cylinder(x: number, y: number, z: number, top: number, bottom: number, height: number, color: THREE.ColorRepresentation, sides = 8, rotation: Point = [0, 0, 0]): this {
    return this.add(new THREE.CylinderGeometry(top, bottom, height, sides), color, [x, y, z], rotation);
  }

  rock(x: number, y: number, z: number, radius: number, color: THREE.ColorRepresentation, scale: Point = [1, 1, 1], yaw = 0): this {
    return this.add(new THREE.DodecahedronGeometry(radius, 0), color, [x, y, z], [0.08, yaw, 0.14], scale);
  }

  beam(from: Point, to: Point, radius: number, color: THREE.ColorRepresentation, sides = 6): this {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const direction = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(radius * 0.86, radius, direction.length(), sides);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
    return this.add(geometry, color);
  }

  triangle(a: Point, b: Point, c: Point, color: THREE.ColorRepresentation): this {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...c, ...b, ...a], 3));
    geometry.computeVertexNormals();
    return this.add(geometry, color);
  }

  mesh(name: string, shadows = true): THREE.Mesh {
    const geometry = this.pieces.length ? mergeGeometries(this.pieces, false)! : new THREE.BufferGeometry();
    for (const piece of this.pieces) piece.dispose();
    this.pieces = [];
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, flatShading: true }));
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    return mesh;
  }
}
