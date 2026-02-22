<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, ChevronRight, ArrowUpDown, ArrowLeft } from '@lucide/svelte';
	import ProjectPlaceholder from '$lib/components/ProjectPlaceholder.svelte';
	import { getUser } from '$lib/auth-client';
	import { API_URL } from '$lib/config';
	import { formatHours } from '$lib/utils';
	import { t } from '$lib/i18n';

	interface Project {
		id: number;
		userId: number;
		name: string;
		description: string;
		image: string | null;
		status: string;
		hours: number;
		effectiveHours: number;
		deductedHours: number;
	}

	interface Pagination {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
	}

	interface User {
		id: number;
		username: string;
		email: string;
		avatar: string | null;
		slackId: string | null;
		scraps: number;
		role: string;
	}

	let user = $state<User | null>(null);
	let projects = $state<Project[]>([]);
	let pagination = $state<Pagination | null>(null);
	let loading = $state(true);
	let sortOrder = $state<'oldest' | 'newest'>('oldest');
	let scraps = $derived(user?.scraps ?? 0);

	async function fetchSecondPass(page = 1) {
		loading = true;
		try {
			const response = await fetch(`${API_URL}/admin/second-pass?page=${page}&limit=12&sort=${sortOrder}`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				projects = data.data || [];
				pagination = data.pagination;
			}
		} catch (e) {
			console.error('Failed to fetch second-pass reviews:', e);
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		user = await getUser();
		if (!user || user.role !== 'admin') {
			goto('/dashboard');
			return;
		}
		await fetchSecondPass();
	});

	function goToPage(page: number) {
		fetchSecondPass(page);
	}

	function toggleSort() {
		sortOrder = sortOrder === 'oldest' ? 'newest' : 'oldest';
		fetchSecondPass(1);
	}
</script>

<svelte:head>
	<title>second pass reviews - admin - scraps</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-24 pb-32 md:px-12">
	<a
		href="/admin"
		class="mb-8 inline-flex cursor-pointer items-center gap-2 font-bold hover:underline"
	>
		<ArrowLeft size={20} />
		back to admin
	</a>

	<div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="mb-2 text-4xl font-bold md:text-5xl">second pass reviews</h1>
			<p class="text-lg text-gray-600">projects approved by reviewers, awaiting admin confirmation</p>
		</div>
		<button
			onclick={toggleSort}
			class="flex cursor-pointer items-center gap-2 rounded-full border-2 border-black px-4 py-2 text-sm font-bold transition-all hover:border-dashed"
		>
			<ArrowUpDown size={16} />
			sort: {sortOrder === 'oldest' ? 'oldest first' : 'newest first'}
		</button>
	</div>

	{#if loading}
		<div class="py-12 text-center text-gray-500">loading...</div>
	{:else if projects.length === 0}
		<div class="py-12 text-center">
			<p class="text-xl text-gray-500">no projects pending second-pass review</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
			{#each projects as project}
				<a
					href="/admin/second-pass/{project.id}"
					class="flex flex-col overflow-hidden rounded-2xl border-4 border-yellow-500 bg-yellow-50 transition-all hover:border-dashed"
				>
					<div class="h-40 overflow-hidden">
						{#if project.image}
							<img src={project.image} alt={project.name} class="h-full w-full object-cover" />
						{:else}
							<ProjectPlaceholder seed={project.id} />
						{/if}
					</div>
					<div class="p-4">
						<h3 class="mb-1 text-xl font-bold">{project.name}</h3>
						<p class="mb-2 line-clamp-2 text-sm text-gray-600">{project.description}</p>
						<div class="flex flex-wrap items-center gap-2">
							{#if project.deductedHours > 0}
								<span class="rounded-full bg-gray-100 px-3 py-1 text-sm font-bold text-gray-400 line-through"
									>{formatHours(project.hours)}h</span
								>
								<span class="rounded-full border-2 border-yellow-600 bg-yellow-100 px-3 py-1 text-sm font-bold text-yellow-800"
									>{formatHours(project.effectiveHours)}h</span
								>
							{:else}
								<span class="rounded-full bg-gray-100 px-3 py-1 text-sm font-bold"
									>{formatHours(project.hours)}h</span
								>
							{/if}
							<span class="rounded-full bg-yellow-200 px-3 py-1 text-xs font-bold text-yellow-800">
								PENDING APPROVAL
							</span>
						</div>
					</div>
				</a>
			{/each}
		</div>

		<!-- Pagination -->
		{#if pagination && pagination.totalPages > 1}
			<div class="mt-8 flex items-center justify-center gap-4">
				<button
					onclick={() => goToPage(pagination!.page - 1)}
					disabled={pagination.page <= 1}
					class="cursor-pointer rounded-full border-2 border-black p-2 transition-all hover:border-dashed disabled:cursor-not-allowed disabled:opacity-30"
				>
					<ChevronLeft size={20} />
				</button>
				<span class="font-bold">
					Page
					{pagination.page}
					of
					{pagination.totalPages}
				</span>
				<button
					onclick={() => goToPage(pagination!.page + 1)}
					disabled={pagination.page >= pagination.totalPages}
					class="cursor-pointer rounded-full border-2 border-black p-2 transition-all hover:border-dashed disabled:cursor-not-allowed disabled:opacity-30"
				>
					<ChevronRight size={20} />
				</button>
			</div>
		{/if}
	{/if}
</div>
