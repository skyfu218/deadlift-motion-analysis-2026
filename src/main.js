import "./styles.css";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { detectReps, frameMetrics, selectSide } from "./analysis.js";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const state = { file: null, url: null, pose: null, frames: [], reps: [], analyzing: false, trackingSide: null };

document.querySelector("#app").innerHTML = `
  <a class="skip" href="#workbench">跳到分析工作臺</a>
  <header class="topbar">
    <a class="brand" href="#workbench"><span class="dl-badge">DL</span><span><strong>Deadlift Lab</strong><small>硬舉動作同步分析</small></span></a>
    <div class="top-actions"><span class="privacy-dot">影片留在此裝置</span><button class="ghost" id="guideButton">拍攝指南</button><label class="button primary compact" for="videoInput">選擇影片</label></div>
    <input id="videoInput" type="file" accept="video/*" hidden>
  </header>
  <main class="workbench" id="workbench">
    <section class="video-panel">
      <div class="panel-heading"><div><p class="eyebrow">VIDEO + MOTION OVERLAY</p><h1>影像與動作追蹤</h1></div><span id="statusBadge" class="status">等待影片</span></div>
      <div class="video-shell">
        <video id="video" playsinline controls preload="metadata"></video><canvas id="overlay"></canvas>
        <div class="empty-state" id="emptyState"><span class="upload-symbol">＋</span><strong>載入側面硬舉影片</strong><p>全身、雙手與槓片完整入鏡，可提升追蹤穩定度。</p><label class="button primary" for="videoInput">瀏覽影片</label></div>
        <div class="video-hud" id="videoHud" hidden><span>BAR HEIGHT PROXY</span><strong id="hudBarHeight">—</strong><small>手腕高度／腿長</small></div>
        <div class="segment-key" id="segmentKey" hidden><span><i class="seg-trunk"></i>Trunk</span><span><i class="seg-hip"></i>Hip</span><span><i class="seg-thigh"></i>Thigh</span><span><i class="seg-bar"></i>Bar / plate</span></div>
      </div>
      <div class="video-controls">
        <div class="range-label"><span>分析區段</span><strong id="rangeText">00:00.0 — 00:00.0</strong></div>
        <div class="dual-range"><input id="startRange" type="range" min="0" max="100" value="0" step="0.1"><input id="endRange" type="range" min="0" max="100" value="100" step="0.1"></div>
        <div class="action-row"><button class="button primary" id="analyzeButton" disabled>開始本機分析</button><button class="button" id="cancelButton" hidden>停止</button><span id="progressText">尚未開始</span></div><div class="progress"><i id="progressBar"></i></div>
      </div>
    </section>
    <aside class="data-panel">
      <section class="summary-strip"><div><span>REPS</span><strong id="repCount">—</strong></div><div><span>AVG LIFT</span><strong id="avgLift">—</strong><small>s</small></div><div><span>AVG LOWER</span><strong id="avgLower">—</strong><small>s</small></div><div><span>POSE QUALITY</span><strong id="confidence">—</strong></div></section>
      <section class="live-strip"><div><span>CURRENT PHASE</span><strong id="currentPhase">等待分析</strong></div><div><span>BAR HEIGHT</span><strong id="currentBar">—</strong><small> relative</small></div><div><span>ROUND-BACK VISUAL PROXY</span><strong id="currentRound">—</strong><small>%</small></div></section>
      <article class="chart-card"><div class="chart-heading"><div><strong>Bar height</strong><small>手腕握槓軌跡／腿長的相對高度</small></div><span class="chart-time" id="chartTime">00:00.0</span></div><canvas id="barCanvas"></canvas></article>
      <article class="chart-card round-card"><div class="chart-heading"><div><strong>P(rounded) visual proxy</strong><small>僅模仿呈現，不是圓背或傷害判定</small></div><span class="threshold-key"><i></i>50% 視覺分區</span></div><canvas id="roundCanvas"></canvas></article>
      <article class="rep-card"><div class="rep-head"><span>REP</span><span>VISUAL STATE</span><span>PROXY</span><span>LIFT</span></div><div id="repList" class="rep-list"><div class="list-empty">完成分析後顯示逐次資料</div></div></article>
      <div class="data-footer"><span>次數以握槓手腕軌跡估算</span><div><button class="text-button" id="csvButton" disabled>CSV</button><button class="text-button" id="jsonButton" disabled>JSON</button></div></div>
    </aside>
  </main>
  <footer class="site-footer"><section class="sponsor"><div class="society-mark" role="img" aria-label="臺灣運動健康科技學會 Logo"><img src="/society-brand-reference.png" alt=""></div><div class="society-copy"><span>COPYRIGHT © 2026</span><strong>臺灣運動健康科技學會</strong><small>Taiwan Society of Sports and Health Technology</small></div><div class="footer-meta"><span>Deadlift Lab · Web Motion Analysis</span><span>版本更新｜2026 年 11 月</span></div></section></footer>
  <dialog id="guideDialog"><form method="dialog"><button class="dialog-close" aria-label="關閉">×</button><p class="eyebrow">RECORDING GUIDE</p><h2>三件事，讓追蹤更準</h2><div class="guide-grid"><div><b>1</b><strong>正側面固定鏡位</strong><p>鏡頭與槓鈴移動方向垂直，避免斜拍造成深度誤差。</p></div><div><b>2</b><strong>手腕與槓片清楚</strong><p>本版以握槓手腕作為 Bar height 代理，請避免遮擋雙手。</p></div><div><b>3</b><strong>全身留白</strong><p>頭、肩、髖、膝、踝都要入鏡，背景與衣著保持對比。</p></div></div><button class="button primary" value="close">了解</button></form></dialog>
`;

