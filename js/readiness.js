// body-tracker/js/readiness.js
// Recovery Clocks：把「最近練了什麼」換算成 5 個恢復時鐘的就緒度，
// 再結合今日自律神經訊號（HRV/睡眠/壓力/電量）給出「今天適合的任務」。
//
// 概念整理自 JRS「Recovery Clocks」：恢復不是一個「總恢復時間」，而是多個系統以不同速度
// 沿不同軌跡回復；Feeling Recovered ≠ System Recovered、Ready = compatible with next task。
// ⚠️ 各時鐘的「恢復天數」是示意估計（文章明講 recovery is conditional/task-dependent），
//    非文獻標準值；會再依強度與當日自律神經訊號調整。
//
// 純函式、零相依，Node 與瀏覽器共用（結尾同時支援 module.exports 與 window.Readiness）。

const Calc = (typeof require !== 'undefined') ? require('./calc.js')
           : (typeof window !== 'undefined' ? window.Calc : null);

// 5 個時鐘（顯示順序）
const CLOCKS = [
  { key: 'fuel',          name: 'Fuel 能量',            icon: '⛽' },
  { key: 'muscle',        name: 'Muscle 肌肉',          icon: '💪' },
  { key: 'neuromuscular', name: 'Neuro 神經肌肉',       icon: '⚡' },
  { key: 'tissue',        name: 'Tissue 結締組織',      icon: '🦴' },
  { key: 'coordination',  name: 'Coordination 協調',    icon: '🎯' },
];

// 訓練類型中文
const SESSION_ZH = {
  rest: '休息', easy: 'easy 有氧', long: '長跑', threshold: '閾值',
  interval: '高強度間歇', sprint: '衝刺/爆發', strength: '重量訓練',
};

// 訓練類型 → 各時鐘的「恢復天數」示意估計（只列會被該訓練壓到的時鐘）。
// 依 JRS 文章的相對描述：衝刺/爆發壓神經肌肉與結締組織最久；長跑壓能量/組織/協調；重量壓肌肉/組織。
const SESSION_COST = {
  rest:      {},
  easy:      { fuel: 0.5 },
  long:      { fuel: 1,   muscle: 1.5, tissue: 2,   coordination: 1.5 },
  threshold: { fuel: 1,   muscle: 1,   neuromuscular: 1 },
  interval:  { fuel: 1,   muscle: 1.5, neuromuscular: 2, tissue: 1.5 },
  sprint:    { muscle: 1.5, neuromuscular: 3, tissue: 3, coordination: 2 },
  strength:  { muscle: 2.5, neuromuscular: 2, tissue: 2.5 },
};

// 強度 → 恢復天數縮放
const INTENSITY_SCALE = { light: 0.7, normal: 1, hard: 1.3 };

const DEFAULTS = {
  greenAt: 85,          // 就緒度 >= 綠燈
  yellowAt: 60,         // >= 黃燈，否則紅燈
  lookbackDays: 5,      // 只看最近幾天的訓練
  autonomicSlowPoor: 1.3,  // 自律神經「差」時恢復放慢倍率
  autonomicSlowOk: 1.1,    // 自律神經「普通」時輕度放慢
};

function num(v) { if (v === '' || v == null) return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function daysBetween(today, date) {
  return Math.round((Calc.parseLocalDate(today) - Calc.parseLocalDate(date)) / 86400000);
}

// 自律神經層（沿用 index.html 原本 computedReadiness 的門檻）→ {status,signals,good,bad,n}
function autonomicLayer(todayDaily) {
  todayDaily = todayDaily || {};
  const hrvStatus = todayDaily.hrv_status || null;
  const sleep = num(todayDaily.sleep_score);
  const stress = num(todayDaily.avg_stress);
  const battery = num(todayDaily.body_battery);
  let good = 0, bad = 0, n = 0; const signals = [];
  const HRV_ZH = { LOW: '偏低', UNBALANCED: '失衡', POOR: '差' };
  if (hrvStatus) { n++; if (hrvStatus === 'BALANCED' || hrvStatus === 'GOOD') good++; else { bad++; signals.push('HRV' + (HRV_ZH[hrvStatus] || hrvStatus)); } }
  if (sleep != null) { n++; if (sleep >= 80) good++; else if (sleep < 60) { bad++; signals.push('睡眠' + Math.round(sleep)); } }
  if (stress != null) { n++; if (stress <= 30) good++; else if (stress > 50) { bad++; signals.push('壓力' + Math.round(stress)); } }
  if (battery != null) { n++; if (battery >= 70) good++; else if (battery < 40) { bad++; signals.push('電量' + Math.round(battery)); } }
  let status = 'unknown';
  if (n > 0) { if (bad >= 2) status = 'poor'; else if (good >= 2 && bad === 0) status = 'good'; else status = 'ok'; }
  return { status, signals, good, bad, n };
}

// 主函式：input = { today:'YYYY-MM-DD', training:[{date,session,intensity}], daily:[...], opts:{} }
function recoveryClocks(input) {
  input = input || {};
  const o = Object.assign({}, DEFAULTS, input.opts || {});
  const today = input.today;
  const training = input.training || [];
  const daily = input.daily || [];
  const todayDaily = daily.find(d => String(d.date).slice(0, 10) === today) || {};

  const auto = autonomicLayer(todayDaily);
  const slow = auto.status === 'poor' ? o.autonomicSlowPoor
             : auto.status === 'ok' ? o.autonomicSlowOk : 1;

  // 最近 lookbackDays 天內、且類型有效的訓練
  const recent = training
    .map(t => ({ date: String(t.date).slice(0, 10), session: t.session, intensity: t.intensity || 'normal' }))
    .filter(t => SESSION_COST[t.session] && t.date <= today)
    .filter(t => { const d = daysBetween(today, t.date); return d >= 0 && d <= o.lookbackDays; });

  // 每個時鐘取「最被壓的那筆」（最低就緒度）
  const state = {};
  CLOCKS.forEach(c => state[c.key] = { readiness: 100, stressedBy: null, elapsedDays: null });
  recent.forEach(t => {
    const cost = SESSION_COST[t.session];
    const iscale = INTENSITY_SCALE[t.intensity] || 1;
    const elapsed = daysBetween(today, t.date);
    Object.entries(cost).forEach(([clock, baseDays]) => {
      const recDays = baseDays * iscale * slow;
      const readiness = recDays <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((elapsed / recDays) * 100)));
      if (readiness < state[clock].readiness) state[clock] = { readiness, stressedBy: t.session, elapsedDays: elapsed };
    });
  });

  const statusOf = r => r >= o.greenAt ? 'green' : (r >= o.yellowAt ? 'yellow' : 'red');
  const clocks = CLOCKS.map(c => {
    const s = state[c.key];
    return {
      key: c.key, name: c.name, icon: c.icon,
      readiness: s.readiness,
      status: s.stressedBy ? statusOf(s.readiness) : 'green',
      stressedBy: s.stressedBy, stressedByZh: s.stressedBy ? SESSION_ZH[s.stressedBy] : null,
      elapsedDays: s.elapsedDays,
    };
  });

  const low = key => state[key].readiness < o.yellowAt;   // 紅
  const verdict = buildVerdict({ clocks, auto, hasTraining: recent.length > 0, low });
  return { clocks, autonomic: auto, verdict, hasTraining: recent.length > 0 };
}

