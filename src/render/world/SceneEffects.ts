import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";

/** Labels, placement ghosts and analytic contact quads are not physical occluders. */
class WorldOcclusionPass extends GTAOPass {
  private hidden: THREE.Object3D[] = [];

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    this.scene.traverse((node) => {
      if (!node.visible) return;
      const transparentMesh = node instanceof THREE.Mesh && (Array.isArray(node.material) ? node.material : [node.material]).some((material) => material.transparent);
      if (node instanceof THREE.Sprite || transparentMesh) {
        node.visible = false;
        this.hidden.push(node);
      }
    });
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false; // the color pass has already drawn this frame's shadows
    try { super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive); }
    finally {
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      for (const node of this.hidden) node.visible = true;
      this.hidden.length = 0;
    }
  }
}

/** Desktop-only contact depth. Mobile retains the same art, shadows and analytic grounding. */
export class SceneEffects {
  private composer: EffectComposer;
  private occlusion: WorldOcclusionPass;
  private output = new OutputPass();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1.5));
    this.composer.addPass(new RenderPass(scene, camera));
    this.occlusion = new WorldOcclusionPass(scene, camera, 1, 1);
    this.occlusion.blendIntensity = 0.36;
    this.occlusion.updateGtaoMaterial({ radius: 0.56, thickness: 0.9, distanceFallOff: 0.9, distanceExponent: 1.5, scale: 0.85, samples: 8, screenSpaceRadius: false });
    this.occlusion.updatePdMaterial({ samples: 8, rings: 2, radius: 4 });
    this.composer.addPass(this.occlusion);
    this.composer.addPass(this.output);
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.occlusion.setSize(Math.max(1, Math.round(width * 0.75)), Math.max(1, Math.round(height * 0.75)));
  }

  render(delta: number): void { this.composer.render(delta); }

  dispose(): void {
    // r179 GTAOPass.dispose omits these two materials; release them explicitly.
    this.occlusion.gtaoMaterial.dispose();
    this.occlusion.blendMaterial.dispose();
    this.occlusion.dispose();
    this.output.dispose();
    this.composer.dispose();
  }
}
