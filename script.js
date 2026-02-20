let alreadyWon = false;

function clampInt(n, lo, hi) {
  n = Math.trunc(n);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function pctIntToProb(pctInt) {
  return clampInt(pctInt, 0, 100) / 100;
}

function $(id) {
  return document.getElementById(id);
}

function getInt(id) {
  return Math.trunc(Number($(id).value));
}
function setInt(id, value) {
  $(id).value = String(Math.trunc(value));
}

function expectedRolls(p) {
  if (p <= 0) return Infinity;
  return 1 / p;
}

function format2(n) {
  if (!isFinite(n)) return "∞";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function computeBestStrategy({ rollCost, baseChancePct, upgradeCost, upgradeInc }) {
  if (baseChancePct === 0 && upgradeInc === 0) {
    return { ok: false, error: "Chance is 0% and upgrades don’t increase chance. You can’t obtain the item." };
  }

  const maxUsefulUpgrades =
    upgradeInc > 0 ? Math.max(0, Math.ceil((100 - baseChancePct) / upgradeInc)) : 0;

  let best = null;

  for (let k = 0; k <= maxUsefulUpgrades; k++) {
    const perRollPct = clampInt(baseChancePct + k * upgradeInc, 0, 100);
    const p = pctIntToProb(perRollPct);

    const er = expectedRolls(p);
    if (!isFinite(er)) continue;

    const expectedScraps = k * upgradeCost + rollCost * er;

    const cand = { upgrades: k, perRollPct, expectedRollsReal: er, expectedScrapsReal: expectedScraps };

    if (!best) best = cand;
    else if (cand.expectedScrapsReal < best.expectedScrapsReal) best = cand;
    else if (cand.expectedScrapsReal === best.expectedScrapsReal && cand.upgrades < best.upgrades) best = cand;
  }

  if (!best) return { ok: false, error: "No strategy found." };

  const recommendation =
    best.upgrades === 0
      ? "Best move: roll only (no refinery upgrades)."
      : `Best move: buy ${best.upgrades} upgrade${best.upgrades === 1 ? "" : "s"}, then roll.`;

  const tierRates = [
    { tier: "T1", rate: 12 },
    { tier: "T2", rate: 16 },
    { tier: "T3", rate: 20 },
    { tier: "T4", rate: 25 }
  ];

  const hoursByTier = tierRates.map(t => ({
    tier: t.tier,
    hours: best.expectedScrapsReal / t.rate
  }));

  return {
    ok: true,
    upgrades: best.upgrades,
    perRollPct: best.perRollPct,
    expectedRolls: best.expectedRollsReal,       
    expectedScraps: best.expectedScrapsReal,      
    recommendation,
    hoursByTier
  };
}

function solve() {
  const rollCost = Math.max(0, getInt("rollCost"));
  const baseChanceInput = clampInt(getInt("baseChance"), 0, 100);
  const upgradeCost = Math.max(0, getInt("upgradeCost"));
  const upgradeInc = Math.max(0, getInt("upgradeInc"));

  const baseChanceUsed = alreadyWon ? Math.floor(baseChanceInput / 2) : baseChanceInput;

  setInt("rollCost", rollCost);
  setInt("baseChance", baseChanceInput);
  setInt("upgradeCost", upgradeCost);
  setInt("upgradeInc", upgradeInc);

  const res = computeBestStrategy({ rollCost, baseChancePct: baseChanceUsed, upgradeCost, upgradeInc });
  if (!res.ok) return res;

  return { ...res, baseChanceUsed };
}

function render(res) {
  const box = $("result");

  if (!res.ok) {
    box.innerHTML = `<div class="big">Error</div><div>${res.error}</div>`;
    return;
  }

  const penaltyNote = alreadyWon
    ? `<div style="margin-top:8px;color:#4b4b4b;">Already won is ON → base chance used: <span class="mono">${res.baseChanceUsed}%</span></div>`
    : "";

  const tierRows = res.hoursByTier.map(x => `
    <div class="tierRow">
      <span class="mono">${x.tier}</span>
      <span class="mono">${format2(x.hours)} hours</span>
    </div>
  `).join("");

  box.innerHTML = `
    <div class="big">${res.recommendation}</div>

    <div class="split">
      <div class="miniBox">
        <div class="miniTitle">Odds + Cost</div>
        <div class="mono">Chance per roll after upgrades: ${res.perRollPct}%</div>
        <div class="mono" style="margin-top:6px">Expected rolls: ${format2(res.expectedRolls)}</div>
        <div class="mono" style="margin-top:6px">Expected scraps: ${format2(res.expectedScraps)}</div>
        ${penaltyNote}
      </div>

      <div class="miniBox">
        <div class="miniTitle">Hours needed (scraps/hour)</div>
        <div class="tierList">
          ${tierRows}
        </div>
      </div>
    </div>
  `;
}

function setAlreadyWonUI() {
  const btn = $("alreadyWonBtn");
  const pill = $("alreadyWonState");
  btn.setAttribute("aria-pressed", alreadyWon ? "true" : "false");
  pill.textContent = alreadyWon ? "YES" : "NO";
  pill.classList.toggle("on", alreadyWon);
}

function resetDefaults() {
  setInt("rollCost", 250);
  setInt("baseChance", 40);
  setInt("upgradeCost", 51);
  setInt("upgradeInc", 5);
  alreadyWon = false;
  setAlreadyWonUI();
}

document.addEventListener("DOMContentLoaded", () => {
  $("calcBtn").addEventListener("click", () => render(solve()));
  $("resetBtn").addEventListener("click", () => { resetDefaults(); render(solve()); });
  $("alreadyWonBtn").addEventListener("click", () => { alreadyWon = !alreadyWon; setAlreadyWonUI(); render(solve()); });

  setAlreadyWonUI();
  render(solve());
});
