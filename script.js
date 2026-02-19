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

function getInt(id) {
  return Math.trunc(Number(document.getElementById(id).value));
}
function setInt(id, value) {
  document.getElementById(id).value = String(Math.trunc(value));
}

function expectedRolls(p) {
  if (p <= 0) return Infinity;
  return 1 / p;
}

function computeBestStrat({ rollCost, baseChancePct, upgradeCost, upgradeInc, maxUpgrades }) {
    if (baseChancePct === 0 && upgradeInc === 0) {
        return { ok: false, error: "Chance is 0% & upgrades don't increase chance :p"};
    } else {
        maxUsefulUpgrades = 0;
    }

    let best = null;

    for (let k = 0; k <= maxUsefulUpgrades; k++) {
        const perRollPct = clampInt()
    }
}

function solve() {
  const rollCost = Math.max(0, getInt("rollCost"));
  const baseChancePct = clampInt(getInt("baseChance"), 0, 100);
  const upgradeCost = Math.max(0, getInt("upgradeCost"));
  const upgradeInc = Math.max(0, getInt("upgradeInc"));
  const maxUpgrades = Math.max(0, getInt("maxUpgrades"));

  setInt("rollCost", rollCost);
  setInt("baseChance", baseChancePct);
  setInt("upgradeCost", upgradeCost);
  setInt("upgradeInc", upgradeInc);
  setInt("maxUpgrades", maxUpgrades);

  if (baseChancePct === 0 && upgradeInc === 0) {
    return { ok: false, error: "Chance is 0% and refinery doesn’t increase chance. You can’t obtain the item." };
  }

  let best = null;

  const maxUsefulUpgrades =
    upgradeInc === 0
      ? maxUpgrades
      : Math.min(maxUpgrades, Math.max(0, Math.ceil((100 - baseChancePct) / upgradeInc)));

  for (let k = 0; k <= maxUsefulUpgrades; k++) {
    const perRollPct = clampInt(baseChancePct + k * upgradeInc, 0, 100);
    const p = pctIntToProb(perRollPct);

    const er = expectedRolls(p);
    if (!isFinite(er)) continue;

    const expectedScraps = k * upgradeCost + rollCost * er;

    const cand = {
      upgrades: k,
      perRollPct,
      expectedRollsReal: er,
      expectedScrapsReal: expectedScraps
    };

    if (!best) best = cand;
    else if (cand.expectedScrapsReal < best.expectedScrapsReal) best = cand;
    else if (cand.expectedScrapsReal === best.expectedScrapsReal && cand.upgrades < best.upgrades) best = cand;
  }

  if (!best) {
    return { ok: false, error: "No strategy found." };
  }

  const expectedRollsCeil = Math.ceil(best.expectedRollsReal);
  const scrapsUsingCeilRolls = best.upgrades * upgradeCost + expectedRollsCeil * rollCost;
  const totalScrapsWhole = Math.ceil(scrapsUsingCeilRolls);

  const tierPayouts = [

    { tier: "T1", payout: 12 },
    { tier: "T2", payout: 16 },
    { tier: "T3", payout: 20 },
    { tier: "T4", payout: 25 }
  ];

  const projectsByTier = tierPayouts.map(t => {
    const projects = Math.ceil(totalScrapsWhole / t.payout);
    return { tier: t.tier, projects };
  });

  const recommendation =
    best.upgrades === 0
      ? "Best move: roll only (no refinery upgrades)."
      : `Best move: buy ${best.upgrades} refinery upgrade${best.upgrades === 1 ? "" : "s"}, then roll.`;

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

function render(res) {
  const box = document.getElementById("result");

  if (!res.ok) {
    box.innerHTML = `<div class="big">Error</div><div>${res.error}</div>`;
    return;
  }

  const projectsLine = res.projectsByTier
    .map(x => `${x.tier}: ${x.projects} projects`)
    .join(", ");

  box.innerHTML = `
    <div class="big">${res.recommendation}</div>
    <div class="mono">
      Chance per roll after upgrades: ${res.perRollPct}%
    </div>
    <div class="mono" style="margin-top:8px">
      Expected rolls (rounded up): ${res.expectedRolls}<br/>
      Expected scraps needed (whole): ${res.totalScraps}
    </div>
    <div style="margin-top:10px">
      <b>Projects needed by tier</b> (rounded up):<br/>
      <span class="mono">${projectsLine}</span>
    </div>
  `;
}

function resetDefaults() {
  setInt("rollCost", 250);
  setInt("baseChance", 40);
  setInt("upgradeCost", 51);
  setInt("upgradeInc", 5);
  setInt("maxUpgrades", 200);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("calcBtn").addEventListener("click", () => render(solve()));
  document.getElementById("resetBtn").addEventListener("click", () => { resetDefaults(); render(solve()); });
  render(solve());
});
