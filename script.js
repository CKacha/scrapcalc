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

  const expectedRollsCeil = Math.ceil(best.expectedRollsReal);
  const totalScrapsWhole = best.upgrades * upgradeCost + expectedRollsCeil * rollCost;

  const tierPayouts = [
    { tier: "T1", payout: 12 },
    { tier: "T2", payout: 16 },
    { tier: "T3", payout: 20 },
    { tier: "T4", payout: 25 }
  ];

  const projectsByTier = tierPayouts.map(t => ({
    tier: t.tier,
    projects: Math.ceil(totalScrapsWhole / t.payout)
  }));

  const recommendation =
    best.upgrades === 0
      ? "Best move: roll only (no refinery upgrades)."
      : `Best move: buy ${best.upgrades} upgrade${best.upgrades === 1 ? "" : "s"}, then roll until you hit.`;

  return {
    ok: true,
    upgrades: best.upgrades,
    perRollPct: best.perRollPct,
    expectedRolls: expectedRollsCeil,
    totalScraps: totalScrapsWhole,
    projectsByTier,
    recommendation
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

  const projectsLine = res.projectsByTier.map(x => `${x.tier}: ${x.projects}`).join(", ");

  const penaltyNote = alreadyWon
    ? `<div style="margin-top:8px;color:#4b4b4b;">Already won is ON → base chance used: <span class="mono">${res.baseChanceUsed}%</span></div>`
    : "";

  box.innerHTML = `
    <div class="big">${res.recommendation}</div>
    <div class="mono">Chance per roll after upgrades: ${res.perRollPct}%</div>
    <div class="mono" style="margin-top:8px">
      Expected rolls (rounded up): ${res.expectedRolls}<br/>
      Expected scraps (whole): ${res.totalScraps}
    </div>
    ${penaltyNote}
    <div style="margin-top:10px">
      <b>Projects needed</b> (rounded up):<br/>
      <span class="mono">${projectsLine}</span>
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
  const required = ["calcBtn", "resetBtn", "alreadyWonBtn", "result"];
  for (const id of required) {
    if (!$(id)) console.error("Missing element id:", id);
  }

  $("calcBtn").addEventListener("click", () => render(solve()));
  $("resetBtn").addEventListener("click", () => { resetDefaults(); render(solve()); });
  $("alreadyWonBtn").addEventListener("click", () => { alreadyWon = !alreadyWon; setAlreadyWonUI(); render(solve()); });

  setAlreadyWonUI();
  render(solve());
});