const $ = selector => document.querySelector(selector);
const video = $("#video"), overlay = $("#overlay"), ctx = overlay.getContext("2d");
const barCanvas = $("#barCanvas"), roundCanvas = $("#roundCanvas");
const chartContexts = { bar: barCanvas.getContext("2d"), round: roundCanvas.getContext("2d") };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const formatTime = (seconds = 0) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
const setStatus = (text, live = false) => { $("#statusBadge").textContent = text; $("#statusBadge").classList.toggle("live", live); };
const updateRange = () => { $("#rangeText").textContent = `${formatTime(+$(`#startRange`).value)} — ${formatTime(+$(`#endRange`).value)}`; };

function setVideoFile(file) {
  if (!file) return; if (!file.type.startsWith("video/")) return alert("請選擇影片檔案。");
  if (state.url) URL.revokeObjectURL(state.url);
  Object.assign(state, { file, url: URL.createObjectURL(file), frames: [], reps: [], trackingSide: null });
  video.src = state.url; $("#emptyState").hidden = true; setStatus("影片載入中", true);
  video.addEventListener("loadedmetadata", () => {
    const duration = video.duration || 0; [$("#startRange"), $("#endRange")].forEach(input => input.max = duration);
    $("#startRange").value = 0; $("#endRange").value = duration; overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    updateRange(); $("#analyzeButton").disabled = false; setStatus("影片已就緒");
  }, { once: true });
}

async function ensurePose() {
  if (state.pose) return state.pose; $("#progressText").textContent = "載入姿勢模型（首次使用需要網路）";
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  state.pose = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: .6, minPosePresenceConfidence: .6, minTrackingConfidence: .65 });
  return state.pose;
}
const seek = time => new Promise(resolve => { const done = () => { video.removeEventListener("seeked", done); resolve(); }; video.addEventListener("seeked", done); video.currentTime = Math.min(time, Math.max(0, video.duration - .001)); });

