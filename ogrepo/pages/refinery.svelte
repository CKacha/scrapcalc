<script lang="ts">
	import { onMount } from 'svelte';
	import { Undo2 } from '@lucide/svelte';
	import { getUser, refreshUserScraps, userScrapsStore } from '$lib/auth-client';
	import { shopItemsStore, shopLoading, fetchShopItems, type ShopItem } from '$lib/stores';
	import { t } from '$lib/i18n';

	let probabilityItems = $derived($shopItemsStore.filter((item) => item.baseProbability > 0));
	let upgrading = $state<number | null>(null);
	let undoing = $state<number | null>(null);
	let alertMessage = $state<string | null>(null);

	function getProbabilityColor(probability: number): string {
		if (probability >= 70) return 'text-green-600';
		if (probability >= 40) return 'text-yellow-600';
		return 'text-red-600';
	}

	async function upgradeProbability(item: ShopItem) {
		upgrading = item.id;
		try {
			const res = await fetch(
				`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/shop/items/${item.id}/upgrade-probability`,
				{
					method: 'POST',
					credentials: 'include'
				}
			);
			const data = await res.json();
			if (data.error) {
				alertMessage = data.error;
				return;
			}
			shopItemsStore.update((items) =>
				items.map((i) =>
					i.id === item.id
						? {
								...i,
								userBoostPercent: data.boostPercent,
								effectiveProbability: data.effectiveProbability,
								nextUpgradeCost: data.nextCost
							}
						: i
				)
			);
			await refreshUserScraps();
		} catch (e) {
			alertMessage = $t.refinery.failedToUpgrade;
		} finally {
			upgrading = null;
		}
	}

	async function undoRefinery(item: ShopItem) {
		undoing = item.id;
		try {
			const res = await fetch(
				`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/shop/items/${item.id}/refinery/undo`,
				{
					method: 'POST',
					credentials: 'include'
				}
			);
			const data = await res.json();
			if (data.error) {
				alertMessage = data.error;
				return;
			}
			shopItemsStore.update((items) =>
				items.map((i) =>
					i.id === item.id
						? {
								...i,
								userBoostPercent: data.boostPercent,
								upgradeCount: data.upgradeCount,
								effectiveProbability: data.effectiveProbability,
								nextUpgradeCost: data.nextCost
							}
						: i
				)
			);
			await refreshUserScraps();
			alertMessage = `Refunded ${data.refundedCost} scraps`;
		} catch (e) {
			alertMessage = $t.refinery.failedToUndo || 'Failed to undo upgrade';
		} finally {
			undoing = null;
		}
	}

	async function undoAllRefinery(item: ShopItem) {
		undoing = item.id;
		try {
			const res = await fetch(
				`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/shop/items/${item.id}/refinery/undo-all`,
				{
					method: 'POST',
					credentials: 'include'
				}
			);
			const data = await res.json();
			if (data.error) {
				alertMessage = data.error;
				return;
			}
			shopItemsStore.update((items) =>
				items.map((i) =>
					i.id === item.id
						? {
								...i,
								userBoostPercent: data.boostPercent,
								upgradeCount: data.upgradeCount,
								effectiveProbability: data.effectiveProbability,
								nextUpgradeCost: data.nextCost
							}
						: i
				)
			);
			await refreshUserScraps();
			alertMessage = `Refunded ${data.refundedCost} scraps (${data.undoneCount} upgrades)`;
		} catch (e) {
			alertMessage = 'Failed to undo upgrades';
		} finally {
			undoing = null;
		}
	}

	onMount(async () => {
		await getUser();
		fetchShopItems();
	});
</script>

