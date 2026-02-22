<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Check,
		X,
		Github,
		AlertTriangle,
		CheckCircle,
		XCircle,
		Info,
		Globe,
		ArrowLeft,
		RefreshCw,
		Bot,
		MessageSquare,
		ShieldAlert,
		Lock
	} from '@lucide/svelte';
	import ProjectPlaceholder from '$lib/components/ProjectPlaceholder.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import { getUser } from '$lib/auth-client';
	import { API_URL } from '$lib/config';
	import { formatHours } from '$lib/utils';

	interface Review {
		id: number;
		action: string;
		feedbackForAuthor: string;
		internalJustification: string | null;
		reviewerName: string | null;
		reviewerAvatar: string | null;
		reviewerId: number;
		createdAt: string;
	}

	interface ProjectUser {
		id: number;
		username: string | null;
		avatar: string | null;
		internalNotes: string | null;
	}

	interface OverlappingProject {
		id: number;
		name: string;
		hours: number;
	}

	interface Project {
		id: number;
		userId: number;
		name: string;
		description: string;
		image: string | null;
		githubUrl: string | null;
		playableUrl: string | null;
		hackatimeProject: string | null;
		status: string;
		hours: number;
		hoursOverride: number | null;
		tier: number;
		tierOverride: number | null;
		feedbackSource: string | null;
		feedbackGood: string | null;
		feedbackImprove: string | null;
		updateDescription: string | null;
		aiDescription: string | null;
		reviewerNotes: string | null;
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
	let project = $state<Project | null>(null);
	let projectUser = $state<ProjectUser | null>(null);
	let reviews = $state<Review[]>([]);
	let overlappingProjects = $state<OverlappingProject[]>([]);
	let hackatimeUserId = $state<number | null>(null);
	let hackatimeSuspected = $state(false);
	let hackatimeBanned = $state(false);
	let loading = $state(true);
	let submitting = $state(false);
	let error = $state<string | null>(null);

	let feedbackForAuthor = $state('');
	let hoursOverride = $state<number | undefined>(undefined);
	let confirmAction = $state<'accept' | 'reject' | null>(null);

	let deductedHours = $derived(
		overlappingProjects.reduce((sum: number, op: OverlappingProject) => sum + op.hours, 0)
	);
	let effectiveHours = $derived(
		project ? Math.max(0, (hoursOverride ?? project.hoursOverride ?? project.hours) - deductedHours) : 0
	);
	let hoursOverrideError = $derived(
		hoursOverride !== undefined && project && hoursOverride > project.hours
			? `hours override cannot exceed project hours (${formatHours(project.hours)}h)`
			: null
	);

	let projectId = $derived(page.params.id);

	// Find the approval review
	let approvalReview = $derived(reviews.find((r) => r.action === 'approved'));

	onMount(async () => {
		user = await getUser();
		if (!user || user.role !== 'admin') {
			goto('/dashboard');
			return;
		}

		try {
			const response = await fetch(`${API_URL}/admin/second-pass/${projectId}`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				if (data.error) {
					error = data.error;
					loading = false;
					return;
				}
				project = data.project;
				projectUser = data.user;
				reviews = data.reviews || [];
				overlappingProjects = data.overlappingProjects || [];
				hackatimeUserId = data.hackatimeUserId ?? null;
				hackatimeSuspected = data.hackatimeSuspected || false;
				hackatimeBanned = data.hackatimeBanned || false;
				if (data.project?.hoursOverride != null) {
					hoursOverride = data.project.hoursOverride;
				}
			}
		} catch (e) {
			console.error('Failed to fetch second-pass review:', e);
		} finally {
			loading = false;
		}
	});

	function requestConfirmation(action: 'accept' | 'reject') {
		if (action === 'reject' && !feedbackForAuthor.trim()) {
			error = 'feedback for author is required when rejecting';
			return;
		}
		error = null;
		confirmAction = action;
	}

	function cancelConfirmation() {
		confirmAction = null;
	}

	async function submitReview() {
		if (!confirmAction) return;

		if (confirmAction === 'reject' && !feedbackForAuthor.trim()) {
			error = 'feedback for author is required when rejecting';
			return;
		}

		submitting = true;
		error = null;

		try {
			const response = await fetch(`${API_URL}/admin/second-pass/${projectId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					action: confirmAction,
					feedbackForAuthor: confirmAction === 'reject' ? feedbackForAuthor : undefined,
					hoursOverride: hoursOverride !== undefined ? hoursOverride : undefined
				})
			});

			const data = await response.json();
			if (data.error) {
				throw new Error(data.error);
			}

			goto('/admin/second-pass');
		} catch (e) {
			error = e instanceof Error ? e.message : 'failed to submit review';
		} finally {
			submitting = false;
			confirmAction = null;
		}
	}

	function getReviewIcon(action: string) {
		switch (action) {
			case 'approved':
				return CheckCircle;
			case 'denied':
				return AlertTriangle;
			case 'permanently_rejected':
			case 'scraps_unawarded':
				return XCircle;
			default:
				return Info;
		}
	}

	function getReviewIconColor(action: string) {
		switch (action) {
			case 'approved':
				return 'text-green-600';
			case 'denied':
				return 'text-yellow-600';
			case 'permanently_rejected':
			case 'scraps_unawarded':
				return 'text-red-600';
			default:
				return 'text-gray-600';
		}
	}
</script>

<svelte:head>
	<title>second pass review - admin - scraps</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-6 pt-24 pb-32 md:px-12">
	{#if loading}
		<div class="py-12 text-center text-gray-500">loading...</div>
	{:else if !project}
		<div class="py-12 text-center">
			<p class="mb-4 text-xl text-gray-500">project not found</p>
			<a
				href="/admin/second-pass"
				class="inline-flex cursor-pointer items-center gap-2 font-bold hover:underline"
			>
				<ArrowLeft size={20} />
				back to second pass reviews
			</a>
		</div>
	{:else}
		<a
			href="/admin/second-pass"
			class="mb-8 inline-flex cursor-pointer items-center gap-2 font-bold hover:underline"
		>
			<ArrowLeft size={20} />
			back to second pass reviews
		</a>

		<!-- Hackatime Status Banners -->
		{#if hackatimeBanned}
			<div class="mb-6 rounded-2xl border-4 border-red-600 bg-red-50 p-4">
				<div class="flex items-center gap-3">
					<ShieldAlert size={20} class="text-red-600" />
					<div>
						<p class="font-bold text-red-800">hackatime banned</p>
						<p class="text-sm text-red-700">this user is banned on hackatime. they will be redirected to fraud.land on login.</p>
					</div>
				</div>
			</div>
		{/if}
		{#if hackatimeSuspected}
			<div class="mb-6 rounded-2xl border-4 border-orange-500 bg-orange-50 p-4">
				<div class="flex items-center gap-3">
					<ShieldAlert size={20} class="text-orange-600" />
					<div>
						<p class="font-bold text-orange-800">hackatime suspected</p>
						<p class="text-sm text-orange-700">this user is flagged as suspected on hackatime. please review their activity carefully.</p>
					</div>
				</div>
			</div>
		{/if}

		<!-- Status Banner (yellow alert for pending admin approval) -->
		<div class="mb-6 rounded-2xl border-4 border-yellow-500 bg-yellow-50 p-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<AlertTriangle size={20} class="text-yellow-600" />
					<div>
						<p class="font-bold text-yellow-800">pending admin approval</p>
						<p class="text-sm text-yellow-700">
							this project was approved by a reviewer and awaits your final confirmation
						</p>
					</div>
				</div>
				<a
					href="/projects/{project.id}"
					class="font-bold text-yellow-600 underline hover:text-black"
					>view project</a
				>
			</div>
		</div>

		<!-- Project Image -->
		<div class="mb-6 h-64 w-full overflow-hidden rounded-2xl border-4 border-black md:h-80">
			{#if project.image}
				<img src={project.image} alt={project.name} class="h-full w-full object-cover" />
			{:else}
				<ProjectPlaceholder seed={project.id} />
			{/if}
		</div>

		<!-- Project Info -->
		<div class="mb-6 rounded-2xl border-4 border-black p-6">
			<div class="mb-2 flex items-start justify-between">
				<h1 class="text-3xl font-bold">{project.name}</h1>
				<span
					class="rounded-full border-2 border-yellow-600 bg-yellow-100 px-3 py-1 text-sm font-bold text-yellow-800"
				>
					pending approval
				</span>
			</div>
			<Markdown content={project.description} class="mb-4 text-gray-600" />
			{#if project.updateDescription}
				<div class="mb-4 rounded-lg border-2 border-dashed border-gray-400 bg-gray-50 p-4">
					<p class="mb-1 flex items-center gap-1.5 text-sm font-bold text-gray-600">
						<RefreshCw size={14} />
						what was updated
					</p>
					<p class="text-gray-700">{project.updateDescription}</p>
				</div>
			{/if}
			{#if project.aiDescription}
				<div class="mb-4 rounded-lg border-2 border-dashed border-purple-400 bg-purple-50 p-4">
					<p class="mb-1 flex items-center gap-1.5 text-sm font-bold text-purple-600">
						<Bot size={14} />
						ai was used
					</p>
					<p class="text-purple-700">{project.aiDescription}</p>
				</div>
			{/if}
			{#if project.reviewerNotes}
				<div class="mb-4 rounded-lg border-2 border-dashed border-blue-400 bg-blue-50 p-4">
					<p class="mb-1 flex items-center gap-1.5 text-sm font-bold text-blue-600">
						<MessageSquare size={14} />
						notes from author
					</p>
					<p class="text-blue-700">{project.reviewerNotes}</p>
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-3 text-sm">
				{#if deductedHours > 0}
					<span
						class="rounded-full border-2 border-black bg-gray-100 px-3 py-1 font-bold text-gray-400 line-through"
						>{formatHours(project.hours)}h logged</span
					>
					<span
						class="rounded-full border-2 border-yellow-500 bg-yellow-100 px-3 py-1 font-bold text-yellow-800"
						>{formatHours(effectiveHours)}h effective</span
					>
				{:else}
					<span class="rounded-full border-2 border-black bg-gray-100 px-3 py-1 font-bold"
						>{formatHours(project.hours)}h logged</span
					>
				{/if}
				{#if project.hackatimeProject}
					<span class="rounded-full border-2 border-black bg-gray-100 px-3 py-1 font-bold"
						>hackatime: {project.hackatimeProject}</span
					>
				{/if}
				<span class="rounded-full border-2 border-black bg-gray-100 px-3 py-1 font-bold"
					>tier {project.tier}</span
				>
			</div>

			{#if overlappingProjects.length > 0}
				<div class="mt-4 rounded-lg border-2 border-dashed border-yellow-500 bg-yellow-50 p-4">
					<p class="mb-2 flex items-center gap-1.5 text-sm font-bold text-yellow-700">
						<AlertTriangle size={14} />
						shared hackatime project — hours will be deducted
					</p>
					<p class="mb-2 text-sm text-yellow-700">
						this project shares a hackatime project with other shipped projects. hours from those
						projects will be subtracted when calculating scraps.
					</p>
					<ul class="mb-3 space-y-1 text-sm text-yellow-800">
						{#each overlappingProjects as op}
							<li class="flex items-center gap-2">
								<span>•</span>
								<a href="/projects/{op.id}" class="font-bold underline">{op.name}</a>
								<span>— {formatHours(op.hours)}h</span>
							</li>
						{/each}
					</ul>
					<div class="flex flex-wrap gap-3 text-sm font-bold">
						<span
							class="rounded-full border-2 border-yellow-600 bg-yellow-100 px-3 py-1 text-yellow-800"
						>
							total: {formatHours(project.hoursOverride ?? project.hours)}h
						</span>
						<span
							class="rounded-full border-2 border-yellow-600 bg-yellow-100 px-3 py-1 text-yellow-800"
						>
							deducted: -{formatHours(deductedHours)}h
						</span>
						<span class="rounded-full border-2 border-black bg-yellow-200 px-3 py-1 text-black">
							effective: {formatHours(effectiveHours)}h
						</span>
					</div>
				</div>
			{/if}

			<div class="mt-4 flex flex-wrap gap-3">
				{#if project.githubUrl}
					<a
						href={project.githubUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex cursor-pointer items-center gap-2 rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed"
					>
						<Github size={18} />
						<span>view on github</span>
					</a>
				{:else}
					<span
						class="inline-flex cursor-not-allowed items-center gap-2 rounded-full border-4 border-dashed border-gray-300 px-4 py-2 font-bold text-gray-400"
					>
						<Github size={18} />
						<span>view on github</span>
					</span>
				{/if}
				{#if project.playableUrl}
					<a
						href={project.playableUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex cursor-pointer items-center gap-2 rounded-full border-4 border-solid border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed"
					>
						<Globe size={18} />
						<span>try it out</span>
					</a>
				{:else}
					<span
						class="inline-flex cursor-not-allowed items-center gap-2 rounded-full border-4 border-dashed border-gray-300 px-4 py-2 font-bold text-gray-400"
					>
						<Globe size={18} />
						<span>try it out</span>
					</span>
				{/if}
				{#if hackatimeUserId}
					<a
						href="https://joe.fraud.hackclub.com/profile/{hackatimeUserId}"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex cursor-pointer items-center gap-2 rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed"
					>
						<ShieldAlert size={18} />
						<span>fraud check</span>
					</a>
				{/if}
				{#if project.githubUrl}
					<button
						onclick={async () => {
							if (project?.githubUrl) {
								await navigator.clipboard.writeText(project.githubUrl);
								window.open('https://airlock.hackclub.com/', '_blank');
							}
						}}
						class="inline-flex cursor-pointer items-center gap-2 rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed"
					>
						<Lock size={18} />
						<span>airlock</span>
					</button>
				{/if}
			</div>

			<!-- User Info (clickable) -->
			{#if projectUser}
				<a
					href="/admin/users/{projectUser.id}"
					class="-mx-6 mt-6 -mb-6 flex cursor-pointer items-center gap-4 border-t-2 border-gray-200 px-6 pt-6 pb-6 transition-all hover:bg-gray-50"
				>
					{#if projectUser.avatar}
						<img
							src={projectUser.avatar}
							alt=""
							class="h-12 w-12 rounded-full border-2 border-black"
						/>
					{:else}
						<div class="h-12 w-12 rounded-full border-2 border-black bg-gray-200"></div>
					{/if}
					<div class="flex-1">
						<p class="font-bold">{projectUser.username || 'unknown'}</p>
					</div>
					<span class="text-sm text-gray-500">view profile →</span>
				</a>
			{/if}
		</div>

		<!-- Author Feedback -->
		{#if project.feedbackSource || project.feedbackGood || project.feedbackImprove}
			<div class="mb-6 rounded-2xl border-4 border-black bg-white p-6">
				<h2 class="mb-4 text-xl font-bold">author feedback</h2>
				<div class="space-y-4">
					{#if project.feedbackSource}
						<div>
							<p class="mb-1 text-sm font-bold text-gray-500">how did you hear about this?</p>
							<p class="text-gray-700">{project.feedbackSource}</p>
						</div>
					{/if}
					{#if project.feedbackGood}
						<div>
							<p class="mb-1 text-sm font-bold text-gray-500">what are we doing well?</p>
							<p class="text-gray-700">{project.feedbackGood}</p>
						</div>
					{/if}
					{#if project.feedbackImprove}
						<div>
							<p class="mb-1 text-sm font-bold text-gray-500">how can we improve?</p>
							<p class="text-gray-700">{project.feedbackImprove}</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Reviewer's Approval -->
		{#if approvalReview}
			<div class="mb-6 rounded-2xl border-4 border-green-500 bg-green-50 p-6">
				<h2 class="mb-4 text-xl font-bold text-green-800">reviewer approval</h2>
				<div
					class="rounded-lg border-2 border-green-600 bg-white p-4 transition-all duration-200"
				>
					<div class="mb-2 flex items-center justify-between">
						<a
							href="/admin/users/{approvalReview.reviewerId}"
							class="flex cursor-pointer items-center gap-2 transition-all duration-200 hover:opacity-80"
						>
							{#if approvalReview.reviewerAvatar}
								<img
									src={approvalReview.reviewerAvatar}
									alt=""
									class="h-6 w-6 rounded-full border-2 border-black"
								/>
							{:else}
								<div class="h-6 w-6 rounded-full border-2 border-black bg-gray-200"></div>
							{/if}
							<CheckCircle size={18} class="text-green-600" />
							<span class="font-bold">{approvalReview.reviewerName || 'reviewer'}</span>
						</a>
						<div class="flex items-center gap-2">
							<span class="rounded border border-green-600 bg-green-100 px-2 py-1 text-xs font-bold text-green-700">
								approved
							</span>
							<span class="text-xs text-gray-500">
								{new Date(approvalReview.createdAt).toLocaleDateString()}
							</span>
						</div>
					</div>
					<p class="mb-2 text-sm text-gray-700">
						<strong>feedback:</strong>
						{approvalReview.feedbackForAuthor}
					</p>
					{#if approvalReview.internalJustification}
						<p class="text-sm text-gray-500">
							<strong>internal:</strong>
							{approvalReview.internalJustification}
						</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- User Internal Notes (read-only) -->
		{#if projectUser?.internalNotes}
			<div class="mb-6 rounded-2xl border-4 border-black bg-white p-6">
				<h2 class="mb-4 text-xl font-bold">user internal notes</h2>
				<div class="rounded-lg border-2 border-gray-300 bg-gray-50 p-4">
					<p class="whitespace-pre-wrap text-sm text-gray-700">{projectUser.internalNotes}</p>
				</div>
			</div>
		{/if}

		{#if error}
			<div class="mb-6 rounded-lg border-2 border-red-500 bg-red-100 p-4 text-red-700">
				{error}
			</div>
		{/if}

		<!-- Review Form -->
		<div class="rounded-2xl border-4 border-black p-6">
			<h2 class="mb-4 text-xl font-bold">admin decision</h2>
			<div class="space-y-4">
				<div>
					<label class="mb-1 block text-sm font-bold">hours override {#if deductedHours > 0}<span class="font-normal text-yellow-600">(effective: {formatHours(effectiveHours)}h after -{formatHours(deductedHours)}h deduction)</span>{/if}</label>
					<input
						type="number"
						step="0.1"
						min="0"
						max={project.hours}
						bind:value={hoursOverride}
						placeholder="{formatHours(project.hoursOverride ?? project.hours)}h ({formatHours(effectiveHours)}h effective)"
						class="w-full rounded-lg border-2 px-4 py-2 focus:border-dashed focus:outline-none {hoursOverrideError
							? 'border-red-500'
							: 'border-black'}"
					/>
					{#if hoursOverrideError}
						<p class="mt-1 text-sm text-red-500">{hoursOverrideError}</p>
					{/if}
				</div>

				<div>
					<label class="mb-1 block text-sm font-bold">
						rejection feedback <span class="text-gray-500">(required only if rejecting)</span>
					</label>
					<textarea
						bind:value={feedbackForAuthor}
						rows="4"
						placeholder="explain why you're rejecting this approval (user will see this)"
						class="w-full resize-none rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
					></textarea>
				</div>

				<div class="flex gap-3 pt-4">
					<button
						onclick={() => requestConfirmation('accept')}
						disabled={submitting || !!hoursOverrideError}
						class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border-4 border-black bg-green-600 px-4 py-3 font-bold text-white transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Check size={20} />
						<span>accept & ship</span>
					</button>
					<button
						onclick={() => requestConfirmation('reject')}
						disabled={submitting || !!hoursOverrideError}
						class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border-4 border-black bg-red-600 px-4 py-3 font-bold text-white transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
					>
						<X size={20} />
						<span>reject approval</span>
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- Confirmation Modal -->
{#if confirmAction}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => e.target === e.currentTarget && cancelConfirmation()}
		onkeydown={(e) => e.key === 'Escape' && cancelConfirmation()}
		role="dialog"
		tabindex="-1"
	>
		<div class="w-full max-w-md rounded-2xl border-4 border-black bg-white p-6">
			<h2 class="mb-4 text-2xl font-bold">
				confirm {confirmAction === 'accept' ? 'acceptance' : 'rejection'}
			</h2>
			<p class="mb-6 text-gray-600">
				{#if confirmAction === 'accept'}
					are you sure you want to <strong>accept</strong> this approval and ship the project? the
					user will be notified and scraps will be awarded.
				{:else}
					are you sure you want to <strong>reject</strong> this approval? the original approval review
					will be deleted and the user will need to resubmit.
				{/if}
			</p>
			<div class="flex gap-3">
				<button
					onclick={cancelConfirmation}
					disabled={submitting}
					class="flex-1 cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed disabled:opacity-50"
				>
					cancel
				</button>
				<button
					onclick={submitReview}
					disabled={submitting}
					class="flex-1 cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed disabled:opacity-50 {confirmAction ===
					'accept'
						? 'bg-green-600 text-white'
						: 'bg-red-600 text-white'}"
				>
					{submitting
						? 'processing...'
						: confirmAction === 'accept'
							? 'accept & ship'
							: 'reject approval'}
				</button>
			</div>
		</div>
	</div>
{/if}