async function analyze() {
  if (!state.file || state.analyzing) return; const start = +$("#startRange").value, end = +$("#endRange").value;
  if (end - start < 1) return alert("分析區段至少需要 1 秒。");
  Object.assign(state, { analyzing: true, frames: [], reps: [], trackingSide: null }); $("#analyzeButton").disabled = true; $("#cancelButton").hidden = false; setStatus("分析中", true);
  try {
    const pose = await ensurePose(), step = Math.max(.08, (end - start) / 360); let index = 0;
    for (let time = start; time <= end && state.analyzing; time += step) {
      await seek(time); const result = pose.detectForVideo(video, Math.round(time * 1000));
      if (result.landmarks?.[0]) { const landmarks = result.landmarks[0]; if (!state.trackingSide) state.trackingSide = selectSide(landmarks); const metrics = frameMetrics(landmarks, time, state.trackingSide); if (metrics.confidence >= .48) state.frames.push({ ...metrics, landmarks }); drawOverlay(metrics); }
      const progress = (time - start) / (end - start) * 100; $("#progressBar").style.width = `${progress}%`; $("#progressText").textContent = `分析 ${Math.min(100, Math.round(progress))}% · ${state.frames.length} 個可信樣本`; if (++index % 8 === 0) await new Promise(requestAnimationFrame);
    }
    if (!state.analyzing) return; state.reps = detectReps(state.frames); attachVisualProxy(); renderResults();
    $("#progressBar").style.width = "100%"; $("#progressText").textContent = `完成 · ${state.frames.length} 個可信樣本 · 追蹤 ${state.trackingSide === "left" ? "左側" : "右側"}`; $("#videoHud").hidden = false; $("#segmentKey").hidden = false; setStatus("分析完成");
  } catch (error) { console.error(error); setStatus("模型載入失敗"); $("#progressText").textContent = "無法載入模型，請確認網路後重試；影片沒有上傳。"; }
  finally { state.analyzing = false; $("#cancelButton").hidden = true; $("#analyzeButton").disabled = false; }
}

function attachVisualProxy() {
  const globalMin = Math.min(...state.frames.map(frame => frame.trunkAngle));
  state.frames.forEach(frame => { const active = state.reps.find(rep => frame.time >= rep.start && frame.time <= rep.end); const penalty = active ? clamp((active.trunkChange - 8) / 22, 0, 1) * 72 : 0; const phase = active ? Math.sin(Math.PI * clamp((frame.time - active.start) / Math.max(.1, active.end - active.start), 0, 1)) : 0; const angle = clamp((frame.trunkAngle - globalMin - 8) / 32, 0, 1); frame.roundProxy = clamp(penalty * phase + angle * 24, 0, 100); });
  state.reps.forEach(rep => { const samples = state.frames.filter(frame => frame.time >= rep.start && frame.time <= rep.end); rep.roundProxy = Math.round(Math.max(0, ...samples.map(frame => frame.roundProxy || 0))); });
}

function drawOverlay(frame) {
  if (!frame?.points) return; ctx.clearRect(0, 0, overlay.width, overlay.height); const point = value => ({ x: value.x * overlay.width, y: value.y * overlay.height });
  const shoulder = point(frame.points.shoulder), hip = point(frame.points.hip), knee = point(frame.points.knee), wrist = point(frame.points.wrist);
  ctx.lineCap = "round"; const segment = (a, b, color, width) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); };
  segment(shoulder, hip, "#35d9ff", 8); segment(hip, knee, "#67f7a5", 8);
  [shoulder, hip, knee].forEach((p, index) => { ctx.beginPath(); ctx.arc(p.x, p.y, index === 1 ? 10 : 7, 0, Math.PI * 2); ctx.fillStyle = index === 1 ? "#fff" : "#071114"; ctx.fill(); ctx.strokeStyle = index === 1 ? "#fff" : "#67f7a5"; ctx.lineWidth = 3; ctx.stroke(); });
  const radius = clamp(overlay.height * .085, 30, 84); ctx.beginPath(); ctx.moveTo(Math.max(0, wrist.x - radius * 1.8), wrist.y); ctx.lineTo(Math.min(overlay.width, wrist.x + radius * 2.8), wrist.y); ctx.strokeStyle = "#2ea8ff"; ctx.lineWidth = 6; ctx.stroke();
  ctx.beginPath(); ctx.arc(wrist.x + radius * 1.1, wrist.y, radius, 0, Math.PI * 2); ctx.fillStyle = "rgba(46,168,255,.18)"; ctx.fill(); ctx.strokeStyle = "#2ea8ff"; ctx.lineWidth = 7; ctx.stroke(); $("#hudBarHeight").textContent = `${frame.barRelativeHeight.toFixed(2)}×`;
}

