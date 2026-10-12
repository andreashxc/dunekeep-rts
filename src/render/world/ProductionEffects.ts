import * as THREE from 'three';
import { disposeEntity } from '../objects/EntityDisposal';

/** One reusable billboard pool for all working chimneys. No per-frame geometry or materials. */
export class ProductionEffects {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private transform = new THREE.Object3D();
  private alpha: THREE.InstancedBufferAttribute;
  private colors: THREE.InstancedBufferAttribute;
  private origin = new THREE.Vector3();
  private outlets = new WeakMap<THREE.Group, THREE.Object3D | null>();
  private hearths = new WeakMap<THREE.Group, THREE.Object3D | null>();
  private bakeryColor = new THREE.Color('#edf0e5');
  private forgeColor = new THREE.Color('#68736f');
  private elapsed = 0;
  private disposed = false;
  private sourceIds: Int32Array;
  constructor(readonly capacity = 192) {
    this.sourceIds = new Int32Array(capacity);
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('puffAlpha', this.alpha);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float puffAlpha;
        varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
        void main(){ vUv=uv; vAlpha=puffAlpha; vColor=instanceColor;
          vec4 centre=modelViewMatrix*vec4(instanceMatrix[3].xyz,1.);
          float size=length(instanceMatrix[0].xyz);
          centre.xy+=position.xy*size;
          gl_Position=projectionMatrix*centre; }`,
      fragmentShader: `varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
        void main(){ float a=(1.-smoothstep(.14,.5,length(vUv-.5)))*vAlpha;
          if(a<.002) discard; gl_FragColor=vec4(vColor,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceColor = this.colors;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'working-chimney-smoke';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 4;
  }

  update(buildings: ReadonlyMap<number, THREE.Group>, elapsed: number, paused: boolean, low: boolean): void {
    if (this.disposed) return;
    if (!paused) this.elapsed = elapsed;
    const puffs = low ? 1 : 3;
    const limit = Math.min(this.capacity, low ? 16 : 192);
    let count = 0;
    for (const [id, group] of buildings) {
      const kind = group.userData.buildingKind;
      if (kind !== 'bakery' && kind !== 'blacksmith') continue;
      let hearth = this.hearths.get(group);
      if (hearth === undefined) {
        hearth = group.getObjectByName(`${kind}-hearth`) ?? null;
        this.hearths.set(group, hearth);
      }
      const operating = Boolean(group.userData.isOperating);
      if (hearth) hearth.visible = operating;
      if (!operating || !group.visible) continue;
      let outlet = this.outlets.get(group);
      if (outlet === undefined) {
        outlet = group.getObjectByName('chimney-outlet') ?? null;
        this.outlets.set(group, outlet);
      }
      if (!outlet) continue;
      outlet.getWorldPosition(this.origin);
      const bakery = kind === 'bakery';
      const color = bakery ? this.bakeryColor : this.forgeColor;
      for (let index = 0; index < puffs && count < limit; index++) {
        const phase = (this.elapsed * 0.34 + index / puffs + (id * 0.173 % 1)) % 1;
        // At strategic zoom the old 0.35-unit puff occupied about six pixels;
        // retain the same pool while giving its soft core a readable footprint.
        const size = (0.22 + phase * 0.45) * group.scale.x;
        this.transform.position.set(
          this.origin.x + phase * 0.15,
          this.origin.y + phase * 0.95 * group.scale.y,
          this.origin.z + Math.sin(phase * 4 + id) * 0.045,
        );
        this.transform.scale.setScalar(size);
        this.transform.updateMatrix();
        this.mesh.setMatrixAt(count, this.transform.matrix);
        this.sourceIds[count] = id;
        this.alpha.setX(count, Math.sin(phase * Math.PI) * (bakery ? 0.38 : 0.42));
        this.colors.setXYZ(count, color.r, color.g, color.b);
        count++;
      }
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.colors.needsUpdate = true;
  }

  /** Explicit debug sampling only; bounded to six puffs, never called by update. */
  diagnostics(camera?: THREE.Camera) {
    const particles = [];
    const point = new THREE.Vector3();
    for (let index = 0; index < Math.min(this.mesh.count, 6); index++) {
      const offset = index * 16;
      const values = this.mesh.instanceMatrix.array;
      point.set(values[offset + 12], values[offset + 13], values[offset + 14]);
      const position = { x: point.x, y: point.y, z: point.z };
      if (camera) point.project(camera);
      particles.push({ buildingId: this.sourceIds[index], position,
        ndc: camera ? { x: point.x, y: point.y, z: point.z } : null,
        size: values[offset], alpha: this.alpha.getX(index) });
    }
    return { count: this.mesh.count, visible: this.mesh.visible, attached: Boolean(this.mesh.parent),
      parentVisible: this.mesh.parent?.visible ?? false, disposed: this.disposed,
      materialVisible: this.mesh.material.visible, particles };
  }

  reset(): void { this.elapsed = 0; this.mesh.count = 0; this.mesh.visible = false; }
  dispose(): void { if (this.disposed) return; this.disposed = true; disposeEntity(this.mesh); }
}
