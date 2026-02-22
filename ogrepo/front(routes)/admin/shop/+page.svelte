<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		Plus,
		Pencil,
		Trash2,
		X,
		Spool,
		TrendingUp,
		AlertTriangle,
		ShieldCheck,
		RotateCcw
	} from '@lucide/svelte';
	import { getUser } from '$lib/auth-client';
	import { API_URL } from '$lib/config';
	import { t } from '$lib/i18n';

	interface ShopItem {
		id: number;
		name: string;
		image: string;
		description: string;
		price: number;
		category: string;
		count: number;
		baseProbability: number;
		baseUpgradeCost: number;
		costMultiplier: number;
		boostAmount: number;
		rollCostOverride: number | null;
		createdAt: string;
		updatedAt: string;
	}

	interface User {
		id: number;
		role: string;
	}

	interface EVResult {
		upgradeLevel: number;
		boostPercent: number;
		effectiveProbability: number;
		actualWinChance: number;
		rollCost: number;
		upgradeCostCumulative: number;
		expectedRolls: number;
		expectedRollCost: number;
		expectedTotalCost: number;
		evRatio: number;
	}

	interface EVSummary {
		results: EVResult[];
		bestPlayerLevel: number;
		bestPlayerCost: number;
		bestPlayerRatio: number;
		isExploitable: boolean;
		houseEdgePercent: number;
	}

	let user = $state<User | null>(null);
	let items = $state<ShopItem[]>([]);
	let loading = $state(true);
	let saving = $state(false);

	let showModal = $state(false);
	let editingItem = $state<ShopItem | null>(null);

	let formName = $state('');
	let formImage = $state('');
	let formDescription = $state('');
	let formPrice = $state(0);
	let formPriceOverride = $state(false);
	let formCategory = $state('');
	let formCount = $state(0);
	let formBaseProbability = $state(50);
	let formBaseUpgradeCost = $state(10);
	let formCostMultiplier = $state(110);
	let formBoostAmount = $state(1);
	let formRollCostOverride = $state<number | null>(null);
	let formMonetaryValue = $state(0);
	let formError = $state<string | null>(null);
	let errorModal = $state<string | null>(null);
	let resettingRefinery = $state(false);
	let showResetConfirm = $state(false);

	const PHI = (1 + Math.sqrt(5)) / 2;
	const SCRAPS_PER_HOUR = PHI * 10;
	const DOLLARS_PER_HOUR = 4;
	const SCRAPS_PER_DOLLAR = SCRAPS_PER_HOUR / DOLLARS_PER_HOUR;

	// Must match backend calculateRollCost exactly
	function calculateRollCost(
		basePrice: number,
		effectiveProbability: number,
		rollCostOverride?: number | null,
		baseProbability?: number
	): number {
		if (rollCostOverride != null && rollCostOverride > 0) {
			return rollCostOverride;
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
	function calculatePricing(monetaryValue: number, stockCount: number, priceOverride?: number) {
		const price = priceOverride ?? Math.round(monetaryValue * SCRAPS_PER_DOLLAR);

		const priceRarityFactor = Math.max(0, 1 - monetaryValue / 100);
		const stockRarityFactor = Math.min(1, stockCount / 20);
		const baseProbability = Math.max(
			1,
			Math.min(80, Math.round((priceRarityFactor * 0.4 + stockRarityFactor * 0.6) * 80))
		);

		const rollCost = Math.max(1, Math.round(price * (baseProbability / 100)));

		const probabilityGap = 100 - baseProbability;
		const targetUpgrades = Math.max(5, Math.min(20, Math.ceil(monetaryValue / 5)));
		const boostAmount = Math.max(1, Math.round(probabilityGap / targetUpgrades));

		// Upgrades start at 25% of item price and decay by 1.05x per level
		const baseUpgradeCost = Math.max(1, Math.floor(price * 0.25));
		const costMultiplier = 105;

		return { price, baseProbability, baseUpgradeCost, costMultiplier, boostAmount };
	}

	function simulateEV(
		price: number,
		baseProbability: number,
		baseUpgradeCost: number,
		costMultiplier: number,
		boostAmount: number,
		rollCostOverride?: number | null
	): EVSummary {
		const results: EVResult[] = [];
		const probabilityGap = 100 - baseProbability;
		const maxUpgrades = boostAmount > 0 ? Math.ceil(probabilityGap / boostAmount) : 0;

		let bestLevel = 0;
		let bestCost = Infinity;

		for (let k = 0; k <= maxUpgrades; k++) {
			const boostPercent = k * boostAmount;
			const effectiveProbability = Math.min(baseProbability + boostPercent, 100);

			const rollCost = calculateRollCost(price, effectiveProbability, rollCostOverride, baseProbability);

			// Cumulative upgrade cost (decaying: price * 0.25 / 1.05^i, capped at 2x price)
			const maxBudget = price * 2;
			let upgradeCostCumulative = 0;
			let budgetExhausted = false;
			for (let i = 0; i < k; i++) {
				const ucost = Math.max(1, Math.floor(price * 0.25 / Math.pow(1.05, i)));
				if (upgradeCostCumulative + ucost > maxBudget) {
					upgradeCostCumulative = maxBudget;
					budgetExhausted = true;
					break;
				}
				upgradeCostCumulative += ucost;
			}

			if (budgetExhausted) break;

			// Backend applies 17/20 house edge via computeRollThreshold
			const actualThreshold = computeRollThreshold(effectiveProbability);
			const actualWinChance = actualThreshold / 100;
			const expectedRolls = actualWinChance > 0 ? 1 / actualWinChance : Infinity;
			const expectedRollCost = rollCost * expectedRolls;
			const expectedTotalCost = upgradeCostCumulative + expectedRollCost;
			const evRatio = price > 0 ? expectedTotalCost / price : Infinity;

			results.push({
				upgradeLevel: k,
				boostPercent,
				effectiveProbability,
				actualWinChance: Math.round(actualWinChance * 10000) / 100,
				rollCost,
				upgradeCostCumulative,
				expectedRolls: Math.round(expectedRolls * 100) / 100,
				expectedRollCost: Math.round(expectedRollCost),
				expectedTotalCost: Math.round(expectedTotalCost),
				evRatio: Math.round(evRatio * 1000) / 1000
			});

			if (expectedTotalCost < bestCost) {
				bestCost = expectedTotalCost;
				bestLevel = k;
			}
		}

		const bestResult = results[bestLevel];
		const isExploitable = bestCost < price;

		// House edge: at player's best strategy, how much more than price they spend
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

	function getItemEVSummary(item: ShopItem): EVSummary {
		return simulateEV(
			item.price,
			item.baseProbability,
			item.baseUpgradeCost,
			item.costMultiplier,
			item.boostAmount,
			item.rollCostOverride
		);
	}

	let formEV = $derived(
		formPrice > 0
			? simulateEV(
					formPrice,
					formBaseProbability,
					formBaseUpgradeCost,
					formCostMultiplier,
					formBoostAmount,
					formRollCostOverride
				)
			: null
	);

	let showDetailedEV = $state(false);

	// Optimal pricing derived from current monetary value + stock count
	// When price is overridden, compute EV-safe upgrade costs against the actual price
	let optimalPricing = $derived(
		calculatePricing(formMonetaryValue, formCount, formPriceOverride ? formPrice : undefined)
	);

	let hasCustomPricing = $derived(
		formPrice > 0 &&
			(formPrice !== optimalPricing.price ||
				formBaseProbability !== optimalPricing.baseProbability ||
				formBaseUpgradeCost !== optimalPricing.baseUpgradeCost ||
				formCostMultiplier !== optimalPricing.costMultiplier ||
				formBoostAmount !== optimalPricing.boostAmount)
	);

	function recalculatePricing() {
		const pricing = calculatePricing(
			formMonetaryValue,
			formCount,
			formPriceOverride ? formPrice : undefined
		);
		if (!formPriceOverride) {
			formPrice = pricing.price;
		}
		formBaseProbability = pricing.baseProbability;
		formBaseUpgradeCost = pricing.baseUpgradeCost;
		formCostMultiplier = pricing.costMultiplier;
		formBoostAmount = pricing.boostAmount;
	}

	function updateFromMonetary(value: number) {
		formMonetaryValue = value;
		if (!formPriceOverride) {
			formPrice = Math.round(value * SCRAPS_PER_DOLLAR);
		}
		recalculatePricing();
	}

	function updateFromStock(value: number) {
		formCount = value;
		recalculatePricing();
	}

	function updatePriceOverride(value: number) {
		formPrice = value;
		formPriceOverride = true;
	}

	function clearPriceOverride() {
		formPriceOverride = false;
		formPrice = Math.round(formMonetaryValue * SCRAPS_PER_DOLLAR);
	}

	let deleteConfirmId = $state<number | null>(null);

	onMount(async () => {
		user = await getUser();
		if (!user || user.role !== 'admin') {
			goto('/dashboard');
			return;
		}

		await fetchItems();
	});

	async function fetchItems() {
		loading = true;
		try {
			const response = await fetch(`${API_URL}/admin/shop/items`, {
				credentials: 'include'
			});
			if (response.ok) {
				items = await response.json();
			}
		} catch (e) {
			console.error('Failed to fetch items:', e);
		} finally {
			loading = false;
		}
	}

	function openCreateModal() {
		editingItem = null;
		formName = '';
		formImage = '';
		formDescription = '';
		formPrice = 0;
		formPriceOverride = false;
		formMonetaryValue = 0;
		formCategory = '';
		formCount = 0;
		formBaseProbability = 50;
		formBaseUpgradeCost = 10;
		formCostMultiplier = 110;
		formBoostAmount = 1;
		formRollCostOverride = null;
		formError = null;
		showDetailedEV = false;
		showModal = true;
	}

	function openEditModal(item: ShopItem) {
		editingItem = item;
		formName = item.name;
		formImage = item.image;
		formDescription = item.description;
		formMonetaryValue = Math.round((item.price / SCRAPS_PER_DOLLAR) * 100) / 100;
		const autoPrice = Math.round(formMonetaryValue * SCRAPS_PER_DOLLAR);
		formPrice = item.price;
		formPriceOverride = item.price !== autoPrice;
		formCategory = item.category;
		formCount = item.count;
		formBaseProbability = item.baseProbability;
		formBaseUpgradeCost = item.baseUpgradeCost;
		formCostMultiplier = item.costMultiplier;
		formBoostAmount = item.boostAmount ?? 1;
		formRollCostOverride = item.rollCostOverride ?? null;
		formError = null;
		showDetailedEV = false;
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editingItem = null;
	}

	async function handleSubmit() {
		if (!formName.trim() || !formImage.trim() || !formDescription.trim() || !formCategory.trim()) {
			formError = 'All fields are required';
			return;
		}

		saving = true;
		formError = null;

		try {
			const url = editingItem
				? `${API_URL}/admin/shop/items/${editingItem.id}`
				: `${API_URL}/admin/shop/items`;

			const response = await fetch(url, {
				method: editingItem ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					name: formName,
					image: formImage,
					description: formDescription,
					price: formPrice,
					category: formCategory,
					count: formCount,
					baseProbability: formBaseProbability,
					baseUpgradeCost: formBaseUpgradeCost,
					costMultiplier: formCostMultiplier,
					boostAmount: formBoostAmount,
					rollCostOverride: formRollCostOverride
				})
			});

			if (response.ok) {
				closeModal();
				await fetchItems();
			} else {
				const data = await response.json();
				formError = data.error || 'Failed to save';
			}
		} catch (e) {
			formError = 'Failed to save item';
		} finally {
			saving = false;
		}
	}

	function requestDelete(id: number) {
		deleteConfirmId = id;
	}

	async function confirmDelete() {
		if (!deleteConfirmId) return;

		try {
			const response = await fetch(`${API_URL}/admin/shop/items/${deleteConfirmId}`, {
				method: 'DELETE',
				credentials: 'include'
			});
			if (response.ok) {
				await fetchItems();
			} else {
				const data = await response.json();
				errorModal = data.error || 'Failed to delete item';
			}
		} catch (e) {
			console.error('Failed to delete:', e);
			errorModal = 'Failed to delete item';
		} finally {
			deleteConfirmId = null;
		}
	}

	async function resetNonBuyerRefinery() {
		resettingRefinery = true;
		try {
			const response = await fetch(`${API_URL}/admin/shop/reset-non-buyer-refinery`, {
				method: 'POST',
				credentials: 'include'
			});
			const data = await response.json();
			if (response.ok && data.success) {
				errorModal = `Reset ${data.resetCount} user-item combos: ${data.deletedOrders} refinery orders and ${data.deletedHistory} history entries deleted`;
				await fetchItems();
			} else {
				errorModal = data.error || 'Failed to reset refinery orders';
			}
		} catch (e) {
			console.error('Failed to reset refinery:', e);
			errorModal = 'Failed to reset refinery orders';
		} finally {
			resettingRefinery = false;
			showResetConfirm = false;
		}
	}
</script>

<svelte:head>
	<title>{$t.nav.shop} - {$t.nav.admin} - scraps</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-24 pb-24 md:px-12">
	<div class="mb-8 flex items-center justify-between">
		<div>
			<h1 class="mb-2 text-4xl font-bold md:text-5xl">{$t.nav.shop}</h1>
			<p class="text-lg text-gray-600">{$t.admin.manageShopItemsAndInventory}</p>
		</div>
		<div class="flex gap-3">
			<button
				onclick={() => (showResetConfirm = true)}
				disabled={resettingRefinery}
				class="cursor-pointer rounded-full border-4 border-red-600 px-4 py-2 font-bold text-red-600 transition-all duration-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{resettingRefinery ? 'resetting...' : 'reset non-buyer refinery'}
			</button>
			<button
				onclick={openCreateModal}
				class="flex cursor-pointer items-center gap-2 rounded-full bg-black px-6 py-3 font-bold text-white transition-all duration-200 hover:bg-gray-800"
			>
				<Plus size={20} />
				{$t.admin.addItem}
			</button>
		</div>
	</div>

	<div class="mb-8 rounded-2xl border-4 border-black p-4">
		<h3 class="mb-3 font-bold">scraps per hour reference</h3>
		<div class="grid grid-cols-4 gap-4 text-center text-sm">
			{#each [0.8, 1, 1.25, 1.5] as mult}
				<div class="rounded-lg bg-gray-100 p-3">
					<div class="mb-1 text-gray-500">{mult}x</div>
					<div class="flex items-center justify-center gap-1 font-bold">
						<Spool size={14} />
						{Math.round(SCRAPS_PER_HOUR * mult)}
					</div>
					<div class="text-xs text-gray-500">${(DOLLARS_PER_HOUR * mult).toFixed(2)}/hr</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="mb-8 rounded-2xl border-4 border-black p-4">
		<h3 class="mb-3 flex items-center gap-2 font-bold">
			<TrendingUp size={18} />
			pricing model reference
		</h3>
		<div class="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
			<div class="rounded-lg bg-gray-100 p-3">
				<div class="mb-1 text-xs text-gray-500">roll cost</div>
				<div class="font-bold">price × effective% / 100</div>
			</div>
			<div class="rounded-lg bg-gray-100 p-3">
				<div class="mb-1 text-xs text-gray-500">roll cost is</div>
				<div class="font-bold">scales with effective probability (includes upgrades)</div>
			</div>
			<div class="rounded-lg bg-gray-100 p-3">
				<div class="mb-1 text-xs text-gray-500">upgrade budget</div>
				<div class="font-bold">3.0× price</div>
			</div>
			<div class="rounded-lg bg-gray-100 p-3">
				<div class="mb-1 text-xs text-gray-500">win threshold</div>
				<div class="font-bold">eff% × 17/20</div>
			</div>
		</div>
		<p class="mt-2 text-xs text-gray-500">
			roll cost scales with effective probability (including upgrades). upgrades increase win chance
			and roll cost together. actual win threshold = floor(effective% × 17/20), giving ~15% house
			edge. upgrade budget = 3.0× item price spread across a geometric cost series.
		</p>
	</div>

	{#if loading}
		<div class="py-12 text-center text-gray-500">{$t.common.loading}</div>
	{:else if items.length === 0}
		<div class="py-12 text-center text-gray-500">{$t.refinery.noItemsAvailable}</div>
	{:else}
		<div class="grid gap-4">
			{#each items as item}
				{@const ev = getItemEVSummary(item)}
				<div
					class="rounded-2xl border-4 p-4 transition-all {ev.isExploitable
						? 'border-red-600 bg-red-50'
						: 'border-black'}"
				>
					<div class="flex items-center gap-4">
						<img
							src={item.image}
							alt={item.name}
							class="h-20 w-20 shrink-0 rounded-lg border-2 border-black object-cover"
						/>
						<div class="min-w-0 flex-1">
							<h3 class="text-xl font-bold">{item.name}</h3>
							<p class="text-sm wrap-break-word text-gray-600">{item.description}</p>
							<div class="mt-1 flex flex-wrap items-center gap-2 text-sm">
								<span class="font-bold">${(item.price / SCRAPS_PER_DOLLAR).toFixed(2)}</span>
								<span class="text-gray-500">·</span>
								<span class="flex items-center gap-1 font-bold"
									><Spool size={16} />{item.price}</span
								>
								{#each item.category
									.split(',')
									.map((c) => c.trim())
									.filter(Boolean) as cat}
									<span class="rounded-full bg-gray-100 px-2 py-0.5">{cat}</span>
								{/each}
								<span class="text-gray-500">{item.count} in stock</span>
								<span class="text-gray-500">·</span>
								<span class="text-gray-500">{item.baseProbability}% base</span>
								<span class="text-gray-500">·</span>
								<span class="text-gray-500">+{item.boostAmount ?? 1}%/upgrade</span>
								<span class="text-gray-500">·</span>
								<span class="text-gray-500"
									>~{(item.price / SCRAPS_PER_HOUR).toFixed(1)} hrs to earn</span
								>
							</div>
						</div>
						<div class="flex shrink-0 gap-2">
							<button
								onclick={() => openEditModal(item)}
								class="cursor-pointer rounded-lg border-4 border-black p-2 transition-all duration-200 hover:border-dashed"
							>
								<Pencil size={18} />
							</button>
							<button
								onclick={() => requestDelete(item.id)}
								class="cursor-pointer rounded-lg border-4 border-red-600 p-2 text-red-600 transition-all duration-200 hover:bg-red-50"
							>
								<Trash2 size={18} />
							</button>
						</div>
					</div>

					<!-- EV Summary Bar -->
					<div
						class="mt-3 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 text-xs {ev.isExploitable
							? 'bg-red-100'
							: 'bg-gray-100'}"
					>
						{#if ev.isExploitable}
							<span class="flex items-center gap-1 font-bold text-red-600">
								<AlertTriangle size={14} />
								EXPLOITABLE
							</span>
						{:else}
							<span class="flex items-center gap-1 font-bold text-green-700">
								<ShieldCheck size={14} />
								safe
							</span>
						{/if}
						<span class="text-gray-500">·</span>
						<span>
							<span class="text-gray-500">house edge:</span>
							<span class="font-bold {ev.houseEdgePercent < 0 ? 'text-red-600' : ''}"
								>+{ev.houseEdgePercent}%</span
							>
						</span>
						<span class="text-gray-500">·</span>
						<span>
							<span class="text-gray-500">player best (lv{ev.bestPlayerLevel}):</span>
							<span class="font-bold {ev.bestPlayerRatio < 1 ? 'text-red-600' : ''}"
								>{ev.bestPlayerCost} scraps</span
							>
							<span class="text-gray-500">({ev.bestPlayerRatio}×)</span>
						</span>
						<span class="text-gray-500">·</span>
						<span>
							<span class="text-gray-500">base roll:</span>
							<span class="font-bold"
								>{calculateRollCost(item.price, item.baseProbability, item.rollCostOverride)} scraps</span
							>
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if showModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div
			class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border-4 border-black bg-white p-6"
		>
			<div class="mb-6 flex items-center justify-between">
				<h2 class="text-2xl font-bold">{editingItem ? $t.admin.editItem : $t.admin.addItem}</h2>
				<button
					onclick={closeModal}
					class="cursor-pointer rounded-lg p-2 transition-colors hover:bg-gray-100"
				>
					<X size={20} />
				</button>
			</div>

			{#if formError}
				<div class="mb-4 rounded-lg border-2 border-red-600 bg-red-50 p-3 text-sm text-red-600">
					{formError}
				</div>
			{/if}

			<div class="space-y-4">
				<div>
					<label for="name" class="mb-1 block text-sm font-bold">name</label>
					<input
						id="name"
						type="text"
						bind:value={formName}
						class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
					/>
				</div>

				<div>
					<label for="image" class="mb-1 block text-sm font-bold">image URL</label>
					<input
						id="image"
						type="text"
						bind:value={formImage}
						class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
					/>
				</div>

				<div>
					<label for="description" class="mb-1 block text-sm font-bold">description</label>
					<textarea
						id="description"
						bind:value={formDescription}
						rows="3"
						class="w-full resize-none rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
					></textarea>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="monetaryValue" class="mb-1 block text-sm font-bold">value ($)</label>
						<input
							id="monetaryValue"
							type="number"
							value={formMonetaryValue}
							oninput={(e) => updateFromMonetary(parseFloat(e.currentTarget.value) || 0)}
							min="0"
							step="0.01"
							class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
						/>
						<p class="mt-1 text-xs text-gray-500">
							auto = {Math.round(formMonetaryValue * SCRAPS_PER_DOLLAR)} scraps
						</p>
					</div>
					<div>
						<label for="scrapsPrice" class="mb-1 block text-sm font-bold">
							price (scraps)
							{#if formPriceOverride}
								<span class="ml-1 text-xs font-normal text-yellow-600">overridden</span>
							{/if}
						</label>
						<input
							id="scrapsPrice"
							type="number"
							value={formPrice}
							oninput={(e) => updatePriceOverride(parseInt(e.currentTarget.value) || 0)}
							min="1"
							class="w-full rounded-lg border-2 px-4 py-2 focus:border-dashed focus:outline-none {formPriceOverride
								? 'border-yellow-500'
								: 'border-black'}"
						/>
						{#if formPriceOverride}
							<button
								onclick={clearPriceOverride}
								class="mt-1 cursor-pointer text-xs font-bold text-yellow-600 underline"
							>
								reset to auto ({Math.round(formMonetaryValue * SCRAPS_PER_DOLLAR)})
							</button>
						{:else}
							<p class="mt-1 text-xs text-gray-500">
								~{(formPrice / SCRAPS_PER_HOUR).toFixed(1)} hrs to earn
							</p>
						{/if}
					</div>
				</div>
				<p class="text-xs text-gray-500">
					{formBaseProbability}% base · +{formBoostAmount}%/upgrade · ~{(
						formPrice / SCRAPS_PER_HOUR
					).toFixed(1)} hrs to earn
				</p>

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="count" class="mb-1 block text-sm font-bold">stock count</label>
						<input
							id="count"
							type="number"
							value={formCount}
							oninput={(e) => updateFromStock(parseInt(e.currentTarget.value) || 0)}
							min="0"
							class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
						/>
						<p class="mt-1 text-xs text-gray-500">affects rarity calculation</p>
					</div>
					<div>
						<label for="category" class="mb-1 block text-sm font-bold">categories</label>
						<input
							id="category"
							type="text"
							bind:value={formCategory}
							placeholder="stickers, hardware"
							class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
						/>
					</div>
				</div>

				<!-- Optimal pricing hint -->
				{#if formMonetaryValue > 0}
					<div
						class="rounded-xl border-2 p-3 {hasCustomPricing
							? 'border-yellow-400 bg-yellow-50'
							: 'border-green-400 bg-green-50'}"
					>
						<div class="flex items-center justify-between">
							<div class="text-xs">
								<span class="font-bold {hasCustomPricing ? 'text-yellow-700' : 'text-green-700'}">
									{hasCustomPricing
										? 'custom pricing (differs from optimal)'
										: 'using optimal pricing'}
								</span>
								<span class="ml-2 text-gray-500">
									optimal: {optimalPricing.baseProbability}% base · +{optimalPricing.boostAmount}%/upgrade
									· {optimalPricing.baseUpgradeCost} base cost · {optimalPricing.costMultiplier}%
									mult
								</span>
							</div>
							{#if hasCustomPricing}
								<button
									onclick={recalculatePricing}
									class="flex cursor-pointer items-center gap-1 rounded-full border-2 border-yellow-600 px-3 py-1 text-xs font-bold text-yellow-700 transition-all duration-200 hover:border-dashed"
								>
									<RotateCcw size={12} />
									use optimal
								</button>
							{/if}
						</div>
					</div>
				{/if}

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="baseProbability" class="mb-1 block text-sm font-bold"
							>base probability (%)</label
						>
						<input
							id="baseProbability"
							type="number"
							bind:value={formBaseProbability}
							min="1"
							max="100"
							step="1"
							class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none {formBaseProbability !==
							optimalPricing.baseProbability
								? 'border-yellow-500'
								: ''}"
						/>
						{#if formBaseProbability !== optimalPricing.baseProbability}
							<p class="mt-1 text-xs text-yellow-600">optimal: {optimalPricing.baseProbability}%</p>
						{/if}
					</div>
					<div>
						<label for="boostAmount" class="mb-1 block text-sm font-bold"
							>boost per upgrade (%)</label
						>
						<input
							id="boostAmount"
							type="number"
							bind:value={formBoostAmount}
							min="1"
							class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none {formBoostAmount !==
							optimalPricing.boostAmount
								? 'border-yellow-500'
								: ''}"
						/>
						{#if formBoostAmount !== optimalPricing.boostAmount}
							<p class="mt-1 text-xs text-yellow-600">optimal: +{optimalPricing.boostAmount}%</p>
						{/if}
					</div>
				</div>

				<div>
					<label for="rollCostOverride" class="mb-1 block text-sm font-bold">
						roll cost override
						{#if formRollCostOverride != null}
							<span class="ml-1 text-xs font-normal text-yellow-600">overridden</span>
						{/if}
					</label>
					<div class="flex gap-2">
						<input
							id="rollCostOverride"
							type="number"
							value={formRollCostOverride ?? ''}
							oninput={(e) => {
								const val = e.currentTarget.value;
								formRollCostOverride = val === '' ? null : parseInt(val) || null;
							}}
							min="1"
							placeholder="auto (base {Math.max(
								1,
								Math.round(formPrice * (formBaseProbability / 100))
							)} / +1 {Math.max(
								1,
								Math.round(formPrice * (Math.min(100, formBaseProbability + formBoostAmount) / 100))
							)})"
							class="w-full rounded-lg border-2 px-4 py-2 focus:border-dashed focus:outline-none {formRollCostOverride !=
							null
								? 'border-yellow-500'
								: 'border-black'}"
						/>
						{#if formRollCostOverride != null}
							<button
								onclick={() => (formRollCostOverride = null)}
								class="shrink-0 cursor-pointer rounded-lg border-2 border-yellow-500 px-3 py-2 text-xs font-bold text-yellow-600 transition-all duration-200 hover:border-dashed"
							>
								auto
							</button>
						{/if}
					</div>
					<p class="mt-1 text-xs text-gray-500">
						auto shows base / +1 roll — e.g. base {Math.max(
							1,
							Math.round(formPrice * (formBaseProbability / 100))
						)} / +1 {Math.max(
							1,
							Math.round(formPrice * (Math.min(100, formBaseProbability + formBoostAmount) / 100))
						)}. (shop uses effective% at roll time)
					</p>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="baseUpgradeCost" class="mb-1 block text-sm font-bold"
							>base upgrade cost</label
						>
						<input
							id="baseUpgradeCost"
							type="number"
							bind:value={formBaseUpgradeCost}
							min="1"
							class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none {formBaseUpgradeCost !==
							optimalPricing.baseUpgradeCost
								? 'border-yellow-500'
								: ''}"
						/>
						<p class="mt-1 text-xs text-gray-500">
							cost of first upgrade in scraps
							{#if formBaseUpgradeCost !== optimalPricing.baseUpgradeCost}
								<span class="text-yellow-600">· optimal: {optimalPricing.baseUpgradeCost}</span>
							{/if}
						</p>
					</div>
					<div>
						<label for="costMultiplier" class="mb-1 block text-sm font-bold"
							>cost multiplier (%)</label
						>
						<input
							id="costMultiplier"
							type="number"
							bind:value={formCostMultiplier}
							min="100"
							class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none {formCostMultiplier !==
							optimalPricing.costMultiplier
								? 'border-yellow-500'
								: ''}"
						/>
						<p class="mt-1 text-xs text-gray-500">
							110 = 1.10× per upgrade
							{#if formCostMultiplier !== optimalPricing.costMultiplier}
								<span class="text-yellow-600">· optimal: {optimalPricing.costMultiplier}%</span>
							{/if}
						</p>
					</div>
				</div>

				<!-- EV Analysis Panel -->
				{#if formEV}
					<div
						class="rounded-xl border-4 p-4 {formEV.isExploitable
							? 'border-red-600 bg-red-50'
							: 'border-green-600 bg-green-50'}"
					>
						<div class="mb-3 flex items-center justify-between">
							<h3
								class="flex items-center gap-2 text-sm font-bold {formEV.isExploitable
									? 'text-red-700'
									: 'text-green-700'}"
							>
								{#if formEV.isExploitable}
									<AlertTriangle size={16} />
									EV ANALYSIS — EXPLOITABLE
								{:else}
									<ShieldCheck size={16} />
									EV ANALYSIS — SAFE
								{/if}
							</h3>
							<button
								onclick={() => (showDetailedEV = !showDetailedEV)}
								class="cursor-pointer text-xs font-bold underline {formEV.isExploitable
									? 'text-red-600'
									: 'text-green-700'}"
							>
								{showDetailedEV ? 'hide details' : 'show details'}
							</button>
						</div>

						<div class="grid grid-cols-2 gap-3 text-xs">
							<div>
								<span class="text-gray-500">house edge:</span>
								<span class="ml-1 font-bold">+{formEV.houseEdgePercent}%</span>
							</div>
							<div>
								<span class="text-gray-500">base roll cost:</span>
								<span class="ml-1 font-bold"
									>{calculateRollCost(formPrice, formBaseProbability, formRollCostOverride)} scraps</span
								>
								{#if formRollCostOverride != null}
									<span class="ml-1 text-xs text-yellow-600">(overridden)</span>
								{/if}
							</div>
							<div>
								<span class="text-gray-500">player best (lv{formEV.bestPlayerLevel}):</span>
								<span class="ml-1 font-bold {formEV.bestPlayerRatio < 1 ? 'text-red-600' : ''}">
									{formEV.bestPlayerCost} scraps ({formEV.bestPlayerRatio}× price)
								</span>
							</div>
							<div>
								<span class="text-gray-500">upgrades to 100%:</span>
								<span class="ml-1 font-bold"
									>{formBoostAmount > 0
										? Math.ceil((100 - formBaseProbability) / formBoostAmount)
										: 0} upgrades</span
								>
							</div>
						</div>

						{#if formEV.isExploitable}
							<div class="mt-3 rounded-lg bg-red-100 p-2 text-xs font-bold text-red-700">
								⚠ Users can profit at upgrade level {formEV.bestPlayerLevel} — expected cost ({formEV.bestPlayerCost})
								is below item price ({formPrice}). Increase upgrade costs or lower boost amount.
							</div>
						{/if}

						{#if showDetailedEV}
							<div class="mt-3 max-h-64 overflow-y-auto">
								<table class="w-full text-left text-xs">
									<thead class="sticky top-0 bg-white">
										<tr class="border-b border-gray-300">
											<th class="px-1 py-1">lv</th>
											<th class="px-1 py-1">displayed</th>
											<th class="px-1 py-1">actual</th>
											<th class="px-1 py-1">roll cost</th>
											<th class="px-1 py-1">upgr cost</th>
											<th class="px-1 py-1">E[rolls]</th>
											<th class="px-1 py-1">E[total]</th>
											<th class="px-1 py-1">ratio</th>
										</tr>
									</thead>
									<tbody>
										{#each formEV.results as r}
											<tr
												class="border-b border-gray-200 {r.upgradeLevel === formEV.bestPlayerLevel
													? formEV.isExploitable
														? 'bg-red-200 font-bold'
														: 'bg-green-200 font-bold'
													: ''}"
											>
												<td class="px-1 py-1">{r.upgradeLevel}</td>
												<td class="px-1 py-1">{r.effectiveProbability}%</td>
												<td class="px-1 py-1">{r.actualWinChance}%</td>
												<td class="px-1 py-1">{r.rollCost}</td>
												<td class="px-1 py-1">{r.upgradeCostCumulative}</td>
												<td class="px-1 py-1">{r.expectedRolls}</td>
												<td class="px-1 py-1 {r.evRatio < 1 ? 'font-bold text-red-600' : ''}"
													>{r.expectedTotalCost}</td
												>
												<td class="px-1 py-1 {r.evRatio < 1 ? 'font-bold text-red-600' : ''}"
													>{r.evRatio}×</td
												>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							<p class="mt-2 text-xs text-gray-500">
								highlighted row = optimal user strategy (lowest expected cost). ratio {'<'} 1.0× means
								user profits.
							</p>
						{/if}
					</div>
				{/if}
			</div>

			<div class="mt-6 flex gap-3">
				<button
					onclick={closeModal}
					disabled={saving}
					class="flex-1 cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
				>
					{$t.common.cancel}
				</button>
				<button
					onclick={handleSubmit}
					disabled={saving}
					class="flex-1 cursor-pointer rounded-full border-4 border-black bg-black px-4 py-2 font-bold text-white transition-all duration-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{saving ? $t.common.saving : editingItem ? $t.common.save : $t.common.create}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if deleteConfirmId}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => e.target === e.currentTarget && (deleteConfirmId = null)}
		onkeydown={(e) => e.key === 'Escape' && (deleteConfirmId = null)}
		role="dialog"
		tabindex="-1"
	>
		<div class="w-full max-w-md rounded-2xl border-4 border-black bg-white p-6">
			<h2 class="mb-4 text-2xl font-bold">{$t.admin.confirmDelete}</h2>
			<p class="mb-6 text-gray-600">
				are you sure you want to delete this item? <span class="mt-2 block text-red-600"
					>this action cannot be undone.</span
				>
			</p>
			<div class="flex gap-3">
				<button
					onclick={() => (deleteConfirmId = null)}
					class="flex-1 cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
				>
					{$t.common.cancel}
				</button>
				<button
					onclick={confirmDelete}
					class="flex-1 cursor-pointer rounded-full border-4 border-black bg-red-600 px-4 py-2 font-bold text-white transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
				>
					{$t.common.delete}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showResetConfirm}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => e.target === e.currentTarget && (showResetConfirm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showResetConfirm = false)}
		role="dialog"
		tabindex="-1"
	>
		<div class="w-full max-w-md rounded-2xl border-4 border-black bg-white p-6">
			<h2 class="mb-4 text-2xl font-bold">reset non-buyer refinery</h2>
			<p class="mb-6 text-gray-600">
				this will delete all refinery orders and spending history for users who have never won or
				purchased an item, refunding their scraps. this cannot be undone.
			</p>
			<div class="flex gap-3">
				<button
					onclick={() => (showResetConfirm = false)}
					disabled={resettingRefinery}
					class="flex-1 cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
				>
					cancel
				</button>
				<button
					onclick={resetNonBuyerRefinery}
					disabled={resettingRefinery}
					class="flex-1 cursor-pointer rounded-full border-4 border-black bg-red-600 px-4 py-2 font-bold text-white transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
				>
					{resettingRefinery ? 'resetting...' : 'reset'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if errorModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => e.target === e.currentTarget && (errorModal = null)}
		onkeydown={(e) => e.key === 'Escape' && (errorModal = null)}
		role="dialog"
		tabindex="-1"
	>
		<div class="w-full max-w-md rounded-2xl border-4 border-black bg-white p-6">
			<h2 class="mb-4 text-2xl font-bold">{$t.common.error}</h2>
			<p class="mb-6 text-gray-600">{errorModal}</p>
			<button
				onclick={() => (errorModal = null)}
				class="w-full cursor-pointer rounded-full border-4 border-black bg-black px-4 py-2 font-bold text-white transition-all duration-200 hover:border-dashed"
			>
				{$t.common.ok}
			</button>
		</div>
	</div>
{/if}