function renderResults() {
  const reps = state.reps; $("#repCount").textContent = reps.length; $("#avgLift").textContent = reps.length ? mean(reps.map(rep => rep.liftSeconds)).toFixed(2) : "—"; $("#avgLower").textContent = reps.length ? mean(reps.map(rep => rep.lowerSeconds)).toFixed(2) : "—"; $("#confidence").textContent = state.frames.length ? `${Math.round(mean(state.frames.map(frame => frame.confidence)) * 100)}%` : "—";
  $("#repList").innerHTML = reps.length ? reps.map(rep => { const rounded = rep.roundProxy >= 50; return `<button class="rep-row" data-time="${rep.start}"><b>${rep.number}</b><strong class="${rounded ? "rounded" : "straight"}">${rounded ? "REVIEW" : "STABLE"}</strong><span>${rep.roundProxy}%</span><span>${rep.liftSeconds.toFixed(2)}s</span></button>`; }).join("") : `<div class="list-empty">未找到完整下—上—下週期。請確認雙手與槓片清楚，並縮短等待區段。</div>`;
  $("#csvButton").disabled = !reps.length; $("#jsonButton").disabled = !state.frames.length; document.querySelectorAll(".rep-row").forEach(button => button.addEventListener("click", () => { video.currentTime = +button.dataset.time; video.play(); })); drawCharts(video.currentTime || state.frames[0]?.time || 0); updatePlaybackData();
}

