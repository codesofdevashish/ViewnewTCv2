/* Realistic 3D Earth for the cyclone site (three.js r149, no build step).
   NASA Blue Marble by day, Black Marble city lights by night, blended along the real terminator,
   with ocean sun glint, atmosphere, stars, glowing storm tracks and spinning storm symbols.
   Earth.create(canvas, {labels, onSelect}) -> api | null (null when WebGL is unavailable). */
(() => {
  "use strict";
  const D = Math.PI / 180;

  function webglOK() {
    try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; }
  }
  // geographic -> local xyz (same convention as three-globe; the textured mesh is turned by -90°)
  function ll2v(lat, lon, r = 1) {
    const phi = (90 - lat) * D, th = (90 - lon) * D;
    return new THREE.Vector3(r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
  }
  function subsolar(ms) {
    const d = new Date(ms), start = Date.UTC(d.getUTCFullYear(), 0, 1);
    const doy = Math.floor((ms - start) / 864e5) + 1, hr = d.getUTCHours() + d.getUTCMinutes() / 60;
    const g = 2 * Math.PI / 365 * (doy - 1 + (hr - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    return [dec / D, -15 * (hr - 12 + eqt / 60)];
  }
  function symbolTexture(color) {
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, color); grd.addColorStop(0.35, color + "aa"); grd.addColorStop(1, color + "00");
    g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#ffffff"; g.lineWidth = 15; g.lineCap = "round";
    g.beginPath(); g.moveTo(128, 104); g.bezierCurveTo(165, 92, 190, 118, 196, 158); g.stroke();
    g.beginPath(); g.moveTo(128, 152); g.bezierCurveTo(91, 164, 66, 138, 60, 98); g.stroke();
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(128, 128, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(128, 128, 11, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  const VERT = `varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`;
  const FRAG = `uniform sampler2D dayT; uniform sampler2D nightT; uniform sampler2D waterT; uniform vec3 sun; uniform float ready;
    varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main(){
      vec3 n = normalize(vN), s = normalize(sun), v = normalize(cameraPosition - vP);
      float d = dot(n, s);
      float day = smoothstep(-0.10, 0.22, d);
      vec3 dc = texture2D(dayT, vUv).rgb, nc = texture2D(nightT, vUv).rgb;
      float w = texture2D(waterT, vUv).r;
      vec3 lit = dc * (0.30 + 0.95 * pow(max(d, 0.0), 0.6));
      vec3 lights = nc * vec3(1.0, 0.82, 0.55) * 1.7 * (1.0 - day);
      vec3 moon = dc * vec3(0.15, 0.19, 0.28) + vec3(0.006, 0.012, 0.024);   // faint moonlit night
      vec3 col = mix(moon + lights, lit, day);
      vec3 h = normalize(s + v); col += vec3(1.0, 0.92, 0.8) * pow(max(dot(n, h), 0.0), 70.0) * w * 0.65 * day;
      float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0); col += vec3(0.30, 0.58, 1.0) * rim * (0.18 + 0.55 * day);
      float twi = smoothstep(-0.25, 0.0, d) * (1.0 - smoothstep(0.0, 0.3, d)); col += vec3(0.85, 0.42, 0.20) * twi * 0.035;
      gl_FragColor = vec4(mix(vec3(0.03, 0.06, 0.11), col, ready), 1.0);
    }`;
  const ATMO_V = `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
  const ATMO_F = `varying vec3 vN; void main(){ float i = pow(max(0.0, 0.62 - dot(vN, vec3(0.0,0.0,1.0))), 2.6); gl_FragColor = vec4(0.30, 0.58, 1.0, 1.0) * i * 0.9; }`;

  function create(canvas, opts = {}) {
    if (!window.THREE || !webglOK()) return null;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    let baseDist = 4.3, zf = 1, dist = 4.3; camera.position.set(0, 0, dist);
    const globe = new THREE.Group(); globe.rotation.order = "XYZ"; scene.add(globe);

    // stars
    const sg = new THREE.BufferGeometry(), sp = [];
    for (let i = 0; i < 2600; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 40); sp.push(v.x, v.y, v.z); }
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.75 })));

    // earth
    const loader = new THREE.TextureLoader(), base = opts.base || "vendor/earth/";
    const blank = new THREE.DataTexture(new Uint8Array([8, 16, 28, 255]), 1, 1); blank.needsUpdate = true;
    const uni = { dayT: { value: blank }, nightT: { value: blank }, waterT: { value: blank }, sun: { value: new THREE.Vector3(1, 0, 0) }, ready: { value: 0 } };
    let loaded = 0; const done = () => { if (++loaded === 3) fadeIn = performance.now(); };
    for (const [k, f] of [["dayT", "day.jpg"], ["nightT", "night.jpg"], ["waterT", "water.jpg"]])
      loader.load(base + f, (t) => { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); uni[k].value = t; /* used as stored: sRGB in, sRGB out */ done(); }, undefined, done);
    let fadeIn = 0;
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.ShaderMaterial({ uniforms: uni, vertexShader: VERT, fragmentShader: FRAG }));
    earth.rotation.y = -Math.PI / 2; globe.add(earth);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.09, 96, 64), new THREE.ShaderMaterial({ vertexShader: ATMO_V, fragmentShader: ATMO_F,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    scene.add(atmo);

    // storms
    const stormLayer = new THREE.Group(); globe.add(stormLayer);
    let storms = [], selKey = null, sprites = [];
    const texCache = new Map(), tex = (c) => texCache.get(c) || (texCache.set(c, symbolTexture(c)), texCache.get(c));
    const labelsBox = opts.labels || null;
    function clearLayer() {
      for (const o of stormLayer.children.slice()) { stormLayer.remove(o); o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); }
      if (labelsBox) labelsBox.textContent = "";
      sprites = [];
    }
    function trackMesh(pts, sel) {
      const P = [];
      for (let i = 0; i < pts.length; i++) {
        const a = ll2v(pts[i].lat, pts[i].lon, 1.006);
        if (i === 0) { P.push([a, pts[i].color]); continue; }
        const b0 = P[P.length - 1][0].clone().normalize(), b1 = a.clone().normalize();
        for (let k = 1; k <= 6; k++) P.push([b0.clone().lerp(b1, k / 6).normalize().multiplyScalar(1.006), pts[i].color]);
      }
      if (P.length < 2) return [];
      const curve = new THREE.CatmullRomCurve3(P.map((p) => p[0]));
      const out = [];
      for (const [r, op] of sel ? [[0.0055, 1], [0.016, 0.22]] : [[0.0032, 0.75], [0.010, 0.12]]) {
        const geo = new THREE.TubeGeometry(curve, P.length * 2, r, 8, false);
        const cols = [], rs = 9, rings = P.length * 2 + 1;
        for (let i = 0; i < rings; i++) { const c = new THREE.Color(P[Math.min(P.length - 1, Math.round(i / (rings - 1) * (P.length - 1)))][1]);
          for (let j = 0; j < rs; j++) cols.push(c.r, c.g, c.b); }
        geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
        out.push(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: op,
          blending: op < 0.5 ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: op >= 0.5 })));
      }
      return out;
    }
    function setStorms(list, key) {
      storms = list; selKey = key; clearLayer();
      for (const s of storms) {
        if (!s.pts.length) continue;
        const sel = s.key === selKey;
        for (const m of trackMesh(s.pts, sel)) stormLayer.add(m);
        const last = s.pts[s.pts.length - 1];
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(s.color), transparent: true, depthWrite: false }));
        spr.position.copy(ll2v(last.lat, last.lon, 1.02)); const sc = sel ? 0.15 : 0.11; spr.scale.set(sc, sc, 1);
        spr.userData = { key: s.key, south: s.south }; stormLayer.add(spr); sprites.push(spr);
        if (labelsBox) {
          const lab = document.createElement("button"); lab.type = "button"; lab.className = `e-label${sel ? " sel" : ""}`;
          lab.innerHTML = `<b></b><span></span>`; lab.querySelector("b").textContent = s.name; lab.querySelector("span").textContent = `${s.kt} kt`;
          lab.style.setProperty("--c", s.color); lab.addEventListener("click", () => opts.onSelect && opts.onSelect(s.key));
          labelsBox.append(lab); spr.userData.label = lab;
        }
      }
    }

    // sun
    let sunMs = Date.now();
    const sunLocal = () => { const [la, lo] = subsolar(sunMs); return ll2v(la, lo, 1).normalize(); };
    function setSun(ms) { sunMs = ms; }
    setInterval(() => { if (!opts.followTime) sunMs = Date.now(); }, 60000);

    // interaction: drag to turn, ctrl/cmd + wheel or buttons to zoom, click a storm to open it
    let auto = !matchMedia("(prefers-reduced-motion: reduce)").matches, lastUser = 0, drag = null, tween = null;
    canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }; canvas.setPointerCapture(e.pointerId); auto = false; tween = null; });
    canvas.addEventListener("pointermove", (e) => {
      if (drag) { const k = 0.0042 * zf; globe.rotation.y += (e.clientX - drag.x) * k; globe.rotation.x = Math.max(-1.25, Math.min(1.25, globe.rotation.x + (e.clientY - drag.y) * k)); drag.x = e.clientX; drag.y = e.clientY; }
      else canvas.style.cursor = pick(e) ? "pointer" : "grab";
    });
    canvas.addEventListener("pointerup", (e) => {
      if (drag && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) { const s = pick(e); if (s && opts.onSelect) opts.onSelect(s.userData.key); }
      drag = null; lastUser = performance.now();
    });
    canvas.addEventListener("wheel", (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08); }, { passive: false });
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function pick(e) {
      const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(sprites, false)[0]; if (!hit) return null;
      const w = hit.object.getWorldPosition(new THREE.Vector3()); return w.dot(camera.position) > 0.2 ? hit.object : null;
    }
    function zoom(f) { zf = Math.max(0.42, Math.min(1.5, zf * f)); dist = baseDist * zf; lastUser = performance.now(); }
    function focus(lat, lon, ms = 1400) {
      const p = ll2v(lat, lon, 1), yaw = Math.atan2(p.x, p.z), pitch = Math.atan2(p.y, Math.hypot(p.x, p.z));
      let ty = -yaw, tx = Math.max(-1.1, Math.min(1.1, pitch));
      const y0 = globe.rotation.y, x0 = globe.rotation.x; let dy = ty - y0; dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      tween = { t0: performance.now(), ms, y0, x0, dy, dx: tx - x0 }; auto = false; lastUser = performance.now();
    }

    // render loop (paused when off screen)
    let visible = true;
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(canvas);
    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      const hfov = 2 * Math.atan(Math.tan(camera.fov * D / 2) * camera.aspect);            // fit the globe to the narrower side
      baseDist = Math.max(4.3, 1.22 / Math.tan(hfov / 2)); dist = baseDist * zf;
    }
    new ResizeObserver(resize).observe(canvas); resize();
    const tmp = new THREE.Vector3();
    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible) return;
      if (tween) { const a = Math.min(1, (now - tween.t0) / tween.ms), e = a < .5 ? 4 * a * a * a : 1 - Math.pow(-2 * a + 2, 3) / 2;
        globe.rotation.y = tween.y0 + tween.dy * e; globe.rotation.x = tween.x0 + tween.dx * e; if (a >= 1) tween = null; }
      else if (!drag && !auto && lastUser && now - lastUser > 15000 && !matchMedia("(prefers-reduced-motion: reduce)").matches) auto = true;
      if (auto && !drag && !tween) globe.rotation.y += 0.0007;
      camera.position.z += (dist - camera.position.z) * 0.12;
      uni.sun.value.copy(sunLocal()).applyQuaternion(globe.quaternion);
      if (fadeIn) uni.ready.value = Math.min(1, (now - fadeIn) / 900);
      for (const s of sprites) {
        s.material.rotation += (s.userData.south ? -1 : 1) * 0.035;
        const lab = s.userData.label; if (!lab) continue;
        s.getWorldPosition(tmp); const facing = tmp.clone().normalize().dot(camera.position.clone().normalize());
        tmp.project(camera);
        if (facing < 0.25) { lab.style.opacity = "0"; lab.style.pointerEvents = "none"; continue; }
        lab.style.opacity = String(Math.min(1, (facing - 0.25) * 4)); lab.style.pointerEvents = "auto";
        const px = (tmp.x * .5 + .5) * canvas.clientWidth, py = (-tmp.y * .5 + .5) * canvas.clientHeight;
        const lw = lab.offsetWidth || 110, left = px + 14 + lw > canvas.clientWidth - 6;          // flip labels near the right edge
        lab.style.transform = `translate(${left ? px - 14 - lw : px + 14}px, ${py - 14}px)`;
      }
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
    return { setStorms, focus, setSun, zoomIn: () => zoom(1 / 1.25), zoomOut: () => zoom(1.25) };
  }
  window.Earth = { create };
})();
