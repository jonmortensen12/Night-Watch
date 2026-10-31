/* Night Watch: Haunted House - the view.

   The bunker's renderer (yard.js) with the bunker taken away and a real room
   put round it. Two ways to see it:

   AR: the camera's picture fills the screen, and each portal is a hole cut
   through it into the graveyard outside. The holes are a stencil: the
   portals are drawn first, invisibly, marking their pixels; then everything
   out in the graveyard (sky, ground, gravestones, the monsters still
   outside) is drawn only where marked. Anything in the room - the planks
   nailed across the holes, a monster climbing through, sparks, smoke,
   tracers - is drawn everywhere. Because every portal is on the room's own
   edge, the graveyard can never show up in front of one.

   Full immersion: no camera; the room is drawn instead, a dark old parlour
   the shape of the markers' layout, with the same holes in it. The camera
   fades back in while you walk, so the real furniture is never a surprise.

   The room darkens wave by wave. When the witch comes she tears a hole in
   the ceiling, and that is where she is seen. */
import * as THREE from 'three';
import {Yard} from '../yard.js';
import {canvasTex, hot} from '../world.js';
import {sectionsOf} from '../zsim.js';

const STENCIL_REF = 1;
const _v = new THREE.Vector3();

/* Mark an object (and all it holds) as out in the graveyard: drawn only
   through a hole. */
function outside(obj, on){
  obj.traverse(o => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for(const m of ms){
      m.stencilWrite = on;
      m.stencilRef = STENCIL_REF;
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilZPass = m.stencilFail = m.stencilZFail = THREE.KeepStencilOp;
    }
  });
}
/* ...and the room itself (immersion): drawn everywhere except through a hole */
function roomMat(m){
  m.stencilWrite = true; m.stencilRef = STENCIL_REF; m.stencilFunc = THREE.NotEqualStencilFunc;
  m.stencilZPass = m.stencilFail = m.stencilZFail = THREE.KeepStencilOp;
  return m;
}
/* A hole: writes the mark, draws nothing. */
function holeMat(){
  return new THREE.MeshBasicMaterial({colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: STENCIL_REF, stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.ReplaceStencilOp});
}

/* Broken plaster round a hole: a ragged edge, lath showing, a purple glow. */
function rimTex(door){
  return canvasTex(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    const m = s * 0.12;
    const edge = (n, f) => { const pts = []; for(let i = 0; i <= n; i++) pts.push(f(i / n)); return pts; };
    const jag = () => (Math.random() - 0.5) * s * 0.05;
    // the outline of the hole, ragged
    const top = edge(14, t => [m + t * (s - 2 * m), m + jag()]);
    const right = edge(14, t => [s - m + jag(), m + t * (s - 2 * m)]);
    const bottom = door ? [[s - m, s], [m, s]] : edge(14, t => [s - m - t * (s - 2 * m), s - m + jag()]);
    const left = edge(14, t => [m + jag(), (door ? s : s - m) - t * ((door ? s : s - m) - m)]);
    const hole = top.concat(right, bottom, left);
    // a glow just inside the edge
    g.save();
    g.beginPath(); g.rect(0, 0, s, s); hole.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath();
    g.clip('evenodd');
    const gr = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.72);
    gr.addColorStop(0, 'rgba(60,40,30,0.95)'); gr.addColorStop(0.55, 'rgba(120,100,85,0.85)'); gr.addColorStop(1, 'rgba(120,100,85,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    // lath and cracks
    g.strokeStyle = 'rgba(70,45,25,0.9)'; g.lineWidth = 5;
    for(let i = 0; i < 7; i++){ const y = m * 0.4 + i * s / 7; g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + jag()); g.stroke(); }
    g.strokeStyle = 'rgba(20,10,5,0.8)'; g.lineWidth = 2;
    for(let i = 0; i < 16; i++){
      let p = hole[Math.floor(Math.random() * hole.length)].slice();
      g.beginPath(); g.moveTo(p[0], p[1]);
      for(let k = 0; k < 4; k++){ p = [p[0] + (p[0] - s / 2) * 0.12 + jag(), p[1] + (p[1] - s / 2) * 0.12 + jag()]; g.lineTo(p[0], p[1]); }
      g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(190,110,255,0.9)'; g.lineWidth = 4; g.shadowColor = '#b060ff'; g.shadowBlur = 14;
    g.beginPath(); hole.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if(!door) g.closePath(); g.stroke();
  });
}