// 每個時鐘未恢復時，今天該避免的任務
const AVOID_BY_CLOCK = {
  fuel:          ['長時間高強度'],
  muscle:        ['重量訓練', '下坡/離心'],
  neuromuscular: ['max 衝刺', '高速間歇', 'plyo'],
  tissue:        ['衝刺/跳躍', '下坡/高衝擊'],
  coordination:  ['高技術/高速動作'],
};

function buildVerdict({ clocks, auto, hasTraining, low }) {
  if (auto.status === 'poor') {
    return {
      level: 'rest', title: '🔴 今天以恢復為主',
      detail: '自律神經訊號偏差（' + (auto.signals.join('、') || '—') + '）→ 全身系統恢復都會變慢。今天別排高強度，睡好、補足營養。',
      avoid: ['高強度間歇', '衝刺/爆發', '重量訓練'],
    };
  }
  if (!hasTraining) {
    return {
      level: 'unknown', title: '🟡 尚無近期訓練紀錄',
      detail: '到「記錄」頁點一下昨天／今天練了什麼，這裡就會依 5 個時鐘算出今天適合的強度。目前只顯示自律神經層。',
      avoid: [],
    };
  }
  // 動態組「該避免的任務」：涵蓋所有紅燈時鐘
  const reds = clocks.map(c => c.key).filter(low);
  const avoid = [];
  reds.forEach(k => (AVOID_BY_CLOCK[k] || []).forEach(a => { if (!avoid.includes(a)) avoid.push(a); }));

  const explosive = reds.some(k => k === 'neuromuscular' || k === 'tissue' || k === 'coordination');
  if (explosive) {
    return {
      level: 'easy', title: '🔴 避開高速與高衝擊',
      detail: '神經肌肉／結締組織／協調還沒回來 → 今天別排 max sprint、plyo、下坡衝刺或高速間歇。適合 easy 有氧、技術／活動度，或休息。',
      avoid,
    };
  }
  if (reds.includes('muscle')) {
    return {
      level: 'easy', title: '🟡 肌肉尚在修復',
      detail: 'Muscle 時鐘還沒回來 → 避免重量訓練、大量離心／下坡。輕鬆有氧或技術可以。',
      avoid,
    };
  }
  if (reds.includes('fuel')) {
    return {
      level: 'moderate', title: '🟡 先把能量補回來',
      detail: 'Fuel 時鐘偏低 → 補足碳水，今天以 easy～中等為主，別空腹拼強度。',
      avoid,
    };
  }
  const anyYellow = clocks.some(c => c.status === 'yellow');
  if (anyYellow || auto.status === 'ok') {
    return {
      level: 'moderate', title: '🟡 中等強度可，收斂高衝擊',
      detail: '大致恢復但仍有系統在半路 → 中等強度沒問題，高速／高衝擊／大重量再緩一天。',
      avoid: ['max 衝刺', '大重量'],
    };
  }
  return {
    level: 'ready', title: '✅ 系統都回來了，適合關鍵課',
    detail: '5 個時鐘都綠、自律神經良好 → 今天適合安排關鍵訓練（高強度間歇、衝刺、重量都行）。',
    avoid: [],
  };
}

const readinessApi = { recoveryClocks, autonomicLayer, CLOCKS, SESSION_COST, SESSION_ZH, INTENSITY_SCALE, DEFAULTS };
if (typeof module !== 'undefined') { module.exports = readinessApi; }
if (typeof window !== 'undefined') { window.Readiness = readinessApi; }
