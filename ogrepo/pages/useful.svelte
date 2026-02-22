<script lang="ts">
	type Pricing = {
		price: number;
		baseProbability: number;
		baseUpgradeCost: number;
		costMultiplier: number; // percent e.g. 105
		boostAmount: number; // % per upgrade
		rollCost: number;
	};

	type EVRow = {
		upgradeLevel: number;
		boostPercent: number;
		effectiveProbability: number; // displayed %
		actualWinChance: number; // actual % after house edge mapping
		rollCost: number;
		upgradeCostCumulative: number;
		expectedRolls: number;
		expectedRollCost: number;
		expectedTotalCost: number;
		evRatio: number;
	};

	type EVSummary = {
		results: EVRow[];
		bestPlayerLevel: number;
		bestPlayerCost: number;
		bestPlayerRatio: number;
		isExploitable: boolean;
		houseEdgePercent: number;
	};

	// --- constants from given
	const PHI = (1 + Math.sqrt(5)) / 2;
	const SCRAPS_PER_HOUR = PHI * 10;
	const DOLLARS_PER_HOUR = 4;
	const SCRAPS_PER_DOLLAR = SCRAPS_PER_HOUR / DOLLARS_PER_HOUR;

	// --- inputs (editable) ---
	let monetaryValue = 25; // USD
	let stockCount = 10;

	let priceOverrideEnabled = false;
	let priceOverride = 0;

	let rollCostOverrideEnabled = false;
	let rollCostOverride: number | null = null;

	// for manual tweaking after "optimal" (optional)
	let manualMode = false;
	let manual_price = 0;
	let manual_baseProbability = 50;
	let manual_baseUpgradeCost = 1;
	let manual_costMultiplier = 105;
	let manual_boostAmount = 1;

	// --- core logic (matches your pasted functions) ---

	// Must match backend calculateRollCost exactly
	function calculateRollCost(
		basePrice: number,
		effectiveProbability: number,
		rollCostOverrideValue?: number | null,
		baseProbability?: number
	): number {
		if (rollCostOverrideValue != null && rollCostOverrideValue > 0) {
			return rollCostOverrideValue;
		}
		const baseProb = baseProbability ?? effectiveProbability;
		return Math.max(1, Math.round(basePrice * (baseProb / 100)));
	}

	// Must match backend computeRollThreshold exactly
	// 15% house edge: displayed 50% → actual 42%, displayed 100% → actual 85%
	function computeRollThreshold(probability: number): number {
		return Math.max(1, Math.floor((probability * 17) / 20));
	}

	// Must match backend calculateShopItemPricing exactly
	function calculatePricing(monetaryValueUSD: number, stockCountValue: number, overridePrice?: number) {
		const price = overridePrice ?? Math.round(monetaryValueUSD * SCRAPS_PER_DOLLAR);

		const priceRarityFactor = Math.max(0, 1 - monetaryValueUSD / 100);
		const stockRarityFactor = Math.min(1, stockCountValue / 20);
		const baseProbability = Math.max(
			1,
			Math.min(80, Math.round((priceRarityFactor * 0.4 + stockRarityFactor * 0.6) * 80))
		);

		const rollCost = Math.max(1, Math.round(price * (baseProbability / 100)));

		const probabilityGap = 100 - baseProbability;
		const targetUpgrades = Math.max(5, Math.min(20, Math.ceil(monetaryValueUSD / 5)));
		const boostAmount = Math.max(1, Math.round(probabilityGap / targetUpgrades));

		// Upgrades start at 25% of item price and decay by 1.05x per level
		const baseUpgradeCost = Math.max(1, Math.floor(price * 0.25));
		const costMultiplier = 105;

		return { price, baseProbability, baseUpgradeCost, costMultiplier, boostAmount, rollCost };
	}

	function simulateEV(
		price: number,
		baseProbability: number,
		baseUpgradeCost: number,
		costMultiplier: number,
		boostAmount: number,
		rollCostOverrideValue?: number | null
	): EVSummary {
		const results: EVRow[] = [];

		const probabilityGap = 100 - baseProbability;
		const maxUpgrades = boostAmount > 0 ? Math.ceil(probabilityGap / boostAmount) : 0;

		let bestLevel = 0;
		let bestCost = Infinity;

		for (let k = 0; k <= maxUpgrades; k++) {
			const boostPercent = k * boostAmount;
			const effectiveProbability = Math.min(baseProbability + boostPercent, 100);

			const rollCost = calculateRollCost(
				price,
				effectiveProbability,
				rollCostOverrideValue ?? null,
				baseProbability
			);

			// Cumulative upgrade cost (decaying series, capped)
			// NOTE: your earlier comment blocks disagree on budget (2x vs 3x).
			// This function uses 2.0× to match the code you pasted.
			const maxBudget = price * 2;
			let upgradeCostCumulative = 0;
			let budgetExhausted = false;

			for (let i = 0; i < k; i++) {
				// Your pasted EV sim uses fixed series based on price * 0.25 / 1.05^i
				const ucost = Math.max(1, Math.floor(price * 0.25 / Math.pow(1.05, i)));
				if (upgradeCostCumulative + ucost > maxBudget) {
					upgradeCostCumulative = maxBudget;
					budgetExhausted = true;
					break;
				}
				upgradeCostCumulative += ucost;
			}
			if (budgetExhausted) break;

			// Actual win chance after house edge mapping
			const actualThreshold = computeRollThreshold(effectiveProbability); // integer percent
			const actualWinChance = actualThreshold / 100;

			const expectedRolls = actualWinChance > 0 ? 1 / actualWinChance : Infinity;
			const expectedRollCost = rollCost * expectedRolls;
			const expectedTotalCost = upgradeCostCumulative + expectedRollCost;
			const evRatio = price > 0 ? expectedTotalCost / price : Infinity;

			const row: EVRow = {
				upgradeLevel: k,
				boostPercent,
				effectiveProbability,
				actualWinChance: Math.round(actualWinChance * 10000) / 100, // %
				rollCost,
				upgradeCostCumulative,
				expectedRolls: Math.round(expectedRolls * 100) / 100,
				expectedRollCost: Math.round(expectedRollCost),
				expectedTotalCost: Math.round(expectedTotalCost),
				evRatio: Math.round(evRatio * 1000) / 1000
			};

			results.push(row);

			if (expectedTotalCost < bestCost) {
				bestCost = expectedTotalCost;
				bestLevel = k;
			}
		}

		const bestResult = results[bestLevel];
		const isExploitable = bestCost < price;

		// House edge at player's best strategy
		const houseEdgePercent =
			bestResult && price > 0
				? Math.round(((bestResult.expectedTotalCost - price) / price) * 1000) / 10
				: 0;

		return {
			results,
			bestPlayerLevel: bestLevel,
			bestPlayerCost: Math.round(bestCost),
			bestPlayerRatio: bestResult?.evRatio ?? 0,
			isExploitable,
			houseEdgePercent
		};
	}

	// --- derived models ---
	$: autoPricing = calculatePricing(
		Number.isFinite(monetaryValue) ? monetaryValue : 0,
		Number.isFinite(stockCount) ? stockCount : 0,
		priceOverrideEnabled ? Math.max(1, Math.floor(priceOverride || 0)) : undefined
	);

	$: activePricing = (() => {
		if (!manualMode) return autoPricing;
		// in manual mode, still recompute rollCost from price/baseProbability (like shop)
		const price = Math.max(1, Math.floor(manual_price || 1));
		const baseProbability = Math.max(1, Math.min(100, Math.floor(manual_baseProbability || 1)));
		const rollCost = Math.max(1, Math.round(price * (baseProbability / 100)));
		return {
			price,
			baseProbability,
			baseUpgradeCost: Math.max(1, Math.floor(manual_baseUpgradeCost || 1)),
			costMultiplier: Math.max(100, Math.floor(manual_costMultiplier || 100)),
			boostAmount: Math.max(1, Math.floor(manual_boostAmount || 1)),
			rollCost
		};
	})();

	$: activeRollOverride = rollCostOverrideEnabled ? (rollCostOverride ?? null) : null;

	$: ev = simulateEV(
		activePricing.price,
		activePricing.baseProbability,
		activePricing.baseUpgradeCost,
		activePricing.costMultiplier,
		activePricing.boostAmount,
		activeRollOverride
	);

	function useOptimal() {
		manualMode = true;
		manual_price = autoPricing.price;
		manual_baseProbability = autoPricing.baseProbability;
		manual_baseUpgradeCost = autoPricing.baseUpgradeCost;
		manual_costMultiplier = autoPricing.costMultiplier;
		manual_boostAmount = autoPricing.boostAmount;
	}

	function resetManual() {
		manualMode = false;
	}