function wallpaperTex(){
  const t = canvasTex(512, (g, s) => {
    g.fillStyle = '#2a1a26'; g.fillRect(0, 0, s, s);
    for(let y = 0; y < 8; y++) for(let x = 0; x < 8; x++){
      const cx = (x + (y % 2) * 0.5) * s / 8, cy = y * s / 8 + s / 16;
      g.fillStyle = 'rgba(120,70,100,0.35)';
      g.beginPath(); g.ellipse(cx, cy, s / 40, s / 22, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(160,110,60,0.25)';
      g.beginPath(); g.arc(cx, cy - s / 24, s / 90, 0, Math.PI * 2); g.fill();
    }
    for(let i = 0; i < 9; i++){ g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(i * s / 9, 0, 2, s); }
    for(let i = 0; i < 1500; i++){ g.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`; g.fillRect(Math.random() * s, Math.random() * s, 3, 3); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function boardsTex(){
  const t = canvasTex(512, (g, s) => {
    for(let i = 0; i < 8; i++){
      const sh = 50 + Math.random() * 30;
      g.fillStyle = `rgb(${sh},${sh * 0.66},${sh * 0.42})`; g.fillRect(0, i * s / 8, s, s / 8);
      g.fillStyle = '#140a04'; g.fillRect(0, i * s / 8, s, 3);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const BG_VERT = `varying vec2 vUv; uniform vec2 uScale, uOff;
void main(){ vUv = uOff + uv * uScale; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const BG_FRAG = `varying vec2 vUv; uniform sampler2D map; uniform float uDark, uAlpha; uniform vec3 uTint;
void main(){
  vec3 c = texture2D(map, vUv).rgb;
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  c = mix(c, vec3(l) * uTint, 0.35 + 0.4 * (1.0 - uDark)) * uDark;
  gl_FragColor = vec4(c, uAlpha);
}`;

export class Haunt extends Yard {
  /* opts: {layout, low, source (a video or canvas: the camera)} */
  constructor(canvas, opts){
    const sd = opts.layout ? sectionsOf(opts.layout) : [];
    super(canvas, Object.assign({mode: 'phone', stencil: true, noBloom: true, sd}, opts));
    this.view = 'ar';
    this.zoomK = 4;
    this.dark = 1; this.darkT = 1;
    this.ceilOpen = 0;
    this.walkFade = 0;
    // everything built so far is the graveyard: drawn only through a hole
    for(const o of this.scene.children){
      if(o === this.cam || o === this.house || o === this.parts.points || o.isLight) continue;
      if(this.beams.some(b => b.mesh === o) || this.smoke.indexOf(o) >= 0) continue;
      outside(o, true);
    }
    this.scene.fog.density = 0.022;
    // the gun in your hands is in your room, not out in the moonlight
    const hand = new THREE.PointLight(0xffe6c8, 1.6, 1.6, 2);
    hand.position.set(0.15, 0.05, 0);
    this.cam.add(hand);
    this.buildBackground();
    this.setSource(opts.source || null);
  }

  /* No fence, no posts: the house. */
  buildBunker(){
    const L = this.opts.layout || {portals: [], ceil: 2.4, markers: {}};
    this.L = L;
    const house = this.house = new THREE.Group();
    this.scene.add(house);
    this.lanterns = [];
    this.debris = [];
    // a little light of their own: against a camera picture, unlit planks are black holes
    const wood = new THREE.MeshStandardMaterial({map: boardsTex(), roughness: 0.85, color: 0xd8b090, emissive: 0x3a2412, emissiveIntensity: 0.6});
    this.wood = wood;
    const rimW = rimTex(false), rimD = rimTex(true);
    this.holes = [];
    this.sections = this.sd.map((S, i) => {
      const P = L.portals[i] || {kind: 'window'};
      const g = new THREE.Group();
      const dx = S.b[0] - S.a[0], dz = S.b[1] - S.a[1], len = Math.hypot(dx, dz) || 1;
      g.position.set(S.mid[0], 0, S.mid[1]);
      // local x along the opening, local z into the room
      g.rotation.y = Math.atan2(-S.n[0], -S.n[1]);
      // make sure local +x runs a -> b... it need not: the planks are symmetric
      house.add(g);
      const h = S.y1 - S.y0, cy = (S.y0 + S.y1) / 2;
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(len, h), holeMat());
      hole.position.set(0, cy, 0); hole.renderOrder = -50;
      g.add(hole);
      this.holes.push(hole);
      // the broken plaster round it
      const door = P.kind === 'door' || S.y0 < 0.05;
      const rim = new THREE.Mesh(new THREE.PlaneGeometry(len / 0.76, door ? h / 0.88 : h / 0.76),
        new THREE.MeshBasicMaterial({map: door ? rimD : rimW, transparent: true, depthWrite: false, color: 0xbbbbbb}));
      rim.position.set(0, door ? (S.y0 + h / 0.88 / 2) : cy, 0.015);
      g.add(rim);
      // planks: the lower two thirds, with gaps, so what is coming can be seen
      const top = S.y0 + h * 0.67, n = 4;
      const planks = [];
      for(let k = 0; k < n; k++){
        const y = S.y0 + 0.12 + (top - S.y0 - 0.12) * k / (n - 1);
        const p = new THREE.Mesh(new THREE.BoxGeometry(len + 0.2, 0.14, 0.04), wood);
        p.position.set((Math.random() - 0.5) * 0.06, y + (Math.random() - 0.5) * 0.03, 0.05);
        p.rotation.z = (Math.random() - 0.5) * 0.12;
        p.userData.home = p.position.clone();
        g.add(p); planks.push(p);
      }
      // the floor in front of it glows red when it is down
      const warn = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.0), new THREE.MeshBasicMaterial({map: this.T.glow, color: hot(0xff2020, 1.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0}));
      warn.rotation.x = -Math.PI / 2; warn.position.set(0, 0.02, 0.5);
      g.add(warn);
      const bar = this.makeBar();
      bar.sprite.scale.set(0.9, 0.17, 1);
      bar.sprite.position.set(S.mid[0] - S.n[0] * 0.12, S.y1 + 0.16, S.mid[1] - S.n[1] * 0.12);
      house.add(bar.sprite);
      // a cold light out beyond it, so what is coming is lit
      if(i < 6){
        const l = new THREE.PointLight(0x9a7aff, 6, 9, 1.6);
        l.position.set(S.mid[0] + S.n[0] * 1.6, cy + 0.4, S.mid[1] + S.n[1] * 1.6);
        house.add(l);
      }
      return {g, planks, warn, bar, shown: n, hp: 100, shake: 0};
    });
    // the ceiling, and the hole the witch makes in it
    const c = this.centre = this.sd.length ? [this.sd.reduce((a, s) => a + s.mid[0], 0) / this.sd.length, this.sd.reduce((a, s) => a + s.mid[1], 0) / this.sd.length] : [0, 0];
    const ceil = L.ceil || 2.4;
    const ch = this.ceilHole = new THREE.Mesh(new THREE.CircleGeometry(1.7, 24), holeMat());
    ch.rotation.x = Math.PI / 2; ch.position.set(c[0], ceil, c[1]); ch.renderOrder = -50; ch.visible = false;
    house.add(ch);
    const cr = this.ceilRim = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), new THREE.MeshBasicMaterial({map: canvasTex(256, (g, s) => {
      g.clearRect(0, 0, s, s);
      g.beginPath();
      for(let i = 0; i <= 30; i++){ const a = i / 30 * Math.PI * 2, r = s * (0.3 + Math.random() * 0.05); i ? g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r) : g.moveTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); }
      g.closePath();
      g.save(); g.rect(0, 0, s, s); g.clip('evenodd');
      const gr = g.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s * 0.5);
      gr.addColorStop(0, 'rgba(50,35,25,0.95)'); gr.addColorStop(1, 'rgba(50,35,25,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s); g.restore();
      g.strokeStyle = 'rgba(150,255,90,0.9)'; g.lineWidth = 4; g.shadowColor = '#9cff40'; g.shadowBlur = 16; g.stroke();
    }), transparent: true, depthWrite: false}));
    cr.rotation.x = Math.PI / 2; cr.position.set(c[0], ceil - 0.01, c[1]); cr.visible = false;
    house.add(cr);
    this.buildRoomBox(L);
  }

  /* Full immersion's room: a box round the layout, papered and boarded. */
  buildRoomBox(L){
    const xs = [], zs = [];
    for(const s of this.sd){ xs.push(s.a[0], s.b[0]); zs.push(s.a[1], s.b[1]); }
    for(const id in L.markers || {}){ xs.push(L.markers[id].p[0]); zs.push(L.markers[id].p[2]); }
    xs.push(-1.5, 1.5); zs.push(-1.5, 1.5);
    const x0 = Math.min(...xs) - 0.05, x1 = Math.max(...xs) + 0.05, z0 = Math.min(...zs) - 0.05, z1 = Math.max(...zs) + 0.05;
    const H = L.ceil || 2.4;
    const room = this.roomBox = new THREE.Group();
    room.visible = false;
    this.house.add(room);
    const paper = wallpaperTex();
    const wallM = roomMat(new THREE.MeshStandardMaterial({map: paper, roughness: 0.95, side: THREE.BackSide}));
    const box = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, H, z1 - z0), wallM);
    paper.repeat.set(3, 1.5);
    box.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
    room.add(box);
    const ft = boardsTex(); ft.repeat.set((x1 - x0) / 1.2, (z1 - z0) / 1.2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), roomMat(new THREE.MeshStandardMaterial({map: ft, roughness: 0.8})));
    floor.rotation.x = -Math.PI / 2; floor.position.set((x0 + x1) / 2, 0.005, (z0 + z1) / 2);
    room.add(floor);
    // a candle or two, and the dust
    const candle = new THREE.PointLight(0xffa860, 4, 7, 1.6);
    candle.position.set((x0 + x1) / 2, H - 0.4, (z0 + z1) / 2);
    room.add(candle);
    this.candle = candle;
  }

  /* The camera's picture, behind everything. */
  buildBackground(){
    const tex = this.bgTex = new THREE.Texture();
    const m = this.bgMat = new THREE.ShaderMaterial({vertexShader: BG_VERT, fragmentShader: BG_FRAG, depthTest: false, depthWrite: false, transparent: false,
      uniforms: {map: {value: tex}, uScale: {value: new THREE.Vector2(1, 1)}, uOff: {value: new THREE.Vector2(0, 0)},
        uDark: {value: 1}, uAlpha: {value: 1}, uTint: {value: new THREE.Color(0.75, 0.8, 1.15)}}});
    const bg = this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    bg.frustumCulled = false; bg.renderOrder = -100;
    this.scene.add(bg);
    // the same picture, over the top, for walking about in full immersion
    const m2 = this.fadeMat = m.clone();
    m2.uniforms = THREE.UniformsUtils.clone(m.uniforms);
    m2.uniforms.map.value = tex;
    m2.transparent = true;
    const fade = this.fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m2);
    fade.frustumCulled = false; fade.renderOrder = 1000; fade.visible = false;
    this.scene.add(fade);
  }

  /* A new room plan (set up again in the lobby). */
  setLayout(L){
    this.scene.remove(this.house);
    this.opts.layout = L;
    this.sd = sectionsOf(L);
    this.secs = this.sd.map(() => 100);
    this.secHit = this.sd.map(() => 0);
    for(const [id, e] of this.mons) this.remove(id, e);
    this.buildBunker();
    this.setView3(this.view);
  }
  showHouse(on){ this.house.visible = on; }

  setSource(src){
    this.src = src;
    if(!src) return;
    const t = src.tagName === 'VIDEO' ? new THREE.VideoTexture(src) : new THREE.CanvasTexture(src);
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    this.bgTex = t;
    this.bgMat.uniforms.map.value = t;
    this.fadeMat.uniforms.map.value = t;
  }
  /* The camera's focal length in its own pixels: the 3D view matches it. */
  setFocal(f, w, h){ this.camF = f; this.camW = w; this.camH = h; this.applyFov(); }

  setView3(view){
    this.view = view;
    this.bg.visible = view === 'ar';
    this.roomBox.visible = view === 'vr';
    for(const a of this.avatars.values()) a.mesh.visible = view === 'vr';
    this.applyFov();
  }

  applyFov(){
    const W = this.w || innerWidth, H = this.h || innerHeight;
    if(this.view === 'ar' && this.camF && this.camW){
      // the picture covers the screen; the 3D sees exactly what it shows
      const k = this.zoom ? this.zoomK : 1;
      const s = Math.max(W / this.camW, H / this.camH) * k;
      const vis = [W / s / this.camW, H / s / this.camH];
      for(const m of [this.bgMat, this.fadeMat]){
        m.uniforms.uScale.value.set(vis[0], vis[1]);
        m.uniforms.uOff.value.set((1 - vis[0]) / 2, (1 - vis[1]) / 2);
      }
      this.cam.fov = 2 * Math.atan(H / s / 2 / this.camF) * 180 / Math.PI;
      this.cam.updateProjectionMatrix();
      if(this.parts && this.parts.mat) this.parts.mat.uniforms.uScale.value = H * this.dpr / (2 * Math.tan(this.cam.fov * Math.PI / 360));
      if(this.mist) this.mist.material.uniforms.uScale.value = H * this.dpr / (2 * Math.tan(this.cam.fov * Math.PI / 360));
      return;
    }
    if(this.camF && this.camW){
      // immersion: the same view, so walking feels the same
      const s = Math.max(W / this.camW, H / this.camH);
      this.baseFov = 2 * Math.atan(H / s / 2 / this.camF) * 180 / Math.PI;
      for(const m of [this.bgMat, this.fadeMat]){
        const vis = [W / s / this.camW, H / s / this.camH];
        m.uniforms.uScale.value.set(vis[0], vis[1]);
        m.uniforms.uOff.value.set((1 - vis[0]) / 2, (1 - vis[1]) / 2);
      }
    }
    super.applyFov();
  }

  /* How the room feels: darker each wave; the ceiling torn open for the witch. */
  setMood(wave, boss){
    this.darkT = Math.max(0.42, 1 - Math.max(0, wave - 1) * 0.07);
    this.ceilWant = boss ? 1 : 0;
  }
  /* Walking, in full immersion: the camera comes up so nobody trips. */
  setWalking(k){ this.walkFade = k; }

  dropPlank(p, S){
    // into the room: it was knocked in from outside
    super.dropPlank(p, {n: [-S.n[0], -S.n[1]]});
  }

  draw(dt){
    // the graveyard's monsters are outside until they are through
    for(const e of this.mons.values()){
      const S = this.sd[e.sec] || this.sd[0];
      let out = true;
      if(S && e.type !== 'witch' && e.type !== 'bomb'){
        const inn = -((e.d.x - S.mid[0]) * S.n[0] + (e.d.z - S.mid[1]) * S.n[1]);
        out = inn < -0.2 && e.st !== 2;
      }
      if(e.out !== out){ e.out = out; outside(e.mesh, out); }
    }
    this.dark += (this.darkT - this.dark) * Math.min(1, dt * 0.5);
    for(const m of [this.bgMat, this.fadeMat]) m.uniforms.uDark.value = this.dark;
    this.scene.fog.color.setRGB(0.086 * this.dark, 0.078 * this.dark, 0.15 * this.dark);
    // the ceiling: torn open with a crash, closed again when she is gone
    const was = this.ceilOpen;
    this.ceilOpen += ((this.ceilWant || 0) - this.ceilOpen) * Math.min(1, dt * 2);
    const k = this.ceilOpen;
    this.ceilHole.visible = this.ceilRim.visible = k > 0.02;
    this.ceilHole.scale.setScalar(Math.max(0.01, k));
    this.ceilRim.scale.setScalar(Math.max(0.01, k));
    if(was < 0.05 && k >= 0.05){
      const c = this.ceilHole.position;
      for(let i = 0; i < 40; i++) this.parts.emit(c.x + (Math.random() - 0.5) * 2, c.y - 0.1, c.z + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2, -Math.random() * 2, (Math.random() - 0.5) * 2, 0.9, 0.8, 0.7, 0.08, 1.4, 1, 0);
      this.puff(_v.set(c.x, c.y - 0.3, c.z), 6, new THREE.Color(0.5, 0.45, 0.4), 1.6, 1.6);
    }
    for(const a of this.avatars.values()) a.mesh.visible = this.view === 'vr';
    if(this.candle) this.candle.intensity = 4 * (0.85 + 0.15 * Math.sin(this.time * 11) * Math.sin(this.time * 7.3));
    // full immersion: the camera, fading in while walking
    const showFade = this.view === 'vr' && this.walkFade > 0.02 && this.src;
    this.fade.visible = !!showFade;
    if(showFade) this.fadeMat.uniforms.uAlpha.value = Math.min(0.85, this.walkFade);
    if(this.bgTex && this.bgTex.isCanvasTexture && this.src) this.bgTex.needsUpdate = true;
    this.renderer.render(this.scene, this.cam);
  }

  /* Where on screen a marker is drawn, for the survey's boxes. */
  project3(p){ return this.project(_v.set(p[0], p[1], p[2])); }
}
