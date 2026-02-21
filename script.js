const GATE_KEY = "scraps_gate_decision";
let alreadyWon = false;

let warmupOpen = false;
let warmRolls = 0;
let warmScraps = 0;
let warmSpinning = false;

let strategyChart = null;

function $(id){ return document.getElementById(id); }

function clampInt(n, lo, hi){
  n = Math.trunc(n);
  if (Number.isNaN(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function toNum(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function pctIntToProb(pctInt){
  return clampInt(pctInt, 0, 100) / 100;
}

function format2(n){
  if (!Number.isFinite(n)) return "∞";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function showModal({ title, body, buttons }){
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = body;
  const btnWrap = $("modalBtns");
  btnWrap.innerHTML = "";
  for (const b of buttons){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = b.primary ? "btn primary" : "btn";
    btn.textContent = b.label;
    btn.addEventListener("click", () => {
      hideModal();
      if (b.onClick) b.onClick();
    });
    btnWrap.appendChild(btn);
  }
  $("modal").classList.remove("hidden");
}

function hideModal(){ $("modal").classList.add("hidden"); }

function setAlreadyWonUI(){
  const pill = $("alreadyWonState");
  $("alreadyWonBtn").setAttribute("aria-pressed", alreadyWon ? "true" : "false");
  pill.textContent = alreadyWon ? "YES" : "NO";
  pill.classList.toggle("on", alreadyWon);
}

function clearInputs(){
  $("rollCost").value = "";
  $("baseChance").value = "";
  $("upgradeCost").value = "";
  $("upgradeInc").value = "";
}

function expectedRolls(p){
  if (p <= 0) return Infinity;
  return 1 / p;
}

function computeBestStrategy({ rollCost, baseChancePct, upgradeCost, upgradeInc }){
  if (baseChancePct === 0 && upgradeInc === 0){
    return { ok:false, error:"Chance is 0% and upgrades don’t increase chance. You can’t obtain the item." };
  }

  const maxUsefulUpgrades =
    upgradeInc > 0 ? Math.max(0, Math.ceil((100 - baseChancePct) / upgradeInc)) : 0;

  let best = null;

  for (let k = 0; k <= maxUsefulUpgrades; k++){
    const perRollPct = clampInt(baseChancePct + k * upgradeInc, 0, 100);
    const p = pctIntToProb(perRollPct);
    const er = expectedRolls(p);
    if (!Number.isFinite(er)) continue;
    const expectedScraps = k * upgradeCost + rollCost * er;
    const cand = { upgrades:k, perRollPct, expectedRollsReal:er, expectedScrapsReal:expectedScraps };
    if (!best) best = cand;
    else if (cand.expectedScrapsReal < best.expectedScrapsReal) best = cand;
    else if (cand.expectedScrapsReal === best.expectedScrapsReal && cand.upgrades < best.upgrades) best = cand;
  }

  if (!best) return { ok:false, error:"No strategy found." };

  const recommendation =
    best.upgrades === 0
      ? "Best move: roll only (no refinery upgrades)."
      : `Best move: buy ${best.upgrades} upgrade${best.upgrades === 1 ? "" : "s"}, then roll.`;

  const tierRates = [
    { tier:"T1", rate:12 },
    { tier:"T2", rate:16 },
    { tier:"T3", rate:20 },
    { tier:"T4", rate:25 }
  ];

  const hoursByTier = tierRates.map(t => ({ tier: t.tier, hours: best.expectedScrapsReal / t.rate }));

  return {
    ok:true,
    upgrades: best.upgrades,
    perRollPct: best.perRollPct,
    expectedRolls: best.expectedRollsReal,
    expectedScraps: best.expectedScrapsReal,
    recommendation,
    hoursByTier,
    maxUsefulUpgrades
  };
}

function buildCurveData(rollCost, baseChancePct, upgradeCost, upgradeInc){
  const maxK = 25;
  const xs = [];
  const ys = [];
  for (let k = 0; k <= maxK; k++){
    const perRollPct = clampInt(baseChancePct + k * upgradeInc, 0, 100);
    const p = pctIntToProb(perRollPct);
    const er = expectedRolls(p);
    const expectedScrapsVal = Number.isFinite(er) ? (k * upgradeCost + rollCost * er) : null;
    xs.push(k);
    ys.push(expectedScrapsVal);
  }
  return { xs, ys };
}

function renderChart(curve, bestK){
  const empty = $("chartEmpty");
  const wrap = $("chartWrap");
  const canvas = $("strategyChart");
  if (!canvas) return;

  empty.classList.add("hidden");
  wrap.classList.remove("hidden");

  const dataPoints = curve.xs.map((k, i) => ({ x: k, y: curve.ys[i] })).filter(p => p.y !== null);

  if (!strategyChart){
    strategyChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        datasets: [
          { data: dataPoints, pointRadius: 2, tension: 0.2 },
          { data: [{ x: bestK, y: curve.ys[bestK] }], type:"scatter", pointRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 25,
            title: { display: true, text: "upgrades" },
            ticks: { stepSize: 1, precision: 0 }
          },
          y: { title: { display: true, text: "expected scraps" } }
        }
      }
    });
  } else {
    strategyChart.data.datasets[0].data = dataPoints;
    strategyChart.data.datasets[1].data = [{ x: bestK, y: curve.ys[bestK] }];
    strategyChart.options.scales.x.min = 0;
    strategyChart.options.scales.x.max = 25;
    strategyChart.options.scales.x.ticks.stepSize = 1;
    strategyChart.update();
  }
}

function resetChart(){
  const empty = $("chartEmpty");
  const wrap = $("chartWrap");
  empty.classList.remove("hidden");
  wrap.classList.add("hidden");
  if (strategyChart){
    strategyChart.destroy();
    strategyChart = null;
  }
}

function solveMain(){
  const rollCost = toNum($("rollCost").value);
  const baseChanceInput = toNum($("baseChance").value);
  const upgradeCost = toNum($("upgradeCost").value);
  const upgradeInc = toNum($("upgradeInc").value);

  if (![rollCost, baseChanceInput, upgradeCost, upgradeInc].every(Number.isFinite)){
    return { ok:false, error:"fill in all 4 inputs first." };
  }

  const rollCostI = Math.max(0, Math.trunc(rollCost));
  const baseChanceI = clampInt(baseChanceInput, 0, 100);
  const upgradeCostI = Math.max(0, Math.trunc(upgradeCost));
  const upgradeIncI = Math.max(0, Math.trunc(upgradeInc));

  const baseChanceUsed = alreadyWon ? Math.floor(baseChanceI / 2) : baseChanceI;

  const res = computeBestStrategy({
    rollCost: rollCostI,
    baseChancePct: baseChanceUsed,
    upgradeCost: upgradeCostI,
    upgradeInc: upgradeIncI
  });

  if (!res.ok) return res;
  return { ...res, baseChanceUsed, rollCostI, baseChanceI, upgradeCostI, upgradeIncI, baseChanceUsed };
}

function renderMain(res){
  const box = $("result");

  if (!res.ok){
    box.innerHTML = `<div class="big">nope</div><div class="mono">${res.error}</div>`;
    return;
  }

  const penaltyNote = alreadyWon
    ? `<div style="margin-top:8px;color:#555;">Already won is ON → base chance used: <span class="mono">${res.baseChanceUsed}%</span></div>`
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
        <div class="miniTitle">Odds + Expected Cost</div>
        <div class="mono">chance per roll after upgrades: ${res.perRollPct}%</div>
        <div class="mono" style="margin-top:6px">expected rolls: ${format2(res.expectedRolls)}</div>
        <div class="mono" style="margin-top:6px">expected scraps: ${format2(res.expectedScraps)}</div>
        ${penaltyNote}
      </div>
      <div class="miniBox">
        <div class="miniTitle">Hours needed (scraps/hour)</div>
        <div class="tierList">${tierRows}</div>
      </div>
    </div>
  `;
}

function setWarmStats(){
  $("warmRolls").textContent = String(warmRolls);
  $("warmScraps").textContent = String(warmScraps);
}

function warmReset(){
  warmRolls = 0;
  warmScraps = 0;
  $("warmLast").textContent = "—";
  setWarmStats();
  $("caseStrip").style.transform = `translateX(0px)`;
}

function buildCaseStrip(count){
  const strip = $("caseStrip");
  strip.innerHTML = "";
  for (let i = 0; i < count; i++){
    const n = (i % 100) + 1;
    const el = document.createElement("div");
    el.className = "caseNum";
    el.textContent = String(n);
    el.dataset.num = String(n);
    strip.appendChild(el);
  }
}

function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

function getCurrentTranslateX(el){
  const tr = window.getComputedStyle(el).transform;
  if (!tr || tr === "none") return 0;
  const m = tr.match(/matrix\(([^)]+)\)/);
  if (!m) return 0;
  const parts = m[1].split(",").map(s => Number(s.trim()));
  return parts.length >= 6 ? parts[4] : 0;
}

function openWarmup(){
  if (warmupOpen) return;
  warmupOpen = true;
  $("warmupArea").classList.add("open");
  buildCaseStrip(900);
}

function startWarmupFlow(){
  showModal({
    title: "warmup gambeling?",
    body: "you sure you wanna do the warmup thing?",
    buttons: [
      { label: "yes", primary: true, onClick: () => openWarmup() },
      { label: "no", onClick: () => showModal({ title: "oh welp :P", body: "ok then.", buttons: [{ label: "lol", primary: true }] }) }
    ]
  });
}

function getStepMetrics(){
  const strip = $("caseStrip");
  const first = strip.querySelector(".caseNum");
  if (!first) return { tileW: 64, gap: 10, pad: 12 };
  const tileW = first.getBoundingClientRect().width || 64;
  const gap = 10;
  const pad = 12;
  return { tileW, gap, pad };
}

async function spinCase(){
  if (!warmupOpen) openWarmup();
  if (warmSpinning) return;

  const chanceRaw = toNum($("warmChance").value);
  const costRaw = toNum($("warmCost").value);

  if (!Number.isFinite(chanceRaw) || !Number.isFinite(costRaw)){
    showModal({
      title: "missing numbers",
      body: "put in chance (%) and scraps per roll first.",
      buttons: [{ label: "ok", primary: true }]
    });
    return;
  }

  const chance = clampInt(chanceRaw, 0, 100);
  const rollCost = Math.max(0, Math.trunc(costRaw));

  const finalNumber = Math.floor(Math.random() * 100) + 1;

  warmRolls += 1;
  warmScraps += rollCost;
  setWarmStats();

  const strip = $("caseStrip");
  const tiles = Array.from(strip.children);
  if (tiles.length < 300) buildCaseStrip(900);

  const base = 720;
  let targetIndex = -1;
  for (let i = base; i < tiles.length; i++){
    if (Number(tiles[i].dataset.num) === finalNumber){
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) targetIndex = base;

  const windowEl = $("caseStrip").parentElement;
  const windowRect = windowEl.getBoundingClientRect();
  const pointerX = windowRect.width / 2;

  const { tileW, gap, pad } = getStepMetrics();
  const step = tileW + gap;

  const tileCenterX = (targetIndex * step) + (tileW / 2) + pad;
  const targetTranslate = pointerX - tileCenterX;

  const start = performance.now();
  const duration = 2400 + Math.random() * 900;
  const startX = getCurrentTranslateX(strip);

  warmSpinning = true;

  await new Promise(resolve => {
    function frame(now){
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      const x = startX + (targetTranslate - startX) * eased;
      strip.style.transform = `translateX(${x}px)`;
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });

  warmSpinning = false;

  $("warmLast").textContent = String(finalNumber);

  const win = finalNumber <= chance;
  if (win){
    showModal({
      title: "CONGRATS",
      body: `you obtained the item 🎉<br/><br/>
            rolls: <b>${warmRolls}</b><br/>
            scraps: <b>${warmScraps}</b><br/>
            landed: <b>${finalNumber}</b> (needed ≤ ${chance})`,
      buttons: [{ label: "nice", primary: true }]
    });
  } else {
    showModal({
      title: "rip",
      body: `nope 😭<br/>landed: <b>${finalNumber}</b> (needed ≤ ${chance})`,
      buttons: [{ label: "again", primary: true }]
    });
  }
}

function showGate(){
  $("gate").classList.add("show");
  $("nuh").classList.remove("show");
  $("app").style.display = "none";
}

function openApp(){
  $("gate").classList.remove("show");
  $("nuh").classList.remove("show");
  $("app").style.display = "grid";
}

function showNuh(){
  $("gate").classList.remove("show");
  $("app").style.display = "none";
  $("nuh").classList.add("show");
}

function initGate(){
  const decision = localStorage.getItem(GATE_KEY);
  if (decision === "yes"){ openApp(); return; }
  if (decision === "no"){ showNuh(); return; }
  showGate();
}

function resetAll(){
  clearInputs();
  alreadyWon = false;
  setAlreadyWonUI();
  $("result").innerHTML = `put numbers in → hit <b>Calculate</b>.`;
  resetChart();
}

document.addEventListener("DOMContentLoaded", () => {
  $("gateYes").addEventListener("click", () => {
    localStorage.setItem(GATE_KEY, "yes");
    openApp();
  });
  $("gateNo").addEventListener("click", () => {
    localStorage.setItem(GATE_KEY, "no");
    showNuh();
  });

  initGate();

  $("alreadyWonBtn").addEventListener("click", () => {
    alreadyWon = !alreadyWon;
    setAlreadyWonUI();
  });

  $("calcBtn").addEventListener("click", () => {
    const res = solveMain();
    renderMain(res);
    if (res.ok){
      const curve = buildCurveData(res.rollCostI, res.baseChanceUsed, res.upgradeCostI, res.upgradeIncI);
      renderChart(curve, res.upgrades);
    } else {
      resetChart();
    }
  });

  $("resetBtn").addEventListener("click", () => resetAll());

  $("warmupBtn").addEventListener("click", () => startWarmupFlow());
  $("warmRollBtn").addEventListener("click", () => spinCase());
  $("warmResetBtn").addEventListener("click", () => {
    $("warmChance").value = "";
    $("warmCost").value = "";
    warmReset();
  });

  resetAll();
  warmReset();
});


