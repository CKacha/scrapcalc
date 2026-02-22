<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Plus, Pencil, Trash2, X, Eye, EyeOff } from '@lucide/svelte';
	import { getUser } from '$lib/auth-client';
	import { API_URL } from '$lib/config';
	import { t } from '$lib/i18n';

	interface NewsItem {
		id: number;
		title: string;
		content: string;
		active: boolean;
		createdAt: string;
		updatedAt: string;
	}

	interface User {
		id: number;
		role: string;
	}

	let user = $state<User | null>(null);
	let items = $state<NewsItem[]>([]);
	let loading = $state(true);
	let saving = $state(false);

	let showModal = $state(false);
	let editingItem = $state<NewsItem | null>(null);

	let formTitle = $state('');
	let formContent = $state('');
	let formActive = $state(true);
	let formError = $state<string | null>(null);
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
			const response = await fetch(`${API_URL}/admin/news`, {
				credentials: 'include'
			});
			if (response.ok) {
				items = await response.json();
			}
		} catch (e) {
			console.error('Failed to fetch news:', e);
		} finally {
			loading = false;
		}
	}

	function openCreateModal() {
		editingItem = null;
		formTitle = '';
		formContent = '';
		formActive = true;
		formError = null;
		showModal = true;
	}

	function openEditModal(item: NewsItem) {
		editingItem = item;
		formTitle = item.title;
		formContent = item.content;
		formActive = item.active;
		formError = null;
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editingItem = null;
	}

	async function handleSubmit() {
		if (!formTitle.trim() || !formContent.trim()) {
			formError = 'Title and content are required';
			return;
		}

		saving = true;
		formError = null;

		try {
			const url = editingItem ? `${API_URL}/admin/news/${editingItem.id}` : `${API_URL}/admin/news`;

			const response = await fetch(url, {
				method: editingItem ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					title: formTitle,
					content: formContent,
					active: formActive
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
			formError = 'Failed to save news';
		} finally {
			saving = false;
		}
	}

	async function toggleActive(item: NewsItem) {
		try {
			const response = await fetch(`${API_URL}/admin/news/${item.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ active: !item.active })
			});
			if (response.ok) {
				await fetchItems();
			}
		} catch (e) {
			console.error('Failed to toggle:', e);
		}
	}

	function requestDelete(id: number) {
		deleteConfirmId = id;
	}

	async function confirmDelete() {
		if (!deleteConfirmId) return;

		try {
			const response = await fetch(`${API_URL}/admin/news/${deleteConfirmId}`, {
				method: 'DELETE',
				credentials: 'include'
			});
			if (response.ok) {
				await fetchItems();
			}
		} catch (e) {
			console.error('Failed to delete:', e);
		} finally {
			deleteConfirmId = null;
		}
	}

	function formatDate(dateString: string) {
		return new Date(dateString).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>{$t.nav.news} - {$t.nav.admin} - scraps</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-24 pb-24 md:px-12">
	<div class="mb-8 flex items-center justify-between">
		<div>
			<h1 class="mb-2 text-4xl font-bold md:text-5xl">{$t.nav.news}</h1>
			<p class="text-lg text-gray-600">{$t.admin.manageAnnouncementsAndUpdates}</p>
		</div>
		<button
			onclick={openCreateModal}
			class="flex cursor-pointer items-center gap-2 rounded-full bg-black px-6 py-3 font-bold text-white transition-all duration-200 hover:bg-gray-800"
		>
			<Plus size={20} />
			{$t.admin.addNews}
		</button>
	</div>

	{#if loading}
		<div class="py-12 text-center text-gray-500">{$t.common.loading}</div>
	{:else if items.length === 0}
		<div class="py-12 text-center text-gray-500">{$t.news.noNewsRightNow}</div>
	{:else}
		<div class="grid gap-4">
			{#each items as item}
				<div class="rounded-2xl border-4 border-black p-4 {item.active ? '' : 'opacity-50'}">
					<div class="flex items-start gap-4">
						<div class="min-w-0 flex-1">
							<div class="mb-1 flex items-center gap-2">
								<h3 class="text-xl font-bold">{item.title}</h3>
								{#if !item.active}
									<span class="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-bold">hidden</span>
								{/if}
							</div>
							<p class="mb-2 text-gray-600">{item.content}</p>
							<p class="text-sm text-gray-400">{formatDate(item.createdAt)}</p>
						</div>
						<div class="flex shrink-0 gap-2">
							<button
								onclick={() => toggleActive(item)}
								class="cursor-pointer rounded-lg border-4 border-black p-2 transition-all duration-200 hover:border-dashed"
								title={item.active ? 'Hide' : 'Show'}
							>
								{#if item.active}
									<EyeOff size={18} />
								{:else}
									<Eye size={18} />
								{/if}
							</button>
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
				<h2 class="text-2xl font-bold">{editingItem ? $t.admin.editNews : $t.admin.addNews}</h2>
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
					<label for="title" class="mb-1 block text-sm font-bold">title</label>
					<input
						id="title"
						type="text"
						bind:value={formTitle}
						class="w-full rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
					/>
				</div>

				<div>
					<label for="content" class="mb-1 block text-sm font-bold">content</label>
					<textarea
						id="content"
						bind:value={formContent}
						rows="4"
						class="w-full resize-none rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
					></textarea>
				</div>

				<div class="flex items-center gap-2">
					<input
						id="active"
						type="checkbox"
						bind:checked={formActive}
						class="h-5 w-5 rounded border-2 border-black"
					/>
					<label for="active" class="font-bold">active (visible to users)</label>
				</div>
			</div>

			<div class="mt-6 flex gap-3">
				<button
					onclick={closeModal}
					disabled={saving}
					class="flex-1 cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed disabled:opacity-50"
				>
					{$t.common.cancel}
				</button>
				<button
					onclick={handleSubmit}
					disabled={saving}
					class="flex-1 cursor-pointer rounded-full border-4 border-black bg-black px-4 py-2 font-bold text-white transition-all duration-200 hover:bg-gray-800 disabled:opacity-50"
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
				are you sure you want to delete this news item? <span class="mt-2 block text-red-600"
					>this action cannot be undone.</span
				>
			</p>
			<div class="flex gap-3">
				<button
					onclick={() => (deleteConfirmId = null)}
					class="flex-1 cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed"
				>
					{$t.common.cancel}
				</button>
				<button
					onclick={confirmDelete}
					class="flex-1 cursor-pointer rounded-full border-4 border-black bg-red-600 px-4 py-2 font-bold text-white transition-all duration-200 hover:border-dashed"
				>
					{$t.common.delete}
				</button>
			</div>
		</div>
	</div>
{/if}
