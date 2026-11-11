// Sky, sun, ambient light, fog and weather.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Env } from './types';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1 }, contrast: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float saturation; uniform float contrast; varying vec2 vUv;
void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(l), c.rgb, saturation); c.rgb = (c.rgb - 0.5) * contrast + 0.5; gl_FragColor = c; }`,
};
const NIGHT = { top: new THREE.Color('#04060f'), horizon: new THREE.Color('#111a33'), fog: new THREE.Color('#0a0f1f') };
const tmpC = new THREE.Color(), size = new THREE.Vector2();

const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FS = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunPower;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
  if (h < 0.0) col = mix(horizon, horizon * 0.55, clamp(-h * 4.0, 0.0, 1.0));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += sunColor * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.18) * sunPower;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Environment {
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1);
  sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private rain: THREE.LineSegments | null = null;
  private snow: THREE.Points | null = null;
  private weather: Env['weather'] = 'none';
  sunDir = new THREE.Vector3(0, 1, 0);
  /** Set by the runtime: lets the sun move when the world has a day length. The editor keeps it still. */
  dayCycle = false;
  private base: Env | null = null;
  private phase = 0;
  private fx = { bloom: 0, saturation: 1, contrast: 1 };
  private post: { r: THREE.WebGLRenderer; composer: EffectComposer; pass: RenderPass; bloom: UnrealBloomPass; grade: ShaderPass; w: number; h: number } | null = null;

  constructor(private scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, sunPower: { value: 1 } },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.scale.setScalar(9000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sky, this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.FogExp2(0xffffff, 0.002);
  }

  apply(env: Env, renderer?: THREE.WebGLRenderer, internal = false) {
    if (!internal) {
      this.base = env;
      this.phase = Math.asin(THREE.MathUtils.clamp(env.sunElevation / 65, -1, 1)) / (Math.PI * 2);
      this.fx = { bloom: env.bloom ?? 0, saturation: env.saturation ?? 1, contrast: env.contrast ?? 1 };
    }
    const el = THREE.MathUtils.degToRad(env.sunElevation), az = THREE.MathUtils.degToRad(env.sunAzimuth);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    this.sun.color.set(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.sun.castShadow = env.shadows;
    this.hemi.intensity = env.ambient;
    this.hemi.color.set(env.skyHorizon).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.set(env.fogColor).multiplyScalar(0.45);
    const u = this.skyMat.uniforms;
    u.top.value.set(env.skyTop);
    u.horizon.value.set(env.skyHorizon);
    u.sunDir.value.copy(this.sunDir);
    u.sunColor.value.set(env.sunColor);
    u.sunPower.value = Math.min(1.2, env.sunIntensity / 2.5);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(env.fogColor);
    fog.density = env.fogDensity;
    if (renderer) {
      renderer.toneMappingExposure = env.exposure;
      renderer.shadowMap.enabled = env.shadows;
    }
    if (env.weather !== this.weather) this.setWeather(env.weather);
  }

  private setWeather(w: Env['weather']) {
    this.weather = w;
    for (const o of [this.rain, this.snow]) if (o) { this.scene.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    this.rain = this.snow = null;
    const rnd = (s: number) => (Math.random() - 0.5) * s;
    if (w === 'rain') {
      const n = 3500, p = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) { const x = rnd(50), y = Math.random() * 30, z = rnd(50); p.set([x, y, z, x + 0.03, y - 0.7, z], i * 6); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaec4d6, transparent: true, opacity: 0.45, fog: false }));
      this.rain.frustumCulled = false;
      this.scene.add(this.rain);
    } else if (w === 'snow') {
      const n = 5000, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) p.set([rnd(60), Math.random() * 30, rnd(60)], i * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, fog: false }));
      this.snow.frustumCulled = false;
      this.scene.add(this.snow);
    }
  }

  /** Advance the day/night cycle: the sun arcs over, then the scene fades to moonlight. */
  private tickDay(dt: number) {
    const b = this.base!;
    this.phase = (this.phase + dt / (b.dayLength! * 60)) % 1;
    const elev = Math.sin(this.phase * Math.PI * 2) * 65, day = THREE.MathUtils.smoothstep(elev, -8, 12);
    const mix = (hex: string, night: THREE.Color) => '#' + tmpC.set(hex).lerp(night, 1 - day).getHexString();
    this.apply({
      ...b, sunElevation: Math.max(Math.abs(elev), 4), sunAzimuth: b.sunAzimuth + (elev < 0 ? 180 : 0),
      sunIntensity: b.sunIntensity * day + 0.22 * (1 - day), sunColor: mix(b.sunColor, tmpC.clone().set('#9db4ff')),
      ambient: b.ambient * (0.25 + 0.75 * day), skyTop: mix(b.skyTop, NIGHT.top), skyHorizon: mix(b.skyHorizon, NIGHT.horizon), fogColor: mix(b.fogColor, NIGHT.fog),
    }, undefined, true);
  }

  /** Draw the frame, through the post-processing chain when bloom or colour grading is in use. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const f = this.fx;
    if (f.bloom < 0.01 && Math.abs(f.saturation - 1) < 0.01 && Math.abs(f.contrast - 1) < 0.01) return renderer.render(scene, camera);
    renderer.getDrawingBufferSize(size);
    if (!this.post || this.post.r !== renderer) {
      const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(renderer, target), pass = new RenderPass(scene, camera);
      const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.5, 0.85), grade = new ShaderPass(GRADE);
      composer.setPixelRatio(1);
      composer.addPass(pass); composer.addPass(bloom); composer.addPass(new OutputPass()); composer.addPass(grade);
      this.post = { r: renderer, composer, pass, bloom, grade, w: 0, h: 0 };
    }
    const P = this.post;
    if (P.w !== size.x || P.h !== size.y) { P.composer.setSize(size.x, size.y); P.w = size.x; P.h = size.y; }
    P.pass.scene = scene; P.pass.camera = camera;
    P.bloom.enabled = f.bloom >= 0.01; P.bloom.strength = f.bloom;
    P.grade.uniforms.saturation.value = f.saturation; P.grade.uniforms.contrast.value = f.contrast;
    renderer.info.autoReset = false; renderer.info.reset();
    P.composer.render();
    renderer.info.autoReset = true;
  }

  dispose() { this.post?.composer.dispose(); this.post = null; }

  update(dt: number, cam: THREE.Vector3) {
    if (this.dayCycle && this.base?.dayLength) this.tickDay(dt);
    this.sky.position.copy(cam);
    this.sun.target.position.copy(cam);
    this.sun.position.copy(cam).addScaledVector(this.sunDir, 250);
    if (this.rain) {
      const a = this.rain.geometry.attributes.position as THREE.BufferAttribute, p = a.array as Float32Array, d = 26 * dt;
      for (let i = 1; i < p.length; i += 6) { p[i] -= d; p[i + 3] -= d; if (p[i + 3] < 0) { p[i] += 30; p[i + 3] += 30; } }
      a.needsUpdate = true;
      this.rain.position.set(cam.x, cam.y - 12, cam.z);
    }
    if (this.snow) {
      const a = this.snow.geometry.attributes.position as THREE.BufferAttribute, p = a.array as Float32Array, t = performance.now() * 0.001;
      for (let i = 0; i < p.length; i += 3) { p[i + 1] -= 1.6 * dt; p[i] += Math.sin(t + i) * 0.25 * dt; if (p[i + 1] < 0) p[i + 1] += 30; }
      a.needsUpdate = true;
      this.snow.position.set(cam.x, cam.y - 12, cam.z);
    }
  }
}
