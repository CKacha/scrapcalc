<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Check,
		X,
		Ban,
		Github,
		AlertTriangle,
		CheckCircle,
		XCircle,
		Info,
		Globe,
		RefreshCw,
		Bot,
		Loader,
		ArrowLeft,
		MessageSquare,
		ShieldAlert,
		Clipboard,
		Lock
	} from '@lucide/svelte';
	import ProjectPlaceholder from '$lib/components/ProjectPlaceholder.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import { getUser } from '$lib/auth-client';
	import { API_URL } from '$lib/config';
	import { formatHours } from '$lib/utils';
	import { t } from '$lib/i18n';

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
		email?: string;
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
		deleted: number | null;
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
	let savingNotes = $state(false);
	let syncing = $state(false);
	let error = $state<string | null>(null);
	let scraps = $derived(user?.scraps ?? 0);

	let feedbackForAuthor = $state('');
	let internalJustification = $state('');
	let userInternalNotes = $state('');
	let hoursOverride = $state<number | undefined>(undefined);
	let tierOverride = $state<number | undefined>(undefined);

	let deductedHours = $derived(
		overlappingProjects.reduce((sum: number, op: OverlappingProject) => sum + op.hours, 0)
	);
	let effectiveHours = $derived(
		project ? Math.max(0, (hoursOverride ?? project.hours) - deductedHours) : 0
	);

	let hoursOverrideError = $derived(
		hoursOverride !== undefined && project && hoursOverride > project.hours
			? `Hours override cannot exceed project hours (${formatHours(project.hours)}h)`
			: null
	);

	let confirmAction = $state<'approved' | 'denied' | 'permanently_rejected' | null>(null);
	let errorModal = $state<string | null>(null);

	let projectId = $derived(page.params.id);

	onMount(async () => {
		user = await getUser();
		if (!user || (user.role !== 'admin' && user.role !== 'reviewer')) {
			goto('/dashboard');
			return;
		}

		try {
			const response = await fetch(`${API_URL}/admin/reviews/${projectId}`, {
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
				userInternalNotes = data.user?.internalNotes || '';

				// Check if project is deleted
				if (project?.deleted) {
					error = 'This project has been deleted';
				}
			}
		} catch (e) {
			console.error('Failed to fetch review:', e);
		} finally {
			loading = false;
		}
	});

	async function saveUserNotes() {
		if (!projectUser) return;
		savingNotes = true;
		try {
			await fetch(`${API_URL}/admin/users/${projectUser.id}/notes`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ internalNotes: userInternalNotes })
			});
		} catch (e) {
			console.error('Failed to save notes:', e);
		} finally {
			savingNotes = false;
		}
	}

	async function syncHours() {
		if (!project || syncing) return;
		syncing = true;
		try {
			const response = await fetch(`${API_URL}/admin/projects/${projectId}/sync-hours`, {
				method: 'POST',
				credentials: 'include'
			});
			const data = await response.json();
			if (data.error) {
				error = data.error;
			} else if (data.updated && project) {
				project = { ...project, hours: data.hours };
			}
		} catch (e) {
			console.error('Failed to sync hours:', e);
			error = 'Failed to sync hours';
		} finally {
			syncing = false;
		}
	}

	function requestConfirmation(action: 'approved' | 'denied' | 'permanently_rejected') {
		if (!feedbackForAuthor.trim()) {
			error = 'Feedback for author is required';
			return;
		}
		if (!internalJustification.trim()) {
			error = 'Internal justification is required';
			return;
		}
		confirmAction = action;
	}

	function cancelConfirmation() {
		confirmAction = null;
	}

	async function submitReview() {
		if (!confirmAction) return;
		if (!feedbackForAuthor.trim()) {
			error = 'Feedback for author is required';
			return;
		}
		if (!internalJustification.trim()) {
			error = 'Internal justification is required';
			return;
		}

		submitting = true;
		error = null;

		try {
			const response = await fetch(`${API_URL}/admin/reviews/${projectId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					action: confirmAction,
					feedbackForAuthor,
					internalJustification: internalJustification || undefined,
					hoursOverride: hoursOverride !== undefined ? hoursOverride : undefined,
					tierOverride: tierOverride !== undefined ? tierOverride : undefined,
					userInternalNotes: userInternalNotes || undefined
				})
			});

			const data = await response.json();
			if (data.error) {
				errorModal = data.error;
				throw new Error(data.error);
			}

			goto('/admin/reviews');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to submit review';
		} finally {
			submitting = false;
			confirmAction = null;
		}
	}

	function getActionLabel(action: string) {
		switch (action) {
			case 'approved':
				return 'approve';
			case 'denied':
				return 'reject';
			case 'permanently_rejected':
				return 'permanently reject';
			default:
				return action;
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

	function getStatusTag(status: string) {
		switch (status) {
			case 'shipped':
				return {
					label: 'approved',
					bg: 'bg-green-100',
					text: 'text-green-700',
					border: 'border-green-600'
				};
			case 'in_progress':
			case 'waiting_for_review':
				return {
					label: 'in progress',
					bg: 'bg-yellow-100',
					text: 'text-yellow-700',
					border: 'border-yellow-600'
				};
			case 'permanently_rejected':
				return {
					label: 'permanently rejected',
					bg: 'bg-red-100',
					text: 'text-red-700',
					border: 'border-red-600'
				};
			default:
				return {
					label: status.replace(/_/g, ' '),
					bg: 'bg-gray-100',
					text: 'text-gray-700',
					border: 'border-gray-600'
				};
		}
	}
</script>

<svelte:head>
	<title>review {project?.name || 'project'} - admin - scraps</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-6 pt-24 pb-32 md:px-12">
	{#if loading}
		<div class="py-12 text-center text-gray-500">{$t.common.loading}</div>
	{:else if !project}
		<div class="py-12 text-center">
			<p class="mb-4 text-xl text-gray-500">{$t.project.projectNotFound}</p>
			<a
				href="/admin/reviews"
				class="inline-flex cursor-pointer items-center gap-2 font-bold hover:underline"
			>
				<ArrowLeft size={20} />
				{$t.project.back}
			</a>
		</div>
	{:else if project.deleted}
		<div class="py-12 text-center">
			<p class="mb-2 text-xl text-gray-500">this project has been deleted</p>
			<p class="mb-4 text-gray-400">status: {project.status}</p>
			<a
				href="/admin/reviews"
				class="inline-flex cursor-pointer items-center gap-2 font-bold hover:underline"
			>
				<ArrowLeft size={20} />
				back to reviews
			</a>
		</div>
	{:else}
		<a
			href="/admin/reviews"
			class="mb-8 inline-flex cursor-pointer items-center gap-2 font-bold hover:underline"
		>
			<ArrowLeft size={20} />
			back to reviews
		</a>

		{@const isReviewable = project.status === 'waiting_for_review'}

		<!-- Hackatime Status Banners (admin-only) -->
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

		<!-- Status Banner (shown when project is not waiting for review) -->
		{#if !isReviewable}
			<div class="mb-6 rounded-2xl border-4 border-gray-400 bg-gray-100 p-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<Info size={20} class="text-gray-500" />
						<div>
							<p class="font-bold text-gray-700">this project is not waiting for review</p>
							<p class="text-sm text-gray-500">status: {project.status}</p>
						</div>
					</div>
					<a href="/projects/{project.id}" class="font-bold underline text-gray-600 hover:text-black">view project</a>
				</div>
			</div>
		{/if}
		<!-- Project Image -->
		<div class="mb-6 h-64 w-full overflow-hidden rounded-2xl border-4 border-black md:h-80">
			{#if project.image}
				<img src={project.image} alt={project.name} class="h-full w-full object-cover" />
			{:else}
				<ProjectPlaceholder seed={project.id} />
			{/if}
		</div>

		<!-- Project Info -->
		{@const statusTag = getStatusTag(project.status)}
		<div class="mb-6 rounded-2xl border-4 border-black p-6">
			<div class="mb-2 flex items-start justify-between">
				<h1 class="text-3xl font-bold">{project.name}</h1>
				<span
					class="rounded-full border-2 px-3 py-1 text-sm font-bold {statusTag.bg} {statusTag.text} {statusTag.border}"
				>
					{statusTag.label}
				</span>
			</div>
			<Markdown content={project.description} class="mb-4 text-gray-600" />
			{#if project.updateDescription}
				<div class="mb-4 rounded-lg border-2 border-dashed border-gray-400 bg-gray-50 p-4">
					<p class="mb-1 flex items-center gap-1.5 text-sm font-bold text-gray-600">
						<RefreshCw size={14} />
						{$t.project.whatWasUpdated}
					</p>
					<p class="text-gray-700">{project.updateDescription}</p>
				</div>
			{/if}
			{#if project.aiDescription}
				<div class="mb-4 rounded-lg border-2 border-dashed border-purple-400 bg-purple-50 p-4">
					<p class="mb-1 flex items-center gap-1.5 text-sm font-bold text-purple-600">
						<Bot size={14} />
						{$t.project.aiWasUsed}
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
					<span class="rounded-full border-2 border-black bg-gray-100 px-3 py-1 font-bold text-gray-400 line-through"
						>{formatHours(project.hours)}h logged</span
					>
					<span class="rounded-full border-2 border-yellow-500 bg-yellow-100 px-3 py-1 font-bold text-yellow-800"
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
						this project shares a hackatime project with other shipped projects. hours from those projects will be subtracted when calculating scraps.
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
						<span class="rounded-full border-2 border-yellow-600 bg-yellow-100 px-3 py-1 text-yellow-800">
							total: {formatHours(hoursOverride ?? project.hours)}h
						</span>
						<span class="rounded-full border-2 border-yellow-600 bg-yellow-100 px-3 py-1 text-yellow-800">
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
						<span>{$t.project.viewOnGithub}</span>
					</a>
				{:else}
					<span
						class="inline-flex cursor-not-allowed items-center gap-2 rounded-full border-4 border-dashed border-gray-300 px-4 py-2 font-bold text-gray-400"
					>
						<Github size={18} />
						<span>{$t.project.viewOnGithub}</span>
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
						<span>{$t.project.tryItOut}</span>
					</a>
				{:else}
					<span
						class="inline-flex cursor-not-allowed items-center gap-2 rounded-full border-4 border-dashed border-gray-300 px-4 py-2 font-bold text-gray-400"
					>
						<Globe size={18} />
						<span>{$t.project.tryItOut}</span>
					</span>
				{/if}
				{#if user?.role === 'admin' && project.status !== 'shipped'}
					<button
						onclick={syncHours}
						disabled={syncing}
						class="inline-flex cursor-pointer items-center gap-2 rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
					>
						<RefreshCw size={18} class={syncing ? 'animate-spin' : ''} />
						<span>{syncing ? 'syncing...' : 'sync hours'}</span>
					</button>
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
						{#if projectUser.email}
							<p class="text-sm text-gray-500">{projectUser.email}</p>
						{/if}
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
							<p class="mb-1 text-sm font-bold text-gray-500">How did you hear about this?</p>
							<p class="text-gray-700">{project.feedbackSource}</p>
						</div>
					{/if}
					{#if project.feedbackGood}
						<div>
							<p class="mb-1 text-sm font-bold text-gray-500">What are we doing well?</p>
							<p class="text-gray-700">{project.feedbackGood}</p>
						</div>
					{/if}
					{#if project.feedbackImprove}
						<div>
							<p class="mb-1 text-sm font-bold text-gray-500">How can we improve?</p>
							<p class="text-gray-700">{project.feedbackImprove}</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Previous Reviews -->
		{#if reviews.length > 0}
			<div class="mb-6 rounded-2xl border-4 border-black p-6">
				<h2 class="mb-4 text-xl font-bold">previous reviews</h2>
				<div class="space-y-4">
					{#each [...reviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) as review}
						{@const ReviewIcon = getReviewIcon(review.action)}
						<div
							class="rounded-lg border-2 border-black p-4 transition-all duration-200 hover:border-dashed"
						>
							<div class="mb-2 flex items-center justify-between">
								<a
									href="/admin/users/{review.reviewerId}"
									class="flex cursor-pointer items-center gap-2 transition-all duration-200 hover:opacity-80"
								>
									{#if review.reviewerAvatar}
										<img
											src={review.reviewerAvatar}
											alt=""
											class="h-6 w-6 rounded-full border-2 border-black"
										/>
									{:else}
										<div class="h-6 w-6 rounded-full border-2 border-black bg-gray-200"></div>
									{/if}
									<ReviewIcon size={18} class={getReviewIconColor(review.action)} />
									<span class="font-bold">{review.reviewerName || $t.project.reviewer}</span>
								</a>
								<div class="flex items-center gap-2">
									<span
										class="rounded border px-2 py-1 text-xs font-bold {review.action === 'approved'
											? 'border-green-600 bg-green-100 text-green-700'
											: review.action === 'denied'
												? 'border-yellow-600 bg-yellow-100 text-yellow-700'
												: 'border-red-600 bg-red-100 text-red-700'}"
									>
										{review.action === 'permanently_rejected' ? 'rejected' : review.action === 'scraps_unawarded' ? 'scraps unawarded' : review.action}
									</span>
									<span class="text-xs text-gray-500">
										{new Date(review.createdAt).toLocaleString()}
									</span>
								</div>
							</div>
							<p class="mb-2 text-sm text-gray-700">
								<strong>Feedback:</strong>
								{review.feedbackForAuthor}
							</p>
							{#if review.internalJustification}
								<p class="text-sm text-gray-500">
									<strong>Internal:</strong>
									{review.internalJustification}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if error && isReviewable}
			<div class="mb-6 rounded-lg border-2 border-red-500 bg-red-100 p-4 text-red-700">
				{error}
			</div>
		{/if}

		<!-- User Internal Notes Section (always interactive) -->
		{#if projectUser}
			<div class="mb-6 rounded-2xl border-4 border-black bg-white p-6">
				<h2 class="mb-4 text-xl font-bold">user internal notes</h2>
				<textarea
					bind:value={userInternalNotes}
					rows="3"
					placeholder="Notes about this user (visible to reviewers only)"
					class="w-full resize-none rounded-lg border-2 border-black bg-white px-4 py-2 focus:border-dashed focus:outline-none"
				></textarea>
				<div class="mt-3 flex items-center justify-between">
					<p class="text-xs text-gray-500">these notes persist across all reviews for this user</p>
					<button
						onclick={saveUserNotes}
						disabled={savingNotes}
						class="cursor-pointer rounded-full bg-black px-4 py-2 text-sm font-bold text-white transition-all duration-200 hover:bg-gray-800 disabled:opacity-50"
					>
						{savingNotes ? $t.common.saving : 'save notes'}
					</button>
				</div>
			</div>
		{/if}

		<!-- Review-only sections (sold-out effect when not reviewable) -->
		<div class="relative {!isReviewable ? 'pointer-events-none select-none opacity-50 grayscale' : ''}">

			<!-- Tier Reference -->
			<div class="mb-6 rounded-2xl border-4 border-black p-6">
				<h2 class="mb-4 text-xl font-bold">tier reference</h2>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="rounded-lg border-2 {project.tier === 1 ? 'border-black bg-black text-white' : 'border-gray-300'} px-4 py-3">
						<div class="flex items-center justify-between">
							<span class="font-bold">tier 1</span>
							<span class="text-sm {project.tier === 1 ? 'text-gray-300' : 'text-gray-500'}">0.8×</span>
						</div>
						<p class="mt-1 text-xs {project.tier === 1 ? 'text-gray-300' : 'text-gray-500'}">
							{$t.project.tierDescriptions.tier1}
						</p>
					</div>
					<div class="rounded-lg border-2 {project.tier === 2 ? 'border-black bg-black text-white' : 'border-gray-300'} px-4 py-3">
						<div class="flex items-center justify-between">
							<span class="font-bold">tier 2</span>
							<span class="text-sm {project.tier === 2 ? 'text-gray-300' : 'text-gray-500'}">1.0×</span>
						</div>
						<p class="mt-1 text-xs {project.tier === 2 ? 'text-gray-300' : 'text-gray-500'}">
							{$t.project.tierDescriptions.tier2}
						</p>
					</div>
					<div class="rounded-lg border-2 {project.tier === 3 ? 'border-black bg-black text-white' : 'border-gray-300'} px-4 py-3">
						<div class="flex items-center justify-between">
							<span class="font-bold">tier 3</span>
							<span class="text-sm {project.tier === 3 ? 'text-gray-300' : 'text-gray-500'}">1.25×</span>
						</div>
						<p class="mt-1 text-xs {project.tier === 3 ? 'text-gray-300' : 'text-gray-500'}">
							{$t.project.tierDescriptions.tier3}
						</p>
					</div>
					<div class="rounded-lg border-2 {project.tier === 4 ? 'border-black bg-black text-white' : 'border-gray-300'} px-4 py-3">
						<div class="flex items-center justify-between">
							<span class="font-bold">tier 4</span>
							<span class="text-sm {project.tier === 4 ? 'text-gray-300' : 'text-gray-500'}">1.5×</span>
						</div>
						<p class="mt-1 text-xs {project.tier === 4 ? 'text-gray-300' : 'text-gray-500'}">
							{$t.project.tierDescriptions.tier4}
						</p>
					</div>
				</div>
			</div>

			<!-- Review Form -->
			<div class="rounded-2xl border-4 border-black p-6">
				<h2 class="mb-4 text-xl font-bold">submit review</h2>
				<div class="space-y-4">
					<div>
						<label class="mb-1 block text-sm font-bold">hours override {#if deductedHours > 0}<span class="font-normal text-yellow-600">(effective: {formatHours(effectiveHours)}h after -{formatHours(deductedHours)}h deduction)</span>{/if}</label>
						<input
							type="number"
							step="0.1"
							min="0"
							max={project.hours}
							bind:value={hoursOverride}
							placeholder="{formatHours(project.hours)} ({formatHours(effectiveHours)}h effective)"
							class="w-full rounded-lg border-2 px-4 py-2 focus:border-dashed focus:outline-none {hoursOverrideError
								? 'border-red-500'
								: 'border-black'}"
						/>
						{#if hoursOverrideError}
							<p class="mt-1 text-sm text-red-500">{hoursOverrideError}</p>
						{/if}
					</div>

					<div>
						<label class="mb-1 block text-sm font-bold">tier override</label>
						<select
							bind:value={tierOverride}
							class="w-full cursor-pointer rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
						>
							<option value={undefined}>use user's tier (tier {project.tier})</option>
							{#each [1, 2, 3, 4] as tier}
								<option value={tier}>tier {tier}</option>
							{/each}
						</select>
					</div>

					<div>
						<label class="mb-1 block text-sm font-bold"
							>internal justification <span class="text-red-500">*</span></label
						>
						<textarea
							bind:value={internalJustification}
							rows="2"
							placeholder="Internal notes about this review decision"
							class="w-full resize-none rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
						></textarea>
					</div>

					<div>
						<label class="mb-1 block text-sm font-bold">
							feedback for author <span class="text-red-500">*</span>
						</label>
						<textarea
							bind:value={feedbackForAuthor}
							rows="4"
							placeholder="This will be shown to the project author"
							class="w-full resize-none rounded-lg border-2 border-black px-4 py-2 focus:border-dashed focus:outline-none"
						></textarea>
					</div>

					<div class="flex gap-3 pt-4">
						<button
							onclick={() => requestConfirmation('approved')}
							disabled={submitting || !!hoursOverrideError || !isReviewable}
							class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border-4 border-black bg-green-600 px-4 py-3 font-bold text-white transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Check size={20} />
							<span>approve</span>
						</button>
						<button
							onclick={() => requestConfirmation('denied')}
							disabled={submitting || !!hoursOverrideError || !isReviewable}
							class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border-4 border-black bg-yellow-500 px-4 py-3 font-bold text-white transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
						>
							<X size={20} />
							<span>reject</span>
						</button>
						<button
							onclick={() => requestConfirmation('permanently_rejected')}
							disabled={submitting || !!hoursOverrideError || !isReviewable}
							class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border-4 border-black bg-red-600 px-4 py-3 font-bold text-white transition-all duration-200 hover:border-dashed disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Ban size={20} />
							<span>permanently reject</span>
						</button>
					</div>
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
			<h2 class="mb-4 text-2xl font-bold">confirm {getActionLabel(confirmAction)}</h2>
			<p class="mb-6 text-gray-600">
				are you sure you want to <strong>{getActionLabel(confirmAction)}</strong> this project?
				{#if confirmAction === 'permanently_rejected'}
					<span class="mt-2 block text-red-600">this action cannot be undone.</span>
				{/if}
			</p>
			<div class="flex gap-3">
				<button
					onclick={cancelConfirmation}
					disabled={submitting}
					class="flex-1 cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed disabled:opacity-50"
				>
					{$t.common.cancel}
				</button>
				<button
					onclick={submitReview}
					disabled={submitting}
					class="flex-1 cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed disabled:opacity-50 {confirmAction ===
					'approved'
						? 'bg-green-600 text-white'
						: confirmAction === 'denied'
							? 'bg-yellow-500 text-white'
							: 'bg-red-600 text-white'}"
				>
					{submitting ? 'submitting...' : getActionLabel(confirmAction)}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Error Modal -->
{#if errorModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => e.target === e.currentTarget && (errorModal = null)}
		onkeydown={(e) => e.key === 'Escape' && (errorModal = null)}
		role="dialog"
		tabindex="-1"
	>
		<div class="w-full max-w-md rounded-2xl border-4 border-red-600 bg-white p-6">
			<div class="mb-4 flex items-center gap-3">
				<AlertTriangle size={28} class="text-red-600" />
				<h2 class="text-2xl font-bold text-red-600">error</h2>
			</div>
			<p class="mb-6 text-gray-700">{errorModal}</p>
			<button
				onclick={() => (errorModal = null)}
				class="w-full cursor-pointer rounded-full border-4 border-black px-4 py-2 font-bold transition-all duration-200 hover:border-dashed"
			>
				ok
			</button>
		</div>
	</div>
{/if}
