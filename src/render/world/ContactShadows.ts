import * as THREE from "three";
import { disposeEntity } from "../objects/EntityDisposal";

/** A single analytic, image-free contact pass also available on mobile GPUs. */
export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private transform = new THREE.Object3D();
  private count = 0;

  constructor(private capacity = 512) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color("#4b5968") } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * p;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor; varying vec2 vUv;
        void main() {
          float distanceToCenter = length((vUv - .5) * 2.0);
          float alpha = (1.0 - smoothstep(.08, 1.0, distanceToCenter)) * .20;
          if (alpha < .003) discard;
          gl_FragColor = vec4(uColor, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = "analytic-contact-shadows";
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
  }

  begin(): void { this.count = 0; }

  add(x: number, z: number, width: number, depth = width): void {
    if (this.count >= this.capacity) return;
    this.transform.position.set(x, 0.052, z);
    this.transform.scale.set(width, 1, depth);
    this.transform.updateMatrix();
    this.mesh.setMatrixAt(this.count++, this.transform.matrix);
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void { disposeEntity(this.mesh); }
}