function canvasSetup(canvas, context, height = 148) { const dpr = devicePixelRatio || 1, width = Math.max(300, canvas.clientWidth || 600); canvas.width = width * dpr; canvas.height = height * dpr; context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height); return { width, height }; }
function drawBase(context, width, height, minY, maxY, formatter) { context.font = "10px Manrope"; context.textAlign = "right"; for (let row = 0; row <= 4; row++) { const y = 12 + row / 4 * (height - 30), value = maxY - row / 4 * (maxY - minY); context.strokeStyle = "rgba(150,170,175,.14)"; context.beginPath(); context.moveTo(34, y); context.lineTo(width - 6, y); context.stroke(); context.fillStyle = "#71878b"; context.fillText(formatter(value), 30, y + 3); } }
function linePath(context, values, width, height, minY, maxY, color) { if (values.length < 2) return; context.beginPath(); values.forEach((value, index) => { const x = 38 + index / (values.length - 1) * (width - 46), y = 12 + (maxY - value) / (maxY - minY) * (height - 30); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.strokeStyle = color; context.lineWidth = 3; context.stroke(); }
function drawPlayhead(context, width, height, time) { const start = state.frames[0].time, end = state.frames.at(-1).time, x = 38 + clamp((time - start) / Math.max(.01, end - start), 0, 1) * (width - 46); context.strokeStyle = "#fff"; context.lineWidth = 1.5; context.beginPath(); context.moveTo(x, 6); context.lineTo(x, height - 10); context.stroke(); context.fillStyle = "#fff"; context.beginPath(); context.arc(x, 7, 3.5, 0, Math.PI * 2); context.fill(); }
function drawRepBands(context, width, height) { const start = state.frames[0].time, end = state.frames.at(-1).time; state.reps.forEach(rep => { const x1 = 38 + (rep.start - start) / Math.max(.01, end - start) * (width - 46), x2 = 38 + (rep.end - start) / Math.max(.01, end - start) * (width - 46); context.fillStyle = rep.roundProxy >= 50 ? "rgba(255,112,98,.18)" : "rgba(73,213,123,.16)"; context.fillRect(x1, 6, Math.max(3, x2 - x1), height - 16); context.fillStyle = rep.roundProxy >= 50 ? "#ff7062" : "#49d57b"; context.font = "700 11px Manrope"; context.textAlign = "left"; context.fillText(String(rep.number), x1 + 5, 17); }); }

function drawCharts(time = 0) {
  if (!state.frames.length) return; const bs = canvasSetup(barCanvas, chartContexts.bar), rs = canvasSetup(roundCanvas, chartContexts.round), barMax = Math.max(1, ...state.frames.map(frame => frame.barRelativeHeight));
  drawRepBands(chartContexts.bar, bs.width, bs.height); drawBase(chartContexts.bar, bs.width, bs.height, 0, barMax, value => value.toFixed(1)); linePath(chartContexts.bar, state.frames.map(frame => frame.barRelativeHeight), bs.width, bs.height, 0, barMax, "#2ea8ff"); drawPlayhead(chartContexts.bar, bs.width, bs.height, time);
  const r = chartContexts.round; r.fillStyle = "rgba(255,112,98,.15)"; r.fillRect(38, 12, rs.width - 46, .5 * (rs.height - 30)); r.fillStyle = "rgba(73,213,123,.16)"; r.fillRect(38, 12 + .5 * (rs.height - 30), rs.width - 46, .5 * (rs.height - 30)); drawBase(r, rs.width, rs.height, 0, 100, value => `${Math.round(value)}%`); linePath(r, state.frames.map(frame => frame.roundProxy || 0), rs.width, rs.height, 0, 100, "#ff796d"); drawPlayhead(r, rs.width, rs.height, time); $("#chartTime").textContent = formatTime(time);
}
function nearestFrame(time) { return state.frames.reduce((best, frame) => !best || Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best, null); }
function updatePlaybackData() { if (!state.frames.length) return; const frame = nearestFrame(video.currentTime); if (!frame) return; drawOverlay(frame); drawCharts(video.currentTime); const rep = state.reps.find(item => video.currentTime >= item.start && video.currentTime <= item.end); $("#currentPhase").textContent = !rep ? "BETWEEN REPS" : video.currentTime <= rep.lockout ? `REP ${rep.number} · LIFT` : `REP ${rep.number} · LOWER`; $("#currentBar").textContent = frame.barRelativeHeight.toFixed(2); $("#currentRound").textContent = Math.round(frame.roundProxy || 0); }
function download(name, content, type) { const a = document.createElement("a"), url = URL.createObjectURL(new Blob([content], { type })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportCsv() { const header = "rep,start_s,lockout_s,end_s,lift_s,lower_s,bar_height_relative,visual_proxy_pct,confidence\n"; const rows = state.reps.map(rep => [rep.number, rep.start, rep.lockout, rep.end, rep.liftSeconds, rep.lowerSeconds, rep.peakBarHeight, rep.roundProxy, rep.confidence].map(value => typeof value === "number" ? value.toFixed(3) : value).join(",")).join("\n"); download("deadlift-reps.csv", header + rows, "text/csv;charset=utf-8"); }
function exportJson() { const frames = state.frames.map(({ landmarks, points, ...frame }) => frame); download("deadlift-analysis.json", JSON.stringify({ version: "2026-11-sync-v2", file: state.file?.name, trackingSide: state.trackingSide, note: "bar height and round-back visuals are unvalidated single-camera proxies", reps: state.reps, frames }, null, 2), "application/json"); }

$("#videoInput").addEventListener("change", event => setVideoFile(event.target.files[0])); [$("#startRange"), $("#endRange")].forEach(input => input.addEventListener("input", () => { if (+$("#startRange").value > +$("#endRange").value - .5) input.id === "startRange" ? $("#startRange").value = +$("#endRange").value - .5 : $("#endRange").value = +$("#startRange").value + .5; updateRange(); }));
$("#analyzeButton").addEventListener("click", analyze); $("#cancelButton").addEventListener("click", () => { state.analyzing = false; setStatus("分析已停止"); }); $("#csvButton").addEventListener("click", exportCsv); $("#jsonButton").addEventListener("click", exportJson); $("#guideButton").addEventListener("click", () => $("#guideDialog").showModal()); video.addEventListener("timeupdate", updatePlaybackData); video.addEventListener("seeked", updatePlaybackData); window.addEventListener("resize", () => state.frames.length && drawCharts(video.currentTime));
