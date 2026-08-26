// body-tracker/js/advice.js
// 規則式每日教練建議：零成本、可解釋。未來可加 LLM 潤飾為選配。
// 輸入近期彙整指標，輸出一句繁中建議。任何欄位可為 null/undefined。
const STABLE_DECLINE_KG_PER_WEEK = -0.2; // 週趨勢低於此值視為「穩定下降」

function dailyAdvice(m) {
  m = m || {};
  const poorRecovery =
    (m.sleepScore != null && m.sleepScore < 60) ||
    (m.avgStress != null && m.avgStress > 50) ||
    (m.bodyBattery != null && m.bodyBattery < 40);

  if (poorRecovery) {
    return '恢復不足（睡眠差／壓力高／電量低）→ 今天別排高強度、熱量缺口別拉太大，優先睡好。';
  }
  if (m.weightStalled) {
    return '體重均線卡住，但恢復正常 → 可能是鎖水非沒瘦，維持節奏、觀察 3–5 天再判斷。';
  }
  if (m.weightKgPerWeek != null && m.weightKgPerWeek < STABLE_DECLINE_KG_PER_WEEK) {
    return '均線穩定下降、恢復良好 → 目前節奏很好，維持。';
  }
  return '數據平穩 → 照常執行，記得補體重、偶爾量腰圍。';
}

// 變數名加前綴避免瀏覽器多個 <script> 共用全域作用域時撞名
const adviceApi = { dailyAdvice };
if (typeof module !== 'undefined') { module.exports = adviceApi; }
if (typeof window !== 'undefined') { window.Advice = adviceApi; }