</script>

<div class="wrap">
	<header class="hero">
		<h1>Refinery Odds + Pricing (Single File)</h1>
		<p class="sub">
			Local preview tool: pricing → odds → roll cost → house edge → EV across upgrade levels.
		</p>
	</header>

	<section class="card">
		<h2>Inputs</h2>

		<div class="grid">
			<label>
				<span>Monetary value ($)</span>
				<input type="number" step="0.01" min="0" bind:value={monetaryValue} />
			</label>

			<label>
				<span>Stock count</span>
				<input type="number" step="1" min="0" bind:value={stockCount} />
			</label>

			<label class="row">
				<input type="checkbox" bind:checked={priceOverrideEnabled} />
				<span>Override price (scraps)</span>
			</label>

			<label>
				<span>Price override</span>
				<input
					type="number"
					step="1"
					min="1"
					disabled={!priceOverrideEnabled}
					bind:value={priceOverride}
				/>
			</label>

			<label class="row">
				<input type="checkbox" bind:checked={rollCostOverrideEnabled} />
				<span>Override roll cost</span>
			</label>

			<label>
				<span>Roll cost override</span>
				<input
					type="number"
					step="1"
					min="1"
					disabled={!rollCostOverrideEnabled}
					bind:value={rollCostOverride}
				/>
			</label>

			<label class="row">
				<input type="checkbox" bind:checked={manualMode} />
				<span>Manual mode (edit refinery params)</span>
			</label>

			<div class="actions">
				<button type="button" on:click={useOptimal}>Use optimal as manual base</button>
				<button type="button" class="ghost" on:click={resetManual}>Use auto</button>
			</div>
		</div>
	</section>

	<section class="card">
		<h2>Computed pricing</h2>

		<div class="stats">
			<div class="pill">
				<div class="k">SCRAPS_PER_HOUR</div>
				<div class="v">{Math.round(SCRAPS_PER_HOUR)}</div>
			</div>
			<div class="pill">
				<div class="k">SCRAPS_PER_DOLLAR</div>
				<div class="v">{SCRAPS_PER_DOLLAR.toFixed(3)}</div>
			</div>
			<div class="pill">
				<div class="k">Auto price</div>
				<div class="v">{autoPricing.price} scraps</div>
			</div>
			<div class="pill">
				<div class="k">Auto base prob</div>
				<div class="v">{autoPricing.baseProbability}%</div>
			</div>
			<div class="pill">
				<div class="k">Auto boost</div>
				<div class="v">+{autoPricing.boostAmount}%/upgrade</div>
			</div>
			<div class="pill">
				<div class="k">Auto base upgrade</div>
				<div class="v">{autoPricing.baseUpgradeCost}</div>
			</div>
		</div>

		{#if manualMode}
			<div class="manual">
				<h3>Manual parameters</h3>
				<div class="grid">
					<label>
						<span>Price (scraps)</span>
						<input type="number" min="1" bind:value={manual_price} />
					</label>
					<label>
						<span>Base probability (%)</span>
						<input type="number" min="1" max="100" bind:value={manual_baseProbability} />
					</label>
					<label>
						<span>Boost per upgrade (%)</span>
						<input type="number" min="1" bind:value={manual_boostAmount} />
					</label>
					<label>
						<span>Base upgrade cost (scraps)</span>
						<input type="number" min="1" bind:value={manual_baseUpgradeCost} />
					</label>
					<label>
						<span>Cost multiplier (%)</span>
						<input type="number" min="100" bind:value={manual_costMultiplier} />
					</label>
				</div>
				<p class="note">
					Note: The EV sim uses the same decay series you pasted (price × 0.25 / 1.05^i) and a
					2.0× price budget cap.
				</p>
			</div>
		{/if}

		<hr />

		<div class="stats">
			<div class="pill">
				<div class="k">Active price</div>
				<div class="v">{activePricing.price} scraps</div>
			</div>
			<div class="pill">
				<div class="k">Active base prob</div>
				<div class="v">{activePricing.baseProbability}%</div>
			</div>
			<div class="pill">
				<div class="k">Active boost</div>
				<div class="v">+{activePricing.boostAmount}%/upgrade</div>
			</div>
			<div class="pill">
				<div class="k">Base roll cost</div>
				<div class="v">
					{calculateRollCost(
						activePricing.price,
						activePricing.baseProbability,
						activeRollOverride,
						activePricing.baseProbability
					)}
				</div>
			</div>
			<div class="pill">
				<div class="k">Displayed 100% → actual</div>
				<div class="v">{computeRollThreshold(100)}%</div>
			</div>
			<div class="pill">
				<div class="k">Displayed 50% → actual</div>
				<div class="v">{computeRollThreshold(50)}%</div>
			</div>
		</div>
	</section>

	<section class="card">
		<h2>EV analysis</h2>

		<div class="banner {ev.isExploitable ? 'bad' : 'good'}">
			<div class="big">
				{#if ev.isExploitable}
					<span>EXPLOITABLE</span>
				{:else}
					<span>SAFE</span>
				{/if}
			</div>
			<div class="small">
				House edge (player best strategy): <b>+{ev.houseEdgePercent}%</b> · Player best: level
				<b>{ev.bestPlayerLevel}</b> · Expected cost <b>{ev.bestPlayerCost}</b> scraps · Ratio
				<b>{ev.bestPlayerRatio}×</b>
			</div>
		</div>

		<div class="tableWrap">
			<table>
				<thead>
					<tr>
						<th>lv</th>
						<th>displayed %</th>
						<th>actual %</th>
						<th>roll cost</th>
						<th>upgr cost</th>
						<th>E[rolls]</th>
						<th>E[total]</th>
						<th>ratio</th>
					</tr>
				</thead>
				<tbody>
					{#each ev.results as r}
						<tr class:best={r.upgradeLevel === ev.bestPlayerLevel} class:profit={r.evRatio < 1}>
							<td>{r.upgradeLevel}</td>
							<td>{r.effectiveProbability}%</td>
							<td>{r.actualWinChance}%</td>
							<td>{r.rollCost}</td>
							<td>{r.upgradeCostCumulative}</td>
							<td>{r.expectedRolls}</td>
							<td>{r.expectedTotalCost}</td>
							<td>{r.evRatio}×</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<p class="note">
			“Actual %” is computed via <code>floor(displayed × 17/20)</code>. The highlighted row is the
			player’s best expected strategy (lowest expected cost). Rows marked red indicate EV profit
			(ratio &lt; 1).
		</p>
	</section>
</div>

<style>
	:global(body) {
		font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial,
			'Apple Color Emoji', 'Segoe UI Emoji';
	}

	.wrap {
		max-width: 980px;
		margin: 0 auto;
		padding: 32px 16px 80px;
	}

	.hero h1 {
		margin: 0 0 6px;
		font-size: 32px;
	}

	.sub {
		margin: 0;
		color: #555;
	}

	.card {
		margin-top: 16px;
		border: 4px solid #000;
		border-radius: 18px;
		padding: 16px;
		background: #fff;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 18px;
	}

	h3 {
		margin: 0 0 10px;
		font-size: 14px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-weight: 700;
		font-size: 12px;
	}

	label span {
		color: #222;
	}

	input {
		border: 2px solid #000;
		border-radius: 12px;
		padding: 10px 12px;
		font-size: 14px;
		font-weight: 700;
	}

	input:disabled {
		opacity: 0.5;
	}

	.row {
		flex-direction: row;
		align-items: center;
		gap: 10px;
		padding-top: 22px;
	}

	.actions {
		display: flex;
		gap: 10px;
		align-items: end;
		justify-content: flex-end;
	}

	button {
		border: 4px solid #000;
		border-radius: 999px;
		padding: 10px 14px;
		font-weight: 900;
		cursor: pointer;
		background: #000;
		color: #fff;
	}

	button.ghost {
		background: #fff;
		color: #000;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}

	.pill {
		border: 2px solid #000;
		border-radius: 14px;
		padding: 10px 12px;
		background: #f6f6f6;
	}

	.k {
		font-size: 11px;
		color: #555;
		font-weight: 900;
	}

	.v {
		font-size: 16px;
		font-weight: 900;
		margin-top: 2px;
	}

	.manual {
		margin-top: 12px;
		border: 2px dashed #000;
		border-radius: 14px;
		padding: 12px;
		background: #fafafa;
	}

	hr {
		border: none;
		border-top: 2px solid #ddd;
		margin: 12px 0;
	}

	.banner {
		border: 4px solid #000;
		border-radius: 18px;
		padding: 12px 14px;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
	}

	.banner.good {
		background: #ecfdf5;
		border-color: #16a34a;
	}

	.banner.bad {
		background: #fef2f2;
		border-color: #dc2626;
	}

	.big {
		font-size: 18px;
		font-weight: 1000;
	}

	.small {
		font-size: 12px;
		color: #333;
	}

	.tableWrap {
		margin-top: 12px;
		overflow: auto;
		border-radius: 14px;
		border: 2px solid #000;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}

	th,
	td {
		padding: 8px 10px;
		border-bottom: 1px solid #e5e5e5;
		white-space: nowrap;
		font-weight: 800;
	}

	th {
		position: sticky;
		top: 0;
		background: #fff;
		border-bottom: 2px solid #000;
		text-align: left;
	}

	tr.best {
		background: #dcfce7;
	}

	tr.profit {
		background: #fee2e2;
	}

	.note {
		margin-top: 10px;
		font-size: 12px;
		color: #555;
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-weight: 900;
	}
</style>