/* Tropical cyclones in 3D — front end. No build step; needs d3 + topojson-client (vendored). */
(() => {
  "use strict";
  const banner = document.getElementById("banner");
  const fail = (msg) => { if (banner) { banner.hidden = false; banner.textContent = msg; } };
  window.addEventListener("error", (e) => fail(`Something went wrong while drawing the page (${e.message}). Reloading usually fixes it.`));
  if (!window.d3 || !window.topojson) { fail("The map library did not load. Please reload the page."); return; }

  const CONF = window.SITE || {};
  const $ = (s, r = document) => r.querySelector(s);
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of [].concat(kids)) if (k !== null && k !== undefined) n.append(k);
    return n;
  };
  const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const set = (sel, txt) => { const n = $(sel); if (n) n.textContent = txt; };

  // ------------------------------------------------------------------ formatting
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const toMs = (s) => { if (!s) return NaN; let t = String(s).replace(" ", "T"); if (!/Z|[+-]\d\d:?\d\d$/.test(t)) t += "Z"; return Date.parse(t); };
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (ms, withUtc = true) => { const d = new Date(ms); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${withUtc ? " UTC" : ""}`; };
  const ll = (lat, lon) => { const lo = ((lon + 540) % 360) - 180; return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lo).toFixed(1)}°${lo >= 0 ? "E" : "W"}`; };
  const CATV = (kt) => kt >= 137 ? "--c5" : kt >= 113 ? "--c4" : kt >= 96 ? "--c3" : kt >= 83 ? "--c2" : kt >= 64 ? "--c1" : kt >= 34 ? "--ts" : "--td";
  const catName = (kt) => kt >= 137 ? "Category 5" : kt >= 113 ? "Category 4" : kt >= 96 ? "Category 3" : kt >= 83 ? "Category 2" : kt >= 64 ? "Category 1" : kt >= 34 ? "Tropical storm" : "Depression";
  const col = (kt) => getComputedStyle(document.documentElement).getPropertyValue(CATV(kt)).trim() || "#888";
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ sun (for night shading)
  function subsolar(ms) {
    const d = new Date(ms), start = Date.UTC(d.getUTCFullYear(), 0, 1);
    const doy = Math.floor((ms - start) / 864e5) + 1, hr = d.getUTCHours() + d.getUTCMinutes() / 60;
    const g = 2 * Math.PI / 365 * (doy - 1 + (hr - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    return [-15 * (hr - 12 + eqt / 60), dec * 180 / Math.PI];
  }
  const nightCircle = (ms, r = 90) => { const [lo, la] = subsolar(ms); return d3.geoCircle().center([lo + 180, -la]).radius(r)(); };
  const NIGHT_R = [96, 93, 90, 84];                 // twilight to night: stacked translucent caps
  const drawNight = (g, path, ms) => { g.selectAll("path").data(NIGHT_R).join("path").attr("class", "g-night").attr("d", (r) => path(nightCircle(ms, r))); };

  // ------------------------------------------------------------------ storm preparation
  function prep(s) {
    let prev = null;
    s._pts = (s.track || []).map(([t, lat, lon, kt]) => {
      let lo = lon; if (prev !== null) { while (lo - prev > 180) lo -= 360; while (lo - prev < -180) lo += 360; }
      prev = lo; return { t: toMs(t), lat, lon: lo, kt };
    }).filter((p) => !isNaN(p.t));
    s._ace = s._pts.filter((p) => p.kt >= 34 && new Date(p.t).getUTCHours() % 6 === 0).reduce((a, p) => a + p.kt * p.kt, 0) / 1e4;
    s._ws = toMs(s.window_start); s._we = toMs(s.window_end);
    s._fps = s.video_fps || 15.1515; s._fph = s.video_fph || 1;
    const P = s._pts, w = [];
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const dh = (P[j].t - P[i].t) / 36e5; if (dh > 27) break;
      if (Math.abs(dh - 24) <= 3 && P[j].kt - P[i].kt >= 30) w.push([P[i].t, P[j].t]);
    }
    w.sort((a, b) => a[0] - b[0]);
    s._ri = w.reduce((acc, x) => { const l = acc[acc.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else acc.push([...x]); return acc; }, []);
    s._south = P.length ? P[P.length - 1].lat < 0 : false;
    return s;
  }
  function at(s, t) {
    const P = s._pts; if (!P.length) return null;
    if (t <= P[0].t) return P[0]; if (t >= P[P.length - 1].t) return P[P.length - 1];
    for (let i = 1; i < P.length; i++) if (P[i].t >= t) {
      const a = (t - P[i - 1].t) / (P[i].t - P[i - 1].t), A = P[i - 1], B = P[i];
      return { t, lat: A.lat + a * (B.lat - A.lat), lon: A.lon + a * (B.lon - A.lon), kt: A.kt + a * (B.kt - A.kt) };
    }
    return P[P.length - 1];
  }
  const frames = (s) => Math.round((s._we - s._ws) / 36e5 * s._fph) + 1;
  const vTime = (s, v) => isNaN(s._ws) ? NaN : s._ws + Math.min(v.currentTime * s._fps, frames(s) - 1) / s._fph * 36e5;
  const vFrame = (s, v) => isNaN(s._ws) ? NaN : s._ws + Math.min(Math.floor(v.currentTime * s._fps + 1e-6), frames(s) - 1) / s._fph * 36e5;
  const seek = (s, v, t) => { if (isNaN(s._ws)) return; const c = Math.min(Math.max(t, s._ws), s._we); v.currentTime = (c - s._ws) / 36e5 * s._fph / s._fps + 1e-3; };
  const symbolSVG = (south, r = 11, color = "currentColor") =>
    `<g class="spin${south ? " south" : ""}"><g transform="scale(${south ? -1 : 1},1)">` +
    `<path d="M0,${-r * .42} C${r * .55},${-r * .55} ${r * .85},${-r * .2} ${r * .92},${r * .36}" fill="none" stroke="${color}" stroke-width="${r * .28}" stroke-linecap="round"/>` +
    `<path d="M0,${r * .42} C${-r * .55},${r * .55} ${-r * .85},${r * .2} ${-r * .92},${-r * .36}" fill="none" stroke="${color}" stroke-width="${r * .28}" stroke-linecap="round"/></g>` +
    `<circle r="${r * .42}" fill="var(--panel)" stroke="${color}" stroke-width="${r * .18}"/></g>`;

  // ------------------------------------------------------------------ state
  let DATA = null, ALL = [], ACTIVE = [], ARCH = [], SEL = null, LAND110 = null, LAND50 = null;
  const video = $("#v-video");

  // ------------------------------------------------------------------ theme (light unless chosen)
  // cinematic: dark theme only
  document.documentElement.dataset.theme = "dark";

  // ------------------------------------------------------------------ profile
  set("#brand-name", CONF.name || "Tropical cyclones");
  if (CONF.name) $("#brand-name").after(el("span", { class: "brand-sub", text: "Tropical cyclones" }));
  set("#about-name", CONF.name || "");
  set("#about-role", [CONF.role, CONF.affiliation].filter(Boolean).join(", "));
  set("#about-summary", CONF.summary || "");
  for (const i of CONF.interests || []) $("#about-interests").append(el("li", { text: i }));
  for (const m of CONF.memberships || []) $("#about-members").append(el("li", { text: m }));
  for (const k of CONF.skills || [
    "Automatic global storm detection from operational TCVitals, every day",
    "Processing of NCEP GFS 0.25° analyses (GRIB2) in every basin, including dateline and Southern Hemisphere storms",
    "3D visualisation of tropical cyclone flow, vortex core and convection",
    "Structure diagnostics: vortex tilt, 850–500 hPa shear and radius of maximum wind",
    "Rapid intensification detection from official intensities",
    "A fully automated pipeline on GitHub Actions and GitHub Pages",
  ]) $("#about-skills").append(el("li", { text: k }));
  const Lk = CONF.links || {};
  for (const [k, label, f] of [["email", "Email", (v) => `mailto:${v}`], ["scholar", "Google Scholar"], ["github", "GitHub"], ["linkedin", "LinkedIn"], ["cv", "CV (PDF)"]])
    if (Lk[k]) $("#about-links").append(el("a", { href: f ? f(Lk[k]) : Lk[k], text: label, rel: "noopener" }));

  // ================================================================== GLOBE
  const G = { svg: d3.select("#globe").attr("viewBox", "0 0 600 600"), rot: [-80, -12], auto: !reduced, userAt: 0 };
  G.proj = d3.geoOrthographic().translate([300, 300]).scale(286).clipAngle(90).precision(0.5);
  G.path = d3.geoPath(G.proj);
  G.ocean = G.svg.append("path").attr("class", "g-ocean").datum({ type: "Sphere" });
  G.grat = G.svg.append("path").attr("class", "g-grat").datum(d3.geoGraticule10());
  G.land = G.svg.append("path").attr("class", "g-land");
  G.night = G.svg.append("g");
  G.tracks = G.svg.append("g");
  G.storms = G.svg.append("g");
  G.rim = G.svg.append("path").attr("class", "g-rim").datum({ type: "Sphere" });
  const EARTH = window.Earth ? window.Earth.create($("#earth-canvas"), {
    labels: $("#earth-labels"), onSelect: (k) => { const s = ALL.find((x) => x.key === k); if (s) select(s, { scroll: true }); } }) : null;
  if (!EARTH) { $("#globe").hidden = false; $("#earth-canvas").hidden = true; }
  $("#e-in").addEventListener("click", () => EARTH ? EARTH.zoomIn() : null);
  $("#e-out").addEventListener("click", () => EARTH ? EARTH.zoomOut() : null);
  if (!EARTH) { $("#e-in").hidden = true; $("#e-out").hidden = true; }
  function drawGlobe() {
    if (EARTH) {
      EARTH.setStorms(ACTIVE.map((s) => ({ key: s.key, name: s.name, kt: s.vmax_kt, south: s._south, color: col(s.vmax_kt),
        pts: s._pts.map((p) => ({ lat: p.lat, lon: p.lon, color: col(p.kt) })) })), SEL && SEL.key);
      return;
    }
    G.proj.rotate(G.rot);
    G.ocean.attr("d", G.path); G.grat.attr("d", G.path); G.rim.attr("d", G.path);
    if (LAND110) G.land.attr("d", G.path(LAND110));
    drawNight(G.night, G.path, Date.now());
    const centre = [-G.rot[0], -G.rot[1]];
    G.tracks.selectAll("*").remove(); G.storms.selectAll("*").remove();
    for (const s of ACTIVE) {
      const P = s._pts;
      for (let i = 1; i < P.length; i++)
        G.tracks.append("path").attr("d", G.path({ type: "LineString", coordinates: [[P[i - 1].lon, P[i - 1].lat], [P[i].lon, P[i].lat]] }))
          .attr("fill", "none").attr("stroke", col(P[i].kt)).attr("stroke-width", s === SEL ? 4 : 3).attr("stroke-linecap", "round");
      const last = P[P.length - 1]; if (!last) continue;
      if (d3.geoDistance([last.lon, last.lat], centre) > Math.PI / 2 - 0.05) continue;
      const [x, y] = G.proj([last.lon, last.lat]);
      const g = G.storms.append("g").attr("class", "g-storm").attr("transform", `translate(${x},${y})`).attr("tabindex", 0)
        .attr("role", "button").attr("aria-label", `${s.name}, ${s.vmax_kt} knots`).style("color", "var(--ink)");
      g.append("circle").attr("r", 19).attr("fill", col(s.vmax_kt)).attr("opacity", .35);
      g.html(g.html() + symbolSVG(s._south, 13));
      g.append("text").attr("class", "g-label").attr("x", 20).attr("y", 5).text(`${s.name} ${s.vmax_kt} kt`);
      g.on("click", () => select(s, { scroll: true })).on("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(s, { scroll: true }); } });
    }
  }
  G.svg.call(d3.drag().on("start", () => { G.auto = false; }).on("drag", (e) => {
    const k = 0.35; G.rot = [G.rot[0] + e.dx * k, Math.max(-75, Math.min(75, G.rot[1] - e.dy * k))]; drawGlobe();
  }).on("end", () => { G.userAt = performance.now(); }));
  function turnGlobeTo(lon, lat, ms = 900) {
    if (EARTH) { EARTH.focus(lat, lon, 1400); return; }
    const from = G.rot.slice(), to = [-lon, Math.max(-60, Math.min(60, -lat))];
    let dl = to[0] - from[0]; while (dl > 180) dl -= 360; while (dl < -180) dl += 360; to[0] = from[0] + dl;
    const it = d3.interpolate(from, to); G.auto = false; G.userAt = performance.now();
    if (reduced) { G.rot = to; drawGlobe(); return; }
    d3.transition().duration(ms).tween("rot", () => (t) => { G.rot = it(t); drawGlobe(); });
  }
  (function spinLoop() {
    if (EARTH) return;
    if (!reduced) {
      if (!G.auto && G.userAt && performance.now() - G.userAt > 12000) G.auto = true;
      if (G.auto && document.visibilityState === "visible") { G.rot = [G.rot[0] + 0.06, G.rot[1]]; drawGlobe(); }
    }
    requestAnimationFrame(spinLoop);
  })();
  if (!EARTH) setInterval(() => drawNight(G.night, G.path, Date.now()), 60000);

  // ================================================================== HERO list + stats
  function drawHero() {
    const n = ACTIVE.length, W = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
    set("#headline", n === 0 ? "No tropical cyclones are active right now" : `${W[n] || n} tropical cyclone${n > 1 ? "s are" : " is"} active right now`);
    const ends = ACTIVE.map((s) => s._we).filter((x) => !isNaN(x));
    set("#status", ends.length ? `Videos run to the GFS analysis of ${fmt(Math.max(...ends))}. Positions and intensities are the latest official advisories.`
      : ARCH.length ? "Nothing is active today, so the viewer shows the most recent storm from the archive." : "The page updates every morning.");
    const st = $("#stats"); st.textContent = "";
    const top = ACTIVE.length ? ACTIVE.reduce((a, b) => (b.vmax_kt > a.vmax_kt ? b : a)) : null;
    for (const [k, v] of [["Active storms", n], ["Strongest now", top ? `${top.name}, ${top.vmax_kt} kt` : "—"],
      ["ACE of active storms", ACTIVE.reduce((a, s) => a + s._ace, 0).toFixed(1)], ["Basins", new Set(ACTIVE.map((s) => s.basin_name)).size]])
      st.append(el("div", {}, [el("dt", { text: k }), el("dd", { text: String(v), title: String(v) })]));
    const ol = $("#storm-list"); ol.textContent = "";
    for (const s of ACTIVE) {
      const trend = s.dv24 >= 10 ? `▲ ${s.dv24} kt in 24 h` : s.dv24 <= -10 ? `▼ ${-s.dv24} kt in 24 h` : "steady";
      const b = el("button", { type: "button", class: "scard", "data-key": s.key, style: `--c:var(${CATV(s.vmax_kt)})`, "aria-current": String(s === SEL) }, [
        el("strong", { text: s.name }), el("span", { class: "kt" }, [`${s.vmax_kt}`, el("small", { text: "kt" })]),
        el("span", { class: "meta", text: `${s.label}, ${s.basin_name} · ${trend}${s.ri ? " · RI" : ""}` }),
      ]);
      b.addEventListener("click", () => select(s, { scroll: true }));
      ol.append(el("li", {}, [b]));
    }
    set("#generated", DATA.generated ? `Site rebuilt ${fmt(toMs(DATA.generated))}.` : "");
    const basins = new Set(ALL.map((s) => s.basin_name));
    if (ALL.length) set("#site-stats", `This site holds videos of ${ALL.length} storm${ALL.length > 1 ? "s" : ""} from ${basins.size} basin${basins.size > 1 ? "s" : ""}.`);
  }

  // ================================================================== OPENING (full-screen video)
  function setupOpening() {
    const hero = DATA && DATA.hero;
    const top = (hero && ALL.find((x) => x.key === hero.key)) || ACTIVE[0] || ARCH.slice().sort((a, b) => toMs(b.last_seen) - toMs(a.last_seen))[0];
    const hv = $("#hero-video"); if (!top || !hv) return;
    if (hero && hero.video) { hv.poster = hero.poster; hv.src = hero.video; hv.classList.remove("raw"); }
    else { hv.poster = top.poster; hv.src = top.video; hv.classList.add("raw"); }   // no clean film yet: crop onto the 3D flow
    if (!reduced) hv.play().catch(() => {});
    const cta = $("#cta-watch"); cta.textContent = `Watch ${top.name}`;
    cta.addEventListener("click", (e) => { e.preventDefault(); select(top, { scroll: true, autoplay: true }); });
  }
  // header turns solid once the opening scrolls away
  const bar = $("#bar"); const onScroll = () => bar.classList.toggle("solid", window.scrollY > 40);
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  // sections fade in as they arrive
  // (a plain position check rather than IntersectionObserver, so content can never stay hidden)
  const pendingReveal = [...document.querySelectorAll(".reveal")];
  const reveal = () => {
    for (let i = pendingReveal.length - 1; i >= 0; i--) {
      const n = pendingReveal[i];
      if (reduced || n.getBoundingClientRect().top < window.innerHeight * 0.92) { n.classList.add("in"); pendingReveal.splice(i, 1); }
    }
    if (!pendingReveal.length) window.removeEventListener("scroll", reveal);
  };
  window.addEventListener("scroll", reveal, { passive: true }); window.addEventListener("resize", reveal); reveal();
  window.addEventListener("hashchange", () => setTimeout(reveal, 50));

  // ================================================================== VIEWER
  const playBtn = $("#c-play"), bigPlay = $("#big-play");
  const playing = () => !video.paused && !video.ended;
  const updPlay = () => { playBtn.textContent = playing() ? "❚❚" : "▶"; playBtn.setAttribute("aria-label", playing() ? "Pause" : "Play"); bigPlay.hidden = playing(); };
  const toggle = () => { if (playing()) video.pause(); else video.play().catch(() => {}); };
  playBtn.addEventListener("click", toggle); bigPlay.addEventListener("click", toggle); video.addEventListener("click", toggle);
  const step = (h) => { if (!SEL) return; video.pause(); seek(SEL, video, vTime(SEL, video) + h * 36e5); };
  $("#c-back").addEventListener("click", () => step(-1)); $("#c-fwd").addEventListener("click", () => step(1));
  $("#c-speed").addEventListener("change", (e) => { video.playbackRate = +e.target.value; });
  $("#c-full").addEventListener("click", () => { const sc = $("#screen"); (sc.requestFullscreen || sc.webkitRequestFullscreen || (() => {})).call(sc); });
  let raf = 0; const loop = () => { sync(); raf = requestAnimationFrame(loop); };
  video.addEventListener("play", () => { updPlay(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); });
  video.addEventListener("pause", () => { updPlay(); cancelAnimationFrame(raf); sync(); });
  for (const ev of ["seeked", "loadedmetadata", "timeupdate"]) video.addEventListener(ev, sync);

  // ---- scrubber: the intensity curve is the timeline
  const SC = {};
  function drawScrub(s) {
    const box = $("#scrub"); box.textContent = ""; SC.s = null;
    const P = s._pts; if (P.length < 2) { box.append(el("p", { class: "empty", text: "Not enough advisories yet to draw the intensity curve." })); return; }
    const W = Math.max(320, box.clientWidth || 700), H = 200, m = { l: 36, r: 14, t: 12, b: 26 };
    const t0 = P[0].t, t1 = P[P.length - 1].t, ymax = Math.max(70, d3.max(P, (p) => p.kt) * 1.15);
    const X = (t) => m.l + (W - m.l - m.r) * (t - t0) / Math.max(1, t1 - t0), Y = (k) => H - m.b - (H - m.t - m.b) * k / ymax;
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Official intensity of ${s.name} over time` });
    for (const [a, b, k] of [[0, 34, 20], [34, 64, 40], [64, 83, 70], [83, 96, 90], [96, 113, 100], [113, 137, 120], [137, 999, 140]])
      if (a < ymax) svg.append(sv("rect", { class: "band", x: m.l, width: W - m.l - m.r, y: Y(Math.min(b, ymax)), height: Y(a) - Y(Math.min(b, ymax)), fill: col(k) }));
    for (const g of [34, 64, 96, 137]) if (g < ymax * .96) {
      svg.append(sv("line", { class: "grid", x1: m.l, x2: W - m.r, y1: Y(g), y2: Y(g) }));
      const tx = sv("text", { x: m.l - 5, y: Y(g) + 4, "text-anchor": "end" }); tx.textContent = g; svg.append(tx);
    }
    const kt = sv("text", { x: 4, y: m.t + 6 }); kt.textContent = "kt"; svg.append(kt);
    const d0 = new Date(t0); d0.setUTCHours(0, 0, 0, 0);
    const days = (t1 - t0) / 864e5, every = days > 12 ? 3 : days > 6 ? 2 : 1;
    let di = 0;
    for (let d = d0.getTime() + 864e5; d < t1; d += 864e5, di++) {
      svg.append(sv("line", { class: "grid", x1: X(d), x2: X(d), y1: m.t, y2: H - m.b }));
      if (di % every === 0) { const tx = sv("text", { x: X(d) + 3, y: H - 8 }); const dd = new Date(d); tx.textContent = `${dd.getUTCDate()} ${MON[dd.getUTCMonth()]}`; svg.append(tx); }
    }
    for (const [a, b] of s._ri) svg.append(sv("rect", { class: "riw", x: X(a), width: X(b) - X(a), y: m.t, height: H - m.t - m.b }));
    for (let i = 1; i < P.length; i++)
      svg.append(sv("line", { x1: X(P[i - 1].t), y1: Y(P[i - 1].kt), x2: X(P[i].t), y2: Y(P[i].kt), stroke: col(Math.max(P[i - 1].kt, P[i].kt)), "stroke-width": 4, "stroke-linecap": "round" }));
    const ws = isNaN(s._ws) ? t0 : Math.max(s._ws, t0), we = isNaN(s._we) ? t0 : Math.min(s._we, t1);
    if (ws > t0) svg.append(sv("rect", { class: "outside", x: m.l, width: X(ws) - m.l, y: m.t, height: H - m.t - m.b }));
    if (we < t1) svg.append(sv("rect", { class: "outside", x: X(we), width: W - m.r - X(we), y: m.t, height: H - m.t - m.b }));
    if (!isNaN(s._ws)) { const tx = sv("text", { x: X(ws) + 4, y: m.t + 12 }); tx.textContent = "video"; svg.append(tx); }
    const hov = sv("line", { class: "hov", y1: m.t, y2: H - m.b, x1: -9, x2: -9 }); svg.append(hov);
    const head = sv("line", { class: "head", y1: m.t, y2: H - m.b, x1: -9, x2: -9 }); svg.append(head);
    const knob = sv("circle", { class: "knob", r: 7, cx: -9, cy: -9 }); svg.append(knob);
    const hit = sv("rect", { class: "hit", x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent", tabindex: 0,
      "aria-label": "Video timeline. Left and right arrow keys move one hour." });
    svg.append(hit); box.append(svg);
    Object.assign(SC, { s, X, Y, t0, t1, head, knob, hov });
    const tAt = (ev) => { const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) * W / r.width; return t0 + (t1 - t0) * Math.min(1, Math.max(0, (x - m.l) / (W - m.l - m.r))); };
    let drag = false;
    const inspect = (t) => {
      const p = at(s, t); hov.setAttribute("x1", X(t)); hov.setAttribute("x2", X(t));
      const inside = !isNaN(s._ws) && t >= s._ws && t <= s._we;
      set("#scrub-tip", `${fmt(t)}: ${Math.round(p.kt)} kt, ${catName(p.kt)}, ${ll(p.lat, p.lon)}${inside ? "" : " (outside the video)"}`);
      ghostAt(p);
    };
    hit.addEventListener("pointerdown", (e) => { drag = true; hit.setPointerCapture(e.pointerId); video.pause(); seek(s, video, tAt(e)); });
    hit.addEventListener("pointermove", (e) => { const t = tAt(e); inspect(t); if (drag) seek(s, video, t); });
    hit.addEventListener("pointerup", () => { drag = false; });
    hit.addEventListener("pointerleave", () => { if (!drag) { hov.setAttribute("x1", -9); hov.setAttribute("x2", -9); set("#scrub-tip", ""); ghostAt(null); } });
    hit.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); step(e.key === "ArrowRight" ? 1 : -1); } });
  }

  // ---- regional map (orthographic, zoomed on the storm; night moves with the video)
  const M = { svg: d3.select("#map").attr("viewBox", "0 0 400 368"), k: 1 };
  M.proj = d3.geoOrthographic().clipAngle(90).precision(0.3); M.path = d3.geoPath(M.proj);
  for (const c of ["ocean", "grat", "land", "night", "others", "track", "dots", "ghost", "mark"]) M[c] = M.svg.append("g");
  function drawMap(s) {
    if (!s || !s._pts.length) return;
    const P = s._pts, last = P[P.length - 1];
    if (!M.s || M.s !== s) {
      const mid = P[Math.floor(P.length / 2)];
      M.rot = [-(d3.mean(P, (p) => p.lon) ?? mid.lon), -(d3.mean(P, (p) => p.lat) ?? mid.lat)]; M.k = 1; M.s = s;
      M.proj.rotate(M.rot).fitExtent([[26, 26], [374, 342]], { type: "MultiPoint", coordinates: P.map((p) => [p.lon, p.lat]) });
      M.base = Math.min(M.proj.scale(), 5200); M.tr = M.proj.translate();
    }
    M.proj.rotate(M.rot).scale(M.base * M.k).translate([200, 184]);
    const P_ = M.path;
    M.ocean.selectAll("*").remove(); M.ocean.append("path").attr("class", "g-ocean").attr("d", P_({ type: "Sphere" }));
    M.grat.selectAll("*").remove(); M.grat.append("path").attr("class", "g-grat").attr("d", P_(d3.geoGraticule().step([5, 5])()));
    M.land.selectAll("*").remove(); if (LAND50 || LAND110) M.land.append("path").attr("class", "g-land").attr("d", P_(LAND50 || LAND110));
    M.others.selectAll("*").remove();
    for (const o of ACTIVE) if (o !== s)
      M.others.append("path").attr("class", "m-other").attr("stroke", col(o.vmax_kt)).attr("d", P_({ type: "LineString", coordinates: o._pts.map((p) => [p.lon, p.lat]) }));
    M.track.selectAll("*").remove();
    for (let i = 1; i < P.length; i++)
      M.track.append("path").attr("class", "m-track").attr("stroke", col(P[i].kt)).attr("d", P_({ type: "LineString", coordinates: [[P[i - 1].lon, P[i - 1].lat], [P[i].lon, P[i].lat]] }));
    M.dots.selectAll("*").remove();
    for (const p of P) if (new Date(p.t).getUTCHours() % 12 === 0) { const xy = M.proj([p.lon, p.lat]); if (xy) M.dots.append("circle").attr("class", "m-dot").attr("r", 2.6).attr("cx", xy[0]).attr("cy", xy[1]); }
    M.mark.selectAll("*").remove();
    M.markG = M.mark.append("g").style("color", "var(--ink)"); M.markG.html(symbolSVG(s._south, 12));
    M.night.selectAll("*").remove();
    positionMap(isNaN(s._ws) ? last.t : vTime(s, video));
  }
  function positionMap(t) {
    if (!M.s || !M.markG) return;
    const p = at(M.s, t); if (!p) return;
    const xy = M.proj([p.lon, p.lat]); if (xy) M.markG.attr("transform", `translate(${xy[0]},${xy[1]})`);
    drawNight(M.night, M.path, t);
  }
  function ghostAt(p) {
    M.ghost.selectAll("*").remove(); if (!p) return;
    const xy = M.proj([p.lon, p.lat]); if (xy) M.ghost.append("circle").attr("r", 7).attr("cx", xy[0]).attr("cy", xy[1]).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2).attr("stroke-dasharray", "3 2");
  }
  M.svg.call(d3.drag().on("drag", (e) => {
    if (!SEL) return;
    const r = M.svg.node().getBoundingClientRect(), px = 400 / Math.max(1, r.width);    // screen px -> viewBox units
    const deg = 180 / (Math.PI * M.proj.scale());                                        // degrees per viewBox unit
    M.rot = [M.rot[0] + e.dx * px * deg, Math.max(-85, Math.min(85, M.rot[1] - e.dy * px * deg))]; drawMap(SEL);
  }));
  $("#m-in").addEventListener("click", () => { if (SEL) { M.k = Math.min(6, M.k * 1.4); drawMap(SEL); } });
  $("#m-out").addEventListener("click", () => { if (SEL) { M.k = Math.max(0.25, M.k / 1.4); drawMap(SEL); } });

  // ---- live sync of readouts, playhead, map
  function sync() {
    const s = SEL; if (!s) return;
    const t = vTime(s, video);
    if (isNaN(t)) { set("#c-time", ""); return; }
    const p = at(s, t); if (!p) return;
    const tf = vFrame(s, video), pf = at(s, tf) || p;
    set("#n-time", fmt(tf)); set("#n-wind", `${Math.round(pf.kt)} kt (${Math.round(pf.kt / 1.944)} m/s)`); set("#n-stage", catName(pf.kt)); set("#n-pos", ll(pf.lat, pf.lon));
    const h = Math.round((tf - s._ws) / 36e5), tot = Math.round((s._we - s._ws) / 36e5);
    set("#c-time", `Hour ${h} of ${tot} · ${fmt(tf)}`);
    if (SC.s === s) { const x = SC.X(Math.min(Math.max(t, SC.t0), SC.t1)); SC.head.setAttribute("x1", x); SC.head.setAttribute("x2", x); SC.knob.setAttribute("cx", x); SC.knob.setAttribute("cy", SC.Y(p.kt)); }
    positionMap(t);
    envSync(tf);
    const wv = $("#wv-link"); if (wv) wv.href = worldview(s, tf);
  }

  // ---- tabs
  const tabs = [...document.querySelectorAll(".tabs button")];
  const showTab = (name) => { for (const b of tabs) b.setAttribute("aria-selected", String(b.dataset.tab === name)); for (const id of ["overview", "structure", "facts"]) $(`#tab-${id}`).hidden = id !== name; };
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
    b.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.stopPropagation(); const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); showTab(n.dataset.tab); } });
  });
  function gauge(title, value, unit, max, a, b, note) {
    const v = Math.min(max, Math.max(0, value));
    return el("div", { class: "gauge" }, [el("h4", {}, [title, el("span", { text: `${value.toFixed(0)} ${unit}` })]),
      el("div", { class: "gbar", style: `--a:${a / max * 100}%;--b:${b / max * 100}%` }, [el("i", { style: `left:${v / max * 100}%` })]),
      el("div", { class: "gscale" }, [el("span", { style: `left:${a / max * 50}%`, text: note[0] }), el("span", { style: `left:${(a + b) / max * 50}%`, text: note[1] }), el("span", { style: `left:${(b + max) / max * 50}%`, text: note[2] })])]);
  }
  function fillTabs(s) {
    const story = s.story || [];
    const ov = $("#tab-overview"); ov.textContent = ""; ov.append(el("p", { text: story[0] || "A written summary appears after the next daily update." }));
    const st = $("#tab-structure"); st.textContent = "";
    const e = s.env;
    if (e && e.shear_now !== undefined) {
      const g = el("div", { class: "gauges" });
      g.append(gauge("850–500 hPa shear", e.shear_now, "m/s", 20, 5, 10, ["light", "moderate", "strong"]));
      g.append(gauge("Vortex tilt, 850 to 500 hPa", e.tilt_now, "km", 300, 50, 150, ["upright", "tilted", "strongly tilted"]));
      if (e.rmw_now !== undefined) g.append(gauge("Radius of maximum wind", e.rmw_now, "km", 300, 60, 150, ["compact", "moderate", "broad"]));
      if (e.shear_deep !== undefined) g.append(gauge("850–200 hPa deep-layer shear", e.shear_deep, "m/s", 25, 5, 10, ["weak", "moderate", "strong"]));
      if (e.rh_mid !== undefined) { const rr = 100 - e.rh_mid;            // drawn so that "good" is on the left, like the others
        const gg = gauge("Mid-level humidity (500–700 hPa)", e.rh_mid, "%", 100, 30, 45, ["moist", "moderate", "dry"]);
        gg.querySelector(".gbar i").style.left = `${Math.min(100, Math.max(0, rr))}%`; g.append(gg); }
      st.append(g);
    }
    st.append(el("p", { text: story[1] || "Structure diagnostics appear once the storm's video has been rendered." }));
    const fa = $("#tab-facts"); fa.textContent = "";
    const rows = [["Current intensity", `${s.vmax_kt} kt, ${s.pmin} hPa`], ["Peak", `${s.peak_kt} kt`], ["Motion", cap(s.motion) || "n/a"],
      ["Latest position", ll(s.lat, s.lon)], ["Basin", `${s.basin_name} (${s.centre})`], ["Tracked since", fmt(toMs(s.first_seen))],
      ["Last advisory", fmt(toMs(s.last_seen))], ["Accumulated cyclone energy", `${s._ace.toFixed(1)} (10⁴ kt²)`],
      ["Video covers", isNaN(s._ws) ? "n/a" : `${fmt(s._ws, false)} to ${fmt(s._we)}`]];
    fa.append(el("dl", { class: "facts" }, rows.map(([k, v]) => el("div", {}, [el("dt", { text: k }), el("dd", { text: v })]))));
    const share = el("button", { type: "button", class: "btn ghost", text: "Copy link to this storm" });
    share.addEventListener("click", () => {
      const url = `${location.origin}${location.pathname}#storm=${s.key}`;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { share.textContent = "Link copied"; setTimeout(() => (share.textContent = "Copy link to this storm"), 2000); }, () => prompt("Copy this link:", url));
    });
    fa.append(el("p", { class: "actions" }, [el("a", { class: "btn", href: s.video, download: `${s.key}.mp4`, text: "Download video (MP4)" }),
      el("a", { class: "btn ghost", href: s.poster, target: "_blank", rel: "noopener", text: "Open still frame" }),
      el("a", { class: "btn ghost", id: "wv-link", href: worldview(s, isNaN(s._we) ? toMs(s.last_seen) : s._we), target: "_blank", rel: "noopener",
        text: "Satellite view at this frame (NASA Worldview)" }), share]));
    fa.append(el("p", { class: "hint", text: "Worldview opens at the storm and this frame's time. Add the IMERG precipitation or geostationary infrared layers from its layer list." }));
  }


  // ================================================================== ENVIRONMENT (hourly diagnostics, linked charts)
  const METRICS = [
    { title: "Wind shear", unit: "m/s", lines: [["shear_deep", "850–200 hPa"], ["shear_mid", "850–500 hPa (dashed)"]], ref: 10, good: "below", min: 0, span: 15 },
    { title: "Mid-level humidity", unit: "%", lines: [["rh_mid", "500–700 hPa, 200–800 km from the centre"]], ref: 70, good: "above", min: 0, max: 100 },
    { title: "Sea surface temperature", unit: "°C", lines: [["sst", "ocean within 150 km of the centre"]], ref: 28, good: "above", dp: 1, span: 3 },
    { title: "Vortex tilt", unit: "km", lines: [["tilt", "500 hPa centre relative to 850 hPa"]], ref: 50, good: "below", min: 0, span: 120 },
    { title: "Radius of maximum wind", unit: "km", lines: [["rmw", "850 hPa"]], min: 0, span: 100 },
    { title: "Maximum wind", unit: "m/s", lines: [["official", "official"], ["gfs_vmax", "GFS 900 hPa (dashed)"]], min: 0, span: 40 },
  ];
  const CHECKS = [["shear_deep", "Deep shear", (v) => v < 10, "< 10 m/s", "m/s", 0], ["rh_mid", "Mid-level RH", (v) => v >= 70, "≥ 70%", "%", 0],
                  ["sst", "SST", (v) => v >= 28, "≥ 28 °C", "°C", 1], ["tilt", "Tilt", (v) => v < 50, "< 50 km", "km", 0]];
  let ENV = null;
  const envGrid = $("#env-grid");
  function loadEnv(s) {
    ENV = null; envGrid.textContent = ""; $("#checks").textContent = ""; set("#env-tip", "");
    if (!s.diag) { envGrid.append(el("p", { class: "empty", text: s.status === "active"
      ? "Hourly environment data appears for this storm from the next daily update."
      : "This storm's video was made before hourly environment data was saved, so only the summary in the Structure tab is available." })); return; }
    fetch(`${s.diag}?v=${encodeURIComponent((DATA && DATA.generated) || "")}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => {
        if (SEL !== s) return;
        const t = d.time.map(toMs);
        d.official = t.map((x) => { const p = at(s, x); return p ? Math.round(p.kt / 1.944 * 10) / 10 : null; });
        ENV = { s, t, d }; drawEnv(); sync();
      })
      .catch(() => { if (SEL === s) envGrid.append(el("p", { class: "empty", text: "The environment data for this storm could not be loaded." })); });
  }
  function drawEnv() {
    envGrid.textContent = ""; if (!ENV) return;
    const { t, d } = ENV; ENV.charts = []; const pending = [];
    for (const M_ of METRICS) {
      const series = M_.lines.map(([k]) => d[k] || []);
      if (!series[0].some((v) => v !== null && v !== undefined)) continue;
      const card = el("div", { class: "echart" }, [el("h4", {}, [M_.title, el("span", { text: "—" })]),
        el("small", { text: M_.lines.map((l) => l[1]).join(" · ") + (M_.ref !== undefined ? ` · red line ${M_.ref} ${M_.unit}` : "") })]);
      envGrid.append(card); pending.push([M_, series, card]);
    }
    for (const [M_, series, card] of pending) {
      const W = Math.max(240, card.clientWidth - 20), H = 110, m = { l: 30, r: 6, t: 6, b: 16 };
      const vals = series.flat().filter((v) => v !== null && v !== undefined);
      let y0 = M_.min !== undefined ? M_.min : Math.min(...vals, M_.ref ?? Infinity), y1 = M_.max !== undefined ? M_.max : Math.max(...vals, M_.ref ?? -Infinity);
      if (M_.min === undefined) y0 -= (y1 - y0) * .15 || 1; if (M_.max === undefined) y1 += (y1 - y0) * .15 || 1;
      if (M_.span && y1 - y0 < M_.span) { if (M_.min !== undefined) y1 = y0 + M_.span; else { const c = (y0 + y1) / 2; y0 = c - M_.span / 2; y1 = c + M_.span / 2; } }
      const X = (i) => m.l + (W - m.l - m.r) * i / Math.max(1, t.length - 1), Y = (v) => H - m.b - (H - m.t - m.b) * (v - y0) / Math.max(1e-6, y1 - y0);
      const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${M_.title} over the video` });
      if (M_.ref !== undefined && M_.good) {
        const yr = Y(M_.ref);
        svg.append(sv("rect", { class: "goodband", x: m.l, width: W - m.l - m.r, y: M_.good === "below" ? yr : m.t, height: M_.good === "below" ? H - m.b - yr : yr - m.t }));
        svg.append(sv("line", { class: "ref", x1: m.l, x2: W - m.r, y1: yr, y2: yr }));
      }
      for (const v of [y0, (y0 + y1) / 2, y1]) { const tx = sv("text", { x: m.l - 4, y: Y(v) + 3, "text-anchor": "end" }); tx.textContent = (M_.dp ? v.toFixed(1) : Math.round(v)); svg.append(tx); }
      const d0 = new Date(t[0]); d0.setUTCHours(0, 0, 0, 0);
      for (let x = d0.getTime() + 864e5; x < t[t.length - 1]; x += 864e5) {
        const i = (x - t[0]) / (t[t.length - 1] - t[0]) * (t.length - 1);
        const tx = sv("text", { x: X(i) + 2, y: H - 3 }); const dd = new Date(x); tx.textContent = `${dd.getUTCDate()} ${MON[dd.getUTCMonth()]}`; svg.append(tx);
      }
      series.forEach((arr, k) => {
        const line = d3.line().defined((v) => v !== null && v !== undefined).x((_, i) => X(i)).y((v) => Y(v));
        svg.append(sv("path", { class: k === 0 ? "ln" : "ln2", d: line(arr) || "" }));
      });
      const cur = sv("line", { class: "cur", y1: m.t, y2: H - m.b, x1: -9, x2: -9 }), hv = sv("line", { class: "hv", y1: m.t, y2: H - m.b, x1: -9, x2: -9 });
      svg.append(cur, hv); card.append(svg);
      const idxAt = (ev) => { const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) * W / r.width; return Math.round(Math.min(1, Math.max(0, (x - m.l) / (W - m.l - m.r))) * (t.length - 1)); };
      svg.addEventListener("pointermove", (e) => envHover(idxAt(e)));
      svg.addEventListener("pointerleave", () => envHover(null));
      svg.addEventListener("click", (e) => { if (SEL) { video.pause(); seek(SEL, video, t[idxAt(e)]); } });
      ENV.charts.push({ M: M_, X, cur, hv, val: card.querySelector("h4 span"), series });
    }
  }
  const fmtV = (v, M_) => (v === null || v === undefined ? "n/a" : `${M_.dp ? v.toFixed(M_.dp) : Math.round(v)} ${M_.unit}`);
  function envHover(i) {
    if (!ENV || !ENV.charts) return;
    for (const c of ENV.charts) { const x = i === null ? -9 : c.X(i); c.hv.setAttribute("x1", x); c.hv.setAttribute("x2", x); }
    set("#env-tip", i === null ? "" : `${fmt(ENV.t[i])}: ` + ENV.charts.map((c) => `${c.M.title.toLowerCase()} ${fmtV(c.series[0][i], c.M)}`).join(", "));
  }
  function envSync(t) {
    if (!ENV || ENV.s !== SEL || !ENV.charts) return;
    let i = d3.bisectCenter(ENV.t, t); i = Math.max(0, Math.min(ENV.t.length - 1, i));
    for (const c of ENV.charts) { const x = c.X(i); c.cur.setAttribute("x1", x); c.cur.setAttribute("x2", x); c.val.textContent = fmtV(c.series[0][i], c.M); }
    const ul = $("#checks"); ul.textContent = ""; let ok = 0, n = 0;
    for (const [k, name, test, thr, unit, dp] of CHECKS) {
      const v = (ENV.d[k] || [])[i];
      if (v === null || v === undefined) { ul.append(el("li", { class: "na", text: `${name}: n/a` })); continue; }
      const good = test(v); n++; if (good) ok++;
      ul.append(el("li", { class: good ? "ok" : "no", text: `${good ? "✓" : "✗"} ${name} ${dp ? v.toFixed(dp) : Math.round(v)} ${unit} (${thr})` }));
    }
    set("#checks-title", n ? `Conditions at this frame: ${ok} of ${n} favourable` : "Conditions at this frame");
  }
  const worldview = (s, t) => {
    const p = at(s, t) || {}; const lo = (((p.lon ?? 0) + 540) % 360) - 180, la = p.lat ?? 0;
    const d = new Date(t), iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-T${pad(d.getUTCHours())}:00:00Z`;
    const x0 = Math.max(-180, lo - 12), x1 = Math.min(180, lo + 12), y0 = Math.max(-85, la - 9), y1 = Math.min(85, la + 9);
    return `https://worldview.earthdata.nasa.gov/?v=${x0.toFixed(1)},${y0.toFixed(1)},${x1.toFixed(1)},${y1.toFixed(1)}&t=${iso}`;
  };

  // ---- selection
  const navList = () => (SEL && SEL.status !== "active" ? ALL : ACTIVE.length ? ACTIVE : ALL);
  function select(s, opts = {}) {
    if (!s) return;
    SEL = s;
    $(".v-head").style.setProperty("--cat", `var(${CATV(s.vmax_kt)})`);
    set("#v-kicker", `${s.label} ${s.sid} · ${s.basin_name}${s.status !== "active" ? ` · ${s.year}, archived` : ""}`);
    set("#v-name", s.name);
    const tags = $("#v-tags"); tags.textContent = ""; tags.style.setProperty("--cat", `var(${CATV(s.vmax_kt)})`);
    tags.append(el("span", { class: "tag cat", text: `${catName(s.vmax_kt)}, ${s.vmax_kt} kt` }));
    const rapid = s.status === "active" && s.trend === "rapidly intensifying";
    if (s.status === "active" && s.trend && s.dv24 !== null && s.dv24 !== undefined)
      tags.append(el("span", { class: `tag${rapid ? " ri" : ""}`, text: `${cap(s.trend)}, ${s.dv24 > 0 ? "+" : ""}${s.dv24} kt in 24 h` }));
    if (s.ri && !rapid) tags.append(el("span", { class: "tag ri", text: s.status === "active" ? "Rapid intensification earlier" : "Rapid intensification" }));
    if (s.status !== "active") tags.append(el("span", { class: "tag", text: `Peak ${s.peak_kt} kt` }));
    video.poster = s.poster; video.src = s.video; video.load(); video.playbackRate = +$("#c-speed").value;
    if (opts.autoplay && !reduced) video.play().catch(() => {});
    updPlay(); fillTabs(s); drawScrub(s); M.s = null; drawMap(s); loadEnv(s); sync(); drawGlobe();
    for (const c of document.querySelectorAll(".scard")) c.setAttribute("aria-current", String(c.dataset.key === s.key));
    const nl = navList(); $("#prev").disabled = nl.length < 2; $("#next").disabled = nl.length < 2;
    try { history.replaceState(null, "", `#storm=${s.key}`); } catch (e) { /* ignore */ }
    if (!$("#guide-img").getAttribute("src")) $("#guide-img").src = s.poster;
    if (s._pts.length) {
      const l = s._pts[s._pts.length - 1];
      if (opts.initial && EARTH) {                // first view: frame the storm together with the sunlit side
        const [slo, sla] = subsolar(Date.now()), r = Math.PI / 180;
        const v = (la, lo) => [Math.cos(la * r) * Math.cos(lo * r), Math.cos(la * r) * Math.sin(lo * r), Math.sin(la * r)];
        const a = v(l.lat, l.lon), b = v(sla, slo), t = 0.42, m = a.map((x, i) => x * (1 - t) + b[i] * t), n = Math.hypot(...m);
        EARTH.focus(Math.asin(m[2] / n) / r, Math.atan2(m[1], m[0]) / r, 1);
      } else turnGlobeTo(l.lon, l.lat);
    }
    if (opts.scroll) $("#viewer").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }
  const move = (d) => { const nl = navList(); if (nl.length < 2 || !SEL) return; const i = nl.indexOf(SEL); select(nl[(i + d + nl.length) % nl.length]); };
  $("#prev").addEventListener("click", () => move(-1)); $("#next").addEventListener("click", () => move(1));
  document.addEventListener("keydown", (e) => {
    const t = e.target; if (t.closest && t.closest("input, select, textarea, [role=tab], .scrub, #compare")) return;
    const inViewer = t === document.body || (t.closest && t.closest("#viewer"));
    if (!inViewer || !SEL) return;
    if (e.key === " " && t.tagName !== "BUTTON") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight" && t.tagName !== "BUTTON") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft" && t.tagName !== "BUTTON") { e.preventDefault(); step(-1); }
    else if (e.key === "]") move(1); else if (e.key === "[") move(-1);
  });
  let rT = 0; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { if (SEL) { drawScrub(SEL); drawEnv(); sync(); } drawCompareCharts(); }, 150); });

  // ================================================================== COMPARE
  const CM = { a: null, b: null, va: $("#cmp-va"), vb: $("#cmp-vb") };
  function miniChart(boxSel, s, v) {
    const box = $(boxSel); box.textContent = ""; if (!s || s._pts.length < 2) return null;
    const W = Math.max(260, box.clientWidth || 400), H = 90, m = { l: 28, r: 8, t: 8, b: 16 };
    const P = s._pts.filter((p) => isNaN(s._ws) || (p.t >= s._ws - 6 * 36e5 && p.t <= s._we + 6 * 36e5));
    if (P.length < 2) return null;
    const t0 = isNaN(s._ws) ? P[0].t : s._ws, t1 = isNaN(s._we) ? P[P.length - 1].t : s._we, ymax = Math.max(70, d3.max(P, (p) => p.kt) * 1.15);
    const X = (t) => m.l + (W - m.l - m.r) * (t - t0) / Math.max(1, t1 - t0), Y = (k) => H - m.b - (H - m.t - m.b) * k / ymax;
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Official intensity of ${s.name} during its video` });
    const cid = `clip-${boxSel.slice(1)}`, defs = sv("defs"), cp = sv("clipPath", { id: cid });
    cp.append(sv("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H })); defs.append(cp); svg.append(defs);
    const gl = sv("g", { "clip-path": `url(#${cid})` });
    for (const [a, b, k] of [[0, 34, 20], [34, 64, 40], [64, 96, 80], [96, 137, 110], [137, 999, 140]])
      if (a < ymax) svg.append(sv("rect", { class: "band", x: m.l, width: W - m.l - m.r, y: Y(Math.min(b, ymax)), height: Y(a) - Y(Math.min(b, ymax)), fill: col(k) }));
    for (const g of [34, 64, 96]) if (g < ymax * .95) { const tx = sv("text", { x: m.l - 4, y: Y(g) + 3, "text-anchor": "end" }); tx.textContent = g; svg.append(tx); }
    for (let i = 1; i < P.length; i++)
      gl.append(sv("line", { x1: X(P[i - 1].t), y1: Y(P[i - 1].kt), x2: X(P[i].t), y2: Y(P[i].kt), stroke: col(Math.max(P[i - 1].kt, P[i].kt)), "stroke-width": 3, "stroke-linecap": "round" }));
    svg.append(gl);
    const head = sv("line", { class: "head", y1: m.t, y2: H - m.b, x1: -9, x2: -9 }); svg.append(head); box.append(svg);
    return { X, head, s, v };
  }
  function cmpInfo(sel, s) {
    const box = $(sel); box.textContent = ""; if (!s) return;
    const P = s._pts.filter((p) => !isNaN(s._ws) && p.t >= s._ws && p.t <= s._we);
    const a = P[0], b = P[P.length - 1];
    box.append(el("strong", { text: `${s.name} (${s.year})` }),
      el("span", { text: `${s.label}, ${s.basin_name}, peak ${s.peak_kt} kt${s.ri ? ", rapid intensification" : ""}` }),
      el("span", { text: a && b ? `Video: ${fmt(a.t, false)} to ${fmt(b.t)}, ${a.kt} → ${b.kt} kt` : "" }));
  }
  function drawCompareCharts() {
    CM.ca = miniChart("#cmp-ca", CM.a, CM.va); CM.cb = miniChart("#cmp-cb", CM.b, CM.vb);
  }
  function loadCompare() {
    CM.a = ALL.find((s) => s.key === $("#cmp-a").value) || null; CM.b = ALL.find((s) => s.key === $("#cmp-b").value) || null;
    for (const [v, s] of [[CM.va, CM.a], [CM.vb, CM.b]]) { v.pause(); if (s) { v.poster = s.poster; v.src = s.video; v.load(); } }
    cmpInfo("#cmp-ia", CM.a); cmpInfo("#cmp-ib", CM.b); drawCompareCharts(); $("#cmp-play").textContent = "Play both"; $("#cmp-range").value = 0;
  }
  const cmpDur = () => Math.max(CM.va.duration || 0, CM.vb.duration || 0);
  function cmpSync() {
    for (const c of [CM.ca, CM.cb]) if (c) { const t = vTime(c.s, c.v); if (!isNaN(t)) { const x = c.X(t); c.head.setAttribute("x1", x); c.head.setAttribute("x2", x); } }
    const d = cmpDur(); if (d) $("#cmp-range").value = Math.round(1000 * (CM.va.currentTime || 0) / d);
  }
  let craf = 0; const cloop = () => { cmpSync(); craf = requestAnimationFrame(cloop); };
  $("#cmp-play").addEventListener("click", () => {
    const btn = $("#cmp-play");
    if (!CM.va.paused || !CM.vb.paused) { CM.va.pause(); CM.vb.pause(); cancelAnimationFrame(craf); btn.textContent = "Play both"; return; }
    const t = Math.min(CM.va.currentTime || 0, CM.vb.currentTime || 0);
    CM.va.currentTime = t; CM.vb.currentTime = t;
    Promise.all([CM.va.play(), CM.vb.play()]).catch(() => {}); btn.textContent = "Pause both"; cancelAnimationFrame(craf); craf = requestAnimationFrame(cloop);
  });
  for (const v of [CM.va, CM.vb]) { v.addEventListener("ended", () => { $("#cmp-play").textContent = "Play both"; cancelAnimationFrame(craf); cmpSync(); }); v.addEventListener("seeked", cmpSync); }
  $("#cmp-range").addEventListener("input", (e) => {
    const t = +e.target.value / 1000 * cmpDur(); CM.va.pause(); CM.vb.pause(); $("#cmp-play").textContent = "Play both";
    for (const v of [CM.va, CM.vb]) if (v.duration) v.currentTime = Math.min(t, v.duration - 0.05);
  });
  function setupCompare() {
    const A = $("#cmp-a"), B = $("#cmp-b"); A.textContent = ""; B.textContent = "";
    const list = [...ACTIVE, ...ARCH.slice().sort((a, b) => toMs(b.last_seen) - toMs(a.last_seen))];
    for (const s of list) { const lab = `${s.name} (${s.year})${s.status === "active" ? ", active" : ""}, peak ${s.peak_kt} kt`;
      A.append(el("option", { value: s.key, text: lab })); B.append(el("option", { value: s.key, text: lab })); }
    if (list.length < 2) { $("#compare").hidden = list.length === 0; if (list[0]) { A.value = list[0].key; B.value = list[0].key; } loadCompare(); return; }
    const ri = list.find((s) => s.ri), non = list.find((s) => !s.ri && s !== ri);
    A.value = (ri || list[0]).key; B.value = (non || list.find((s) => s.key !== A.value)).key;
    A.addEventListener("change", loadCompare); B.addEventListener("change", loadCompare); loadCompare();
  }

  // ================================================================== SEASON
  function drawSeason() {
    const year = DATA && DATA.generated ? new Date(toMs(DATA.generated)).getUTCFullYear() : new Date().getUTCFullYear();
    set("#season-title", `${year} season at a glance`);
    const S = ALL.filter((s) => s.year === year);
    const ace = $("#s-ace"), cat = $("#s-cat"), top = $("#s-top"); ace.textContent = ""; cat.textContent = ""; top.textContent = "";
    if (!S.length) { ace.append(el("p", { class: "muted", text: "No storms rendered yet this year." })); return; }
    const byB = d3.rollups(S, (v) => d3.sum(v, (s) => s._ace), (s) => s.basin_name).sort((a, b) => b[1] - a[1]);
    const mx = d3.max(byB, (d) => d[1]) || 1;
    for (const [b, v] of byB) ace.append(el("div", { class: "hbar" }, [el("span", { text: b }), el("div", { style: `width:${Math.max(2, v / mx * 100)}%` }), el("b", { text: v.toFixed(1) })]));
    const groups = [["TD", 0, 34, "--td"], ["TS", 34, 64, "--ts"], ["1", 64, 83, "--c1"], ["2", 83, 96, "--c2"], ["3", 96, 113, "--c3"], ["4", 113, 137, "--c4"], ["5", 137, 999, "--c5"]];
    const counts = groups.map(([n, a, b, c]) => [n, S.filter((s) => s.peak_kt >= a && s.peak_kt < b).length, c]);
    const cm = Math.max(1, ...counts.map((c) => c[1]));
    const bars = el("div", { class: "catbars", role: "img", "aria-label": counts.map((c) => `${c[0]}: ${c[1]}`).join(", ") });
    for (const [n, k, c] of counts) bars.append(el("div", {}, [el("b", { text: k }), el("i", { style: `height:${k / cm * 100}%;--c:var(${c})` }), el("span", { text: n })]));
    cat.append(bars);
    for (const s of S.slice().sort((a, b) => b.peak_kt - a.peak_kt).slice(0, 6)) {
      const b = el("button", { type: "button", text: `${s.name}` }); b.addEventListener("click", () => select(s, { scroll: true }));
      top.append(el("li", {}, [b, ` ${s.peak_kt} kt, ${s.basin_name}${s.ri ? ", RI" : ""}`]));
    }
  }

  // ================================================================== ARCHIVE
  function drawArchive() {
    const box = $("#archive-list"); box.textContent = "";
    const y = $("#f-year").value, b = $("#f-basin").value, sort = $("#f-sort").value;
    const list = ARCH.filter((s) => (!y || String(s.year) === y) && (!b || s.basin_name === b));
    list.sort(sort === "peak" ? (p, q) => q.peak_kt - p.peak_kt : sort === "ace" ? (p, q) => q._ace - p._ace : (p, q) => toMs(q.last_seen) - toMs(p.last_seen));
    if (!list.length) { box.append(el("p", { class: "empty", text: ARCH.length ? "No storms match these filters." : "Storms appear here after they dissipate." })); return; }
    for (const s of list) {
      const c = el("button", { type: "button", class: "card", style: `--c:var(${CATV(s.peak_kt)})` }, [el("img", { src: s.poster, alt: "", loading: "lazy" }),
        el("div", {}, [el("strong", { text: `${s.name} (${s.year})` }), el("span", { text: `${s.basin_name}, peak ${s.peak_kt} kt, ACE ${s._ace.toFixed(1)}${s.ri ? ", rapid intensification" : ""}` })])]);
      c.addEventListener("click", () => select(s, { scroll: true })); box.append(c);
    }
  }
  for (const id of ["#f-year", "#f-basin", "#f-sort"]) $(id).addEventListener("change", drawArchive);

  // ================================================================== GUIDE
  const SPOTS = [
    [36, 3, "Title", "Storm name, agency ID and the analysis time of this frame. Frames are one hour apart."],
    [35, 42, "3D flow box", "The box follows the storm from 900 hPa near the surface up to 500 hPa. Streamlines and tracers are coloured by wind speed; the red surface is the vortex core (high relative vorticity), grey patches are strong ascent, and the white line joins the circulation centre at each level."],
    [70, 45, "Wind speed scale", "Colour scale for streamlines and tracers, in m/s. Strong flow is also drawn brighter and thicker."],
    [88, 13, "Diagnostics", "Official intensity, GFS 900 hPa maximum wind, radius of maximum wind, shear, tilt, local solar time and centre position for this frame."],
    [86, 77, "Shear and tilt compass", "Plan view: the orange arrow is 850–500 hPa shear, the white arrow is where the 500 hPa centre sits relative to 850 hPa. Tilt pointing downshear, then precessing and aligning, is a classic path to rapid intensification."],
    [35, 88, "Intensity timeline", "White: official maximum wind. Blue: GFS 900 hPa maximum wind. Red shading: rapid intensification (official +30 kt in 24 h). The cursor marks this frame."],
    [40, 70, "Day and night floor", "The ocean and land are shaded by the real position of the sun, so you can follow the diurnal cycle of convection."],
  ];
  const gf = $("#guide-frame"), gt = $("#guide-text");
  const showSpot = (i) => { for (const h of gf.querySelectorAll(".hot")) h.setAttribute("aria-pressed", String(+h.dataset.i === i)); gt.textContent = ""; gt.append(el("h3", { text: `${i + 1}. ${SPOTS[i][2]}` }), el("p", { text: SPOTS[i][3] })); };
  SPOTS.forEach(([x, y, name], i) => { const h = el("button", { type: "button", class: "hot", "data-i": i, style: `left:${x}%;top:${y}%`, "aria-label": name, "aria-pressed": "false", text: i + 1 }); h.addEventListener("click", () => showSpot(i)); gf.append(h); });
  showSpot(1);

  // ================================================================== LOAD
  const land = (f) => fetch(`vendor/${f}`).then((r) => r.json()).then((t) => topojson.feature(t, t.objects.land)).catch(() => null);
  land("land-110m.json").then((g) => { LAND110 = g; drawGlobe(); if (SEL) drawMap(SEL); });
  fetch(`data/storms.json?t=${Date.now()}`)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => {
      DATA = d; ALL = (d.storms || []).map(prep);
      ACTIVE = ALL.filter((s) => s.status === "active").sort((a, b) => b.vmax_kt - a.vmax_kt);
      ARCH = ALL.filter((s) => s.status !== "active");
      for (const y of [...new Set(ARCH.map((s) => s.year))].sort().reverse()) $("#f-year").append(el("option", { value: y, text: y }));
      for (const b of [...new Set(ARCH.map((s) => s.basin_name))].sort()) $("#f-basin").append(el("option", { value: b, text: b }));
      drawHero(); drawArchive(); drawSeason(); setupCompare(); setupOpening();
      const m = location.hash.match(/storm=([\w-]+)/);
      const first = (m && ALL.find((s) => s.key === m[1])) || ACTIVE[0] || ARCH.slice().sort((a, b) => toMs(b.last_seen) - toMs(a.last_seen))[0];
      if (first) select(first, { scroll: !!m, initial: true }); else set("#v-name", "No storms yet");
      drawGlobe();
      land("land-50m.json").then((g) => { if (g) { LAND50 = g; if (SEL) drawMap(SEL); } });
    })
    .catch((err) => { console.error(err); set("#status", "The storm list could not be loaded yet. It is created by the daily update; run the workflow once to build it."); });
})();