<svelte:head>
	<title>{$t.refinery.refinery} - scraps</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-24 pb-24 md:px-12">
	<div class="mb-8">
		<h1 class="mb-2 text-4xl font-bold md:text-5xl">{$t.refinery.refinery}</h1>
		<p class="text-lg text-gray-600">{$t.refinery.upgradeYourLuck}</p>
	</div>

	{#if $shopLoading}
		<div class="py-12 text-center text-gray-500">{$t.common.loading}</div>
	{:else if probabilityItems.length > 0}
		<div class="space-y-6">
			{#each probabilityItems as item (item.id)}
				{@const nextCost = item.nextUpgradeCost}
				{@const maxed = item.effectiveProbability >= 100 || nextCost === null}
				{@const soldOut = item.count === 0}
				<div
					class="rounded-2xl border-4 border-black p-4 transition-all hover:border-dashed sm:p-6 {soldOut
						? 'bg-gray-100'
						: ''}"
				>
					<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
						<div class="flex flex-1 items-start gap-4">
							{#if item.image}
								<img
									src={item.image}
									alt={item.name}
									class="h-12 w-12 shrink-0 rounded-lg border-2 border-black object-cover sm:h-16 sm:w-16 {soldOut
										? 'opacity-50 grayscale'
										: ''}"
								/>
							{:else}
								<div
									class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-gray-100 sm:h-16 sm:w-16 {soldOut
										? 'opacity-50 grayscale'
										: ''}"
								>
									<span class="text-xl sm:text-2xl">?</span>
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<h3 class="truncate text-lg font-bold sm:text-xl">{item.name}</h3>
									{#if soldOut}
										<span class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600"
											>{$t.shop.soldOut}</span
										>
									{/if}
								</div>
								<div class="mt-1 flex flex-wrap items-center gap-2">
									<span
										class="text-xl font-bold sm:text-2xl {getProbabilityColor(
											item.effectiveProbability
										)}"
									>
										{item.effectiveProbability}%
									</span>
									<span class="text-xs text-gray-600 sm:text-sm">
										({item.baseProbability}% + {item.userBoostPercent}%{#if item.adjustedBaseProbability < item.baseProbability}<span
												class="text-red-500"
											>
												- {item.baseProbability - item.adjustedBaseProbability}% {$t.refinery
													.fromPreviousBuy}</span
											>{/if})
									</span>
								</div>
							</div>
						</div>
						<div class="flex items-center gap-2 sm:text-right">
							{#if soldOut}
								{#if item.userBoostPercent > 0}
									<button
										onclick={() => undoAllRefinery(item)}
										disabled={undoing === item.id}
										class="cursor-pointer rounded-full border-4 border-red-600 px-4 py-2 text-sm font-bold text-red-600 transition-all duration-200 hover:border-dashed disabled:opacity-50 sm:text-base"
									>
										{undoing === item.id ? '...' : 'undo all'}
									</button>
								{/if}
								<span class="rounded-full bg-gray-200 px-4 py-2 font-bold text-gray-600"
									>{$t.shop.soldOut}</span
								>
							{:else}
								{#if item.userBoostPercent > 0}
									<button
										onclick={() => undoRefinery(item)}
										disabled={undoing === item.id}
										class="cursor-pointer rounded-full border-4 border-black px-4 py-2 text-sm font-bold transition-all duration-200 hover:border-dashed disabled:opacity-50 sm:text-base"
									>
										{undoing === item.id ? '...' : $t.refinery.undo}
									</button>
								{/if}
								{#if maxed}
									<span class="rounded-full bg-gray-200 px-4 py-2 font-bold text-gray-600"
										>{$t.refinery.maxed}</span
									>
								{:else if nextCost !== null}
									<button
										onclick={() => upgradeProbability(item)}
										disabled={upgrading === item.id || $userScrapsStore < nextCost}
										class="w-full cursor-pointer rounded-full bg-black px-4 py-2 text-sm font-bold text-white transition-all duration-200 hover:bg-gray-800 disabled:opacity-50 sm:w-auto sm:text-base"
									>
										{#if upgrading === item.id}
											{$t.refinery.upgrading}
										{:else}
											+{item.boostAmount}% ({nextCost} {$t.common.scraps})
										{/if}
									</button>
								{/if}
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="py-12 text-center text-gray-500">{$t.refinery.noItemsAvailable}</div>
	{/if}
</div>

{#if alertMessage}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => e.target === e.currentTarget && (alertMessage = null)}
		onkeydown={(e) => e.key === 'Escape' && (alertMessage = null)}
		role="dialog"
		tabindex="-1"
	>
		<div class="w-full max-w-md rounded-2xl border-4 border-black bg-white p-6">
			<h2 class="mb-4 text-2xl font-bold">{$t.common.error}</h2>
			<p class="mb-6 text-gray-600">{alertMessage}</p>
			<button
				onclick={() => (alertMessage = null)}
				class="w-full cursor-pointer rounded-full border-4 border-black bg-black px-4 py-2 font-bold text-white transition-all duration-200 hover:border-dashed"
			>
				{$t.refinery.ok}
			</button>
		</div>
	</div>
{/if}
