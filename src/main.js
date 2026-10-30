import "./styles.css";
import { FilesetResolver, PoseLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import { detectReps, frameMetrics, stabilityLabel } from "./analysis.js";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const state = { file: null, url: null, pose: null, frames: [], reps: [], analyzing: false, lastLandmarks: null };

document.querySelector("#app").innerHTML = `
  <a class="skip" href="#analysis">跳到分析區</a>
  <header class="topbar">
    <a class="brand" href="#top" aria-label="Deadlift Lab 首頁">
      <span class="brand-mark" aria-hidden="true"><i></i><b>DL</b></span>
      <span><strong>Deadlift Lab</strong><small>硬舉動作分析</small></span>
    </a>
    <div class="top-meta"><span class="privacy-dot">本機影片處理</span><button class="ghost" id="guideButton">拍攝指南</button></div>
  </header>
  <main id="top">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">SIDE-VIEW MOTION REVIEW</p>
        <h1>讓每一次硬舉，<br><em>都有跡可循。</em></h1>
        <p>從側面影片估算完整次數、起拉與下降節奏、髖膝角度及軀幹角度變化，協助教練與訓練者逐次回看。</p>
        <div class="hero-actions"><label class="button primary" for="videoInput">選擇硬舉影片</label><button class="button" id="demoGuide">先看拍攝方式</button></div>
        <input id="videoInput" type="file" accept="video/*" hidden>
      </div>
      <div class="hero-visual" aria-label="硬舉分析示意">
        <div class="scan-grid"></div><div class="plate plate-left"></div><div class="plate plate-right"></div><div class="bar"></div>
        <svg class="lift-line" viewBox="0 0 360 360" aria-hidden="true"><path d="M213 50L168 88L188 155L139 217L111 309M188 155L230 221L267 300M168 88L119 150L92 218M168 88L221 133L258 201"/><circle cx="213" cy="50" r="21"/></svg>
        <div class="metric-float"><span>動作區段</span><strong>逐次辨識</strong><small>節奏 × 角度 × 穩定度</small></div>
      </div>
    </section>

    <section class="workflow" aria-label="分析流程">
      <div class="step active"><b>01</b><span>載入影片<small>側面、全身入鏡</small></span></div>
      <div class="step"><b>02</b><span>設定區段<small>排除等待畫面</small></span></div>
      <div class="step"><b>03</b><span>本機分析<small>姿勢關鍵點估算</small></span></div>
      <div class="step"><b>04</b><span>逐次複核<small>匯出報告資料</small></span></div>
    </section>

    <section class="analysis-layout" id="analysis">
      <article class="stage-card">
        <div class="card-head"><div><p class="eyebrow">ANALYSIS STAGE</p><h2>影片與骨架回放</h2></div><span id="statusBadge" class="status">等待影片</span></div>
        <div class="video-shell" id="videoShell">
          <video id="video" playsinline controls preload="metadata"></video><canvas id="overlay"></canvas>
          <div class="empty-state" id="emptyState"><span class="upload-icon">↗</span><strong>放入一段側面硬舉影片</strong><p>建議 5–30 秒，讓全身與槓片完整入鏡。</p><label class="button primary compact" for="videoInput">瀏覽影片</label></div>
        </div>
        <div class="trim-panel">
          <div class="range-label"><span>分析區段</span><strong id="rangeText">00:00.0 — 00:00.0</strong></div>
          <div class="dual-range"><input id="startRange" type="range" min="0" max="100" value="0" step="0.1"><input id="endRange" type="range" min="0" max="100" value="100" step="0.1"></div>
          <div class="trim-actions"><button class="button primary" id="analyzeButton" disabled>開始本機分析</button><button class="button" id="cancelButton" hidden>停止分析</button><span id="progressText">尚未開始</span></div>
          <div class="progress"><i id="progressBar"></i></div>
        </div>
      </article>

      <aside class="results-panel">
        <div class="kpi-grid">
          <div class="kpi accent"><span>完整次數</span><strong id="repCount">—</strong><small>自動偵測</small></div>
          <div class="kpi"><span>平均起拉</span><strong id="avgLift">—</strong><small>秒</small></div>
          <div class="kpi"><span>平均下降</span><strong id="avgLower">—</strong><small>秒</small></div>
          <div class="kpi"><span>可信影格</span><strong id="confidence">—</strong><small>平均可見度</small></div>
        </div>
        <article class="result-card chart-card"><div class="card-title"><span>軀幹角度趨勢</span><small>相對垂直線估算</small></div><canvas id="trendCanvas" height="180"></canvas><div class="legend"><i></i>角度越大代表軀幹越接近水平；不是脊椎曲度。</div></article>
        <article class="result-card"><div class="card-title"><span>逐次分析</span><small id="repHint">完成分析後顯示</small></div><div id="repList" class="rep-list"><div class="list-empty">尚無分析結果</div></div></article>
        <div class="export-row"><button class="button" id="csvButton" disabled>匯出 CSV</button><button class="button" id="jsonButton" disabled>匯出 JSON</button></div>
      </aside>
    </section>

    <section class="limits">
      <div><p class="eyebrow">READ THE SIGNAL, KNOW THE LIMIT</p><h2>這是一把量動作的尺，<br>不是替你下結論的人。</h2></div>
      <div class="limit-grid">
        <article><b>01</b><strong>單鏡頭估算</strong><p>鏡位、遮擋、衣著與畫質都會改變關鍵點與角度結果。</p></article>
        <article><b>02</b><strong>穩定度不是傷害風險</strong><p>軀幹角度變化只供逐次比較，不等於腰椎曲度或安全診斷。</p></article>
        <article><b>03</b><strong>保留人工複核</strong><p>以原片逐格確認；結果不取代教練、醫療專業或正式裁判。</p></article>
      </div>
    </section>
  </main>

  <footer>
    <section class="sponsor">
      <img src="/society-brand-reference.png" alt="臺灣運動健康科技學會 Logo">
      <div><span>資助單位</span><strong>臺灣運動健康科技學會</strong><small>Taiwan Society of Sports and Health Technology</small></div>
      <div class="footer-meta"><span>版本更新｜2026 年 11 月</span><small>Browser-side motion review prototype</small></div>
    </section>
  </footer>

  <dialog id="guideDialog"><form method="dialog"><button class="dialog-close" aria-label="關閉">×</button><p class="eyebrow">RECORDING GUIDE</p><h2>拍攝一段可分析的影片</h2><div class="guide-grid"><div><b>1</b><strong>固定側面鏡位</strong><p>鏡頭與槓鈴移動方向垂直，避免斜拍。</p></div><div><b>2</b><strong>完整全身入鏡</strong><p>保留頭、肩、髖、膝、踝與槓片，不要切到腳。</p></div><div><b>3</b><strong>清楚對比</strong><p>光線充足、背景簡單，避免關節被器材或他人遮住。</p></div></div><button class="button primary" value="close">了解，開始拍攝</button></form></dialog>
`;

const $ = selector => document.querySelector(selector);
const video = $("#video");
const overlay = $("#overlay");
const ctx = overlay.getContext("2d");
const trendCanvas = $("#trendCanvas");
const trendCtx = trendCanvas.getContext("2d");

function formatTime(seconds = 0) {
  const min = Math.floor(seconds / 60).toString().padStart(2, "0");
  return `${min}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function setStatus(text, active = false) { $("#statusBadge").textContent = text; $("#statusBadge").classList.toggle("live", active); }
function updateRange() { $("#rangeText").textContent = `${formatTime(+$(`#startRange`).value)} — ${formatTime(+$(`#endRange`).value)}`; }

function setVideoFile(file) {
  if (!file) return;
  if (!file.type.startsWith("video/")) { alert("請選擇影片檔案。"); return; }
  if (state.url) URL.revokeObjectURL(state.url);
  state.file = file; state.url = URL.createObjectURL(file); video.src = state.url;
  $("#emptyState").hidden = true; setStatus("影片載入中", true);
  video.addEventListener("loadedmetadata", () => {
    const duration = video.duration || 0;
    [$("#startRange"), $("#endRange")].forEach(input => input.max = duration);
    $("#startRange").value = 0; $("#endRange").value = duration;
    overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    updateRange(); $("#analyzeButton").disabled = false; setStatus("影片已就緒");
    document.querySelectorAll(".step")[1].classList.add("active");
  }, { once: true });
}

async function ensurePose() {
  if (state.pose) return state.pose;
  $("#progressText").textContent = "正在載入姿勢模型（首次使用需要網路）";
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  state.pose = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO", numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  return state.pose;
}

const seek = time => new Promise(resolve => {
  const done = () => { video.removeEventListener("seeked", done); resolve(); };
  video.addEventListener("seeked", done); video.currentTime = Math.min(time, Math.max(0, video.duration - 0.001));
});

async function analyze() {
  if (!state.file || state.analyzing) return;
  const start = +$("#startRange").value, end = +$("#endRange").value;
  if (end - start < 1) { alert("分析區段至少需要 1 秒。"); return; }
  state.analyzing = true; state.frames = []; state.reps = [];
  $("#analyzeButton").disabled = true; $("#cancelButton").hidden = false; setStatus("分析中", true);
  document.querySelectorAll(".step")[2].classList.add("active");
  try {
    const pose = await ensurePose();
    const step = Math.max(0.1, (end - start) / 300);
    let index = 0;
    for (let time = start; time <= end && state.analyzing; time += step) {
      await seek(time);
      const result = pose.detectForVideo(video, Math.round(time * 1000));
      if (result.landmarks?.[0]) {
        const landmarks = result.landmarks[0]; state.lastLandmarks = landmarks;
        state.frames.push({ ...frameMetrics(landmarks, time), landmarks }); drawPose(landmarks);
      }
      const progress = (time - start) / (end - start) * 100;
      $("#progressBar").style.width = `${progress}%`;
      $("#progressText").textContent = `分析 ${Math.min(100, Math.round(progress))}% · 已取得 ${state.frames.length} 個姿勢樣本`;
      if (++index % 8 === 0) await new Promise(requestAnimationFrame);
    }
    if (!state.analyzing) return;
    state.reps = detectReps(state.frames);
    renderResults(); $("#progressBar").style.width = "100%"; $("#progressText").textContent = `完成 · ${state.frames.length} 個有效樣本`;
    setStatus("分析完成"); document.querySelectorAll(".step")[3].classList.add("active");
  } catch (error) {
    console.error(error); setStatus("模型載入失敗");
    $("#progressText").textContent = "無法載入姿勢模型。請確認網路後重試；影片沒有上傳。";
  } finally {
    state.analyzing = false; $("#cancelButton").hidden = true; $("#analyzeButton").disabled = false;
  }
}

function drawPose(landmarks) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const drawing = new DrawingUtils(ctx);
  drawing.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: "#78f0c6", lineWidth: 4 });
  drawing.drawLandmarks(landmarks, { color: "#ffb35c", radius: 3 });
}

function renderResults() {
  const reps = state.reps;
  $("#repCount").textContent = reps.length;
  $("#avgLift").textContent = reps.length ? (reps.reduce((s, r) => s + r.liftSeconds, 0) / reps.length).toFixed(2) : "—";
  $("#avgLower").textContent = reps.length ? (reps.reduce((s, r) => s + r.lowerSeconds, 0) / reps.length).toFixed(2) : "—";
  const avgConfidence = state.frames.length ? state.frames.reduce((s, f) => s + f.confidence, 0) / state.frames.length : 0;
  $("#confidence").textContent = `${Math.round(avgConfidence * 100)}%`;
  $("#repHint").textContent = reps.length ? `共 ${reps.length} 次；點擊可跳轉` : "未找到完整的下—上—下動作週期";
  $("#repList").innerHTML = reps.length ? reps.map(rep => {
    const status = stabilityLabel(rep);
    return `<button class="rep-row" data-time="${rep.start}"><span class="rep-no">${String(rep.number).padStart(2, "0")}</span><span><strong>${rep.liftSeconds.toFixed(2)}s <i>起拉</i> · ${rep.lowerSeconds.toFixed(2)}s <i>下降</i></strong><small>最低髖角 ${Math.round(rep.minHipAngle)}° · 軀幹變化 ${rep.trunkChange.toFixed(1)}°</small></span><em class="${status.tone}">${status.label}</em></button>`;
  }).join("") : `<div class="list-empty">未偵測到完整次數。請縮短等待區段、確認全身可見，或改用更正側面的影片。</div>`;
  $("#csvButton").disabled = !reps.length; $("#jsonButton").disabled = !state.frames.length;
  document.querySelectorAll(".rep-row").forEach(button => button.addEventListener("click", () => { video.currentTime = +button.dataset.time; video.play(); }));
  drawTrend();
}

function drawTrend() {
  const dpr = devicePixelRatio || 1, width = trendCanvas.clientWidth || 600, height = 180;
  trendCanvas.width = width * dpr; trendCanvas.height = height * dpr; trendCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  trendCtx.clearRect(0, 0, width, height); trendCtx.strokeStyle = "rgba(255,255,255,.08)"; trendCtx.lineWidth = 1;
  for (let y = 20; y < height; y += 40) { trendCtx.beginPath(); trendCtx.moveTo(0, y); trendCtx.lineTo(width, y); trendCtx.stroke(); }
  if (state.frames.length < 2) return;
  const values = state.frames.map(frame => frame.trunkAngle), max = Math.max(75, ...values), min = Math.min(0, ...values);
  trendCtx.beginPath(); values.forEach((value, index) => { const x = index / (values.length - 1) * width; const y = height - 18 - (value - min) / (max - min) * (height - 36); index ? trendCtx.lineTo(x, y) : trendCtx.moveTo(x, y); });
  trendCtx.strokeStyle = "#78f0c6"; trendCtx.lineWidth = 2.5; trendCtx.stroke();
}

function download(name, content, type) { const a = document.createElement("a"); const url = URL.createObjectURL(new Blob([content], { type })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportCsv() { const header = "rep,start_s,lockout_s,end_s,lift_s,lower_s,min_hip_deg,min_knee_deg,peak_trunk_deg,trunk_change_deg,confidence\n"; const rows = state.reps.map(r => [r.number, r.start, r.lockout, r.end, r.liftSeconds, r.lowerSeconds, r.minHipAngle, r.minKneeAngle, r.peakTrunkAngle, r.trunkChange, r.confidence].map(v => typeof v === "number" ? v.toFixed(3) : v).join(",")).join("\n"); download("deadlift-reps.csv", header + rows, "text/csv;charset=utf-8"); }
function exportJson() { const cleanFrames = state.frames.map(({ landmarks, ...frame }) => frame); download("deadlift-analysis.json", JSON.stringify({ version: "2026-11", file: state.file?.name, duration: video.duration, note: "single-camera unvalidated estimates", reps: state.reps, frames: cleanFrames }, null, 2), "application/json"); }

$("#videoInput").addEventListener("change", event => setVideoFile(event.target.files[0]));
[$("#startRange"), $("#endRange")].forEach(input => input.addEventListener("input", () => { if (+$("#startRange").value > +$("#endRange").value - .5) input.id === "startRange" ? $("#startRange").value = +$("#endRange").value - .5 : $("#endRange").value = +$("#startRange").value + .5; updateRange(); }));
$("#analyzeButton").addEventListener("click", analyze); $("#cancelButton").addEventListener("click", () => { state.analyzing = false; setStatus("分析已停止"); });
$("#csvButton").addEventListener("click", exportCsv); $("#jsonButton").addEventListener("click", exportJson);
[$("#guideButton"), $("#demoGuide")].forEach(button => button.addEventListener("click", () => $("#guideDialog").showModal()));
video.addEventListener("seeked", () => { if (!state.analyzing) { const nearest = state.frames.reduce((best, frame) => Math.abs(frame.time - video.currentTime) < Math.abs(best?.time - video.currentTime) ? frame : best, null); if (nearest?.landmarks) drawPose(nearest.landmarks); } });
window.addEventListener("resize", () => state.frames.length && drawTrend());
