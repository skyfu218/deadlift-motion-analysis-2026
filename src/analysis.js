const IDX = {
  leftShoulder: 11, rightShoulder: 12, leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

export function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const denom = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!denom) return 0;
  return Math.acos(clamp((ab.x * cb.x + ab.y * cb.y) / denom, -1, 1)) * 180 / Math.PI;
}

export function selectSide(landmarks) {
  const score = side => ["Shoulder", "Hip", "Knee", "Ankle"].reduce((sum, part) => {
    const point = landmarks[IDX[`${side}${part}`]];
    return sum + (point?.visibility ?? 0);
  }, 0);
  return score("left") >= score("right") ? "left" : "right";
}

export function frameMetrics(landmarks, time) {
  const side = selectSide(landmarks);
  const shoulder = landmarks[IDX[`${side}Shoulder`]];
  const hip = landmarks[IDX[`${side}Hip`]];
  const knee = landmarks[IDX[`${side}Knee`]];
  const ankle = landmarks[IDX[`${side}Ankle`]];
  const confidence = mean([shoulder, hip, knee, ankle].map(p => p?.visibility ?? 0));
  const trunkFromVertical = Math.abs(Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * 180 / Math.PI);
  return {
    time, side, confidence,
    hipY: hip.y,
    shoulderY: shoulder.y,
    hipAngle: angle(shoulder, hip, knee),
    kneeAngle: angle(hip, knee, ankle),
    trunkAngle: clamp(trunkFromVertical, 0, 90),
  };
}

export function smooth(values, radius = 2) {
  return values.map((_, index) => mean(values.slice(Math.max(0, index - radius), index + radius + 1)));
}

export function detectReps(frames) {
  if (frames.length < 8) return [];
  const valid = frames.filter(frame => frame.confidence >= 0.45);
  if (valid.length < 8) return [];
  const hipY = smooth(valid.map(frame => frame.hipY), 2);
  const min = Math.min(...hipY);
  const max = Math.max(...hipY);
  const range = max - min;
  if (range < 0.035) return [];
  const top = min + range * 0.32;
  const bottom = min + range * 0.7;
  const reps = [];
  let phase = "bottom";
  let onset = null;
  let peak = null;

  valid.forEach((frame, index) => {
    const value = hipY[index];
    if (phase === "bottom" && value <= top) {
      onset = Math.max(0, index - 1);
      peak = index;
      phase = "top";
    } else if (phase === "top") {
      if (value < hipY[peak]) peak = index;
      if (value >= bottom && onset !== null) {
        const start = Math.max(0, onset - 1);
        const end = index;
        const segment = valid.slice(start, end + 1);
        const liftFrames = valid.slice(start, peak + 1);
        const loweringFrames = valid.slice(peak, end + 1);
        const trunk = segment.map(item => item.trunkAngle);
        const trunkSpread = Math.max(...trunk) - Math.min(...trunk);
        reps.push({
          number: reps.length + 1,
          start: valid[start].time,
          lockout: valid[peak].time,
          end: valid[end].time,
          liftSeconds: valid[peak].time - valid[start].time,
          lowerSeconds: valid[end].time - valid[peak].time,
          minHipAngle: Math.min(...segment.map(item => item.hipAngle)),
          minKneeAngle: Math.min(...segment.map(item => item.kneeAngle)),
          peakTrunkAngle: Math.max(...trunk),
          trunkChange: trunkSpread,
          confidence: mean(segment.map(item => item.confidence)),
          samples: segment.length,
        });
        onset = null;
        peak = null;
        phase = "bottom";
      }
    }
  });
  return reps.filter(rep => rep.end - rep.start >= 0.65);
}

export function stabilityLabel(rep) {
  if (rep.confidence < 0.55) return { label: "證據不足", tone: "muted" };
  if (rep.trunkChange <= 12) return { label: "軀幹角度穩定", tone: "good" };
  if (rep.trunkChange <= 22) return { label: "角度有變化", tone: "warn" };
  return { label: "建議人工複核", tone: "alert" };
}
