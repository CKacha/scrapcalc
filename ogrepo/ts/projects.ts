import { Elysia } from 'elysia'
import { eq, and, sql, desc, inArray, or, isNull, isNotNull, ilike } from 'drizzle-orm'
import { db } from '../db'
import { projectsTable } from '../schemas/projects'
import { reviewsTable } from '../schemas/reviews'
import { usersTable } from '../schemas/users'
import { projectActivityTable } from '../schemas/activity'
import { getUserFromSession, fetchUserIdentity } from '../lib/auth'
import { syncSingleProject, getHackatimeUser } from '../lib/hackatime-sync'
import { notifyProjectSubmitted } from '../lib/slack'
import { submitProjectToYSWS } from '../lib/ysws'
import { config } from '../config'
import { computeEffectiveHoursForProject } from '../lib/effective-hours'

const ALLOWED_IMAGE_DOMAIN = 'cdn.hackclub.com'

function parseHackatimeProject(hackatimeProject: string | null): string | null {
	if (!hackatimeProject) return null
	return hackatimeProject.trim()
}

async function prefixHackatimeIds(hackatimeProject: string | null, email: string): Promise<string | null> {
	if (!hackatimeProject) return null
	const names = hackatimeProject.split(',').map(p => p.trim()).filter(p => p.length > 0)
	if (names.length === 0) return null

	// Check if already prefixed (has numeric id: prefix)
	const alreadyPrefixed = names.every(n => {
		const colonIdx = n.indexOf(':')
		return colonIdx !== -1 && !n.startsWith('U') && !isNaN(parseInt(n.substring(0, colonIdx), 10))
	})
	if (alreadyPrefixed) return hackatimeProject

	const hackatimeUser = await getHackatimeUser(email)
	if (!hackatimeUser || typeof hackatimeUser.user_id !== 'number') return hackatimeProject

	return names.map(name => {
		const colonIdx = name.indexOf(':')
		if (colonIdx !== -1 && !name.startsWith('U') && !isNaN(parseInt(name.substring(0, colonIdx), 10))) {
			return name
		}
		const slashIdx = name.indexOf('/')
		if (slashIdx !== -1 && name.startsWith('U')) {
			name = name.substring(slashIdx + 1)
		}
		return `${hackatimeUser.user_id}:${name}`
	}).join(',')
}

function stripHackatimeIds(hackatimeProject: string | null): string | null {
	if (!hackatimeProject) return null
	return hackatimeProject
		.split(',')
		.map(entry => {
			const trimmed = entry.trim()
			const colonIdx = trimmed.indexOf(':')
			if (colonIdx !== -1 && !trimmed.startsWith('U')) {
				return trimmed.substring(colonIdx + 1)
			}
			const slashIdx = trimmed.indexOf('/')
			if (slashIdx !== -1 && trimmed.startsWith('U')) {
				return trimmed.substring(slashIdx + 1)
			}
			return trimmed
		})
		.join(',') || null
}

function parseHackatimeProjects(hackatimeProject: string | null): string | null {
	if (!hackatimeProject) return null
	return hackatimeProject
		.split(',')
		.map(p => p.trim())
		.filter(p => p.length > 0)
		.join(',')
		|| null
}

function validateImageUrl(imageUrl: string | null | undefined): boolean {
	if (!imageUrl) return true
	try {
		const url = new URL(imageUrl)
		return url.hostname === ALLOWED_IMAGE_DOMAIN
	} catch {
		return false
	}
}

function validatePlayableUrl(playableUrl: string | null | undefined): { valid: boolean; error?: string } {
	if (!playableUrl || !playableUrl.trim()) return { valid: true }
	const trimmed = playableUrl.trim()

	let url: URL
	try {
		url = new URL(trimmed)
	} catch {
		return { valid: false, error: 'Playable URL is not a valid URL' }
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		return { valid: false, error: 'Playable URL must use http or https' }
	}

	// Must have a proper hostname with at least one dot (no localhost etc in prod)
	if (!url.hostname.includes('.')) {
		return { valid: false, error: 'Playable URL must be a valid public URL' }
	}

	return { valid: true }
}

const projects = new Elysia({ prefix: '/projects' })

// Public explore endpoint - returns minimal data for browsing
projects.get('/explore', async ({ query }) => {
    const page = parseInt(query.page as string) || 1
    const limit = Math.min(parseInt(query.limit as string) || 18, 48)
    const offset = (page - 1) * limit
    const search = (query.search as string)?.trim() || ''
    const tier = query.tier ? parseInt(query.tier as string) : null
    const status = query.status as string || null
    const sortBy = query.sortBy as string || 'default'

    const conditions = [
        or(eq(projectsTable.deleted, 0), isNull(projectsTable.deleted)),
        or(eq(projectsTable.status, 'shipped'), eq(projectsTable.status, 'in_progress'), eq(projectsTable.status, 'waiting_for_review'), eq(projectsTable.status, 'pending_admin_approval'))
    ]

    if (search) {
        conditions.push(
            or(
                ilike(projectsTable.name, `%${search}%`),
                ilike(projectsTable.description, `%${search}%`)
            )!
        )
    }

    if (tier && tier >= 1 && tier <= 4) {
        conditions.push(eq(projectsTable.tier, tier))
    }

    if (status === 'shipped' || status === 'in_progress') {
        conditions[1] = eq(projectsTable.status, status)
    } else if (status === 'waiting_for_review') {
        // Include pending_admin_approval since it appears as waiting_for_review externally
        conditions[1] = or(eq(projectsTable.status, 'waiting_for_review'), eq(projectsTable.status, 'pending_admin_approval'))!
    }

    const whereClause = and(...conditions)

    // Determine order based on sortBy
    let orderClause
    if (sortBy === 'views') {
        orderClause = desc(projectsTable.views)
    } else if (sortBy === 'random') {
        orderClause = sql`RANDOM()`
    } else {
        orderClause = desc(projectsTable.updatedAt)
    }

    const [projectsList, countResult] = await Promise.all([
        db.select({
            id: projectsTable.id,
            name: projectsTable.name,
            description: projectsTable.description,
            image: projectsTable.image,
            hours: projectsTable.hours,
            hoursOverride: projectsTable.hoursOverride,
            tier: projectsTable.tier,
            status: projectsTable.status,
            views: projectsTable.views,
            userId: projectsTable.userId
        })
        .from(projectsTable)
        .where(whereClause)
        .orderBy(orderClause)
        .limit(limit)
        .offset(offset),
        db.select({ count: sql<number>`count(*)` })
        .from(projectsTable)
        .where(whereClause)
    ])

    // Fetch usernames for all projects
    const userIds = [...new Set(projectsList.map(p => p.userId))]
    let users: { id: number; username: string | null }[] = []
    if (userIds.length > 0) {
        users = await db
            .select({ id: usersTable.id, username: usersTable.username })
            .from(usersTable)
            .where(inArray(usersTable.id, userIds))
    }

    const total = Number(countResult[0]?.count || 0)

    return {
        data: projectsList.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description.substring(0, 150) + (p.description.length > 150 ? '...' : ''),
            image: p.image,
            hours: p.hoursOverride ?? p.hours,
            tier: p.tier,
            status: p.status === 'pending_admin_approval' ? 'waiting_for_review' : p.status,
            views: p.views,
            username: users.find(u => u.id === p.userId)?.username || null
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    }
})

projects.get('/', async ({ headers, query }) => {
    const user = await getUserFromSession(headers as Record<string, string>)
    if (!user) return { error: 'Unauthorized' }

    const page = parseInt(query.page as string) || 1
    const limit = Math.min(parseInt(query.limit as string) || 20, 100)
    const offset = (page - 1) * limit

    const [projectsList, countResult] = await Promise.all([
        db.select().from(projectsTable)
            .where(and(
                eq(projectsTable.userId, user.id),
                or(eq(projectsTable.deleted, 0), isNull(projectsTable.deleted))
            ))
            .orderBy(desc(projectsTable.updatedAt))
            .limit(limit)
            .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(projectsTable)
            .where(and(
                eq(projectsTable.userId, user.id),
                or(eq(projectsTable.deleted, 0), isNull(projectsTable.deleted))
            ))
    ])

    const total = Number(countResult[0]?.count || 0)

    return {
        data: projectsList.map(p => ({
            ...p,
            hackatimeProject: stripHackatimeIds(p.hackatimeProject),
            status: p.status === 'pending_admin_approval' ? 'waiting_for_review' : p.status
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    }
})

projects.get('/:id', async ({ params, headers }) => {
    const user = await getUserFromSession(headers as Record<string, string>)
    if (!user) return { error: 'Unauthorized' }

    const project = await db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.id, parseInt(params.id)))
        .limit(1)

    if (!project[0]) return { error: 'Not found' }

    const isOwner = project[0].userId === user.id

    // If not owner, only show shipped, in_progress, waiting_for_review, or pending_admin_approval projects
    if (!isOwner && project[0].status !== 'shipped' && project[0].status !== 'in_progress' && project[0].status !== 'waiting_for_review' && project[0].status !== 'pending_admin_approval') {
        return { error: 'Not found' }
    }

    // Increment view count if not owner
    if (!isOwner) {
        await db
            .update(projectsTable)
            .set({ views: sql`${projectsTable.views} + 1` })
            .where(eq(projectsTable.id, parseInt(params.id)))
    }

    const projectOwner = await db
        .select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar })
        .from(usersTable)
        .where(eq(usersTable.id, project[0].userId))
        .limit(1)

    // Fetch activity (reviews) for owner
    let activity: Array<{
        type: string
        action?: string
        feedbackForAuthor?: string | null
        createdAt: Date | null
        reviewer?: { id: number; username: string | null; avatar: string | null } | null
    }> = []

    // Fetch reviews for activity
    const reviews = await db
            .select({
                id: reviewsTable.id,
                reviewerId: reviewsTable.reviewerId,
                action: reviewsTable.action,
                feedbackForAuthor: reviewsTable.feedbackForAuthor,
                createdAt: reviewsTable.createdAt
            })
            .from(reviewsTable)
            .where(eq(reviewsTable.projectId, parseInt(params.id)))

        const reviewerIds = reviews.map(r => r.reviewerId)
        let reviewers: { id: number; username: string | null; avatar: string | null }[] = []
        if (reviewerIds.length > 0) {
            reviewers = await db
                .select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar })
                .from(usersTable)
                .where(inArray(usersTable.id, reviewerIds))
        }

        // Add review entries
        // Hide approval reviews when project is pending admin approval (internal status)
        const isPendingAdmin = project[0].status === 'pending_admin_approval'
        for (const r of reviews) {
            if (isPendingAdmin && r.action === 'approved') continue
            activity.push({
                type: 'review',
                action: r.action,
                feedbackForAuthor: r.feedbackForAuthor,
                createdAt: r.createdAt,
                reviewer: reviewers.find(rv => rv.id === r.reviewerId) || null
            })
        }

        // Fetch submission and scraps earned events from activity table
        const activityEntries = await db
            .select({
                id: projectActivityTable.id,
                action: projectActivityTable.action,
                createdAt: projectActivityTable.createdAt
            })
            .from(projectActivityTable)
            .where(and(
                eq(projectActivityTable.projectId, parseInt(params.id)),
                or(
                    eq(projectActivityTable.action, 'project_submitted'),
                    eq(projectActivityTable.action, 'project_unsubmitted'),
                    sql`${projectActivityTable.action} LIKE 'earned % scraps'`
                )
            ))

        for (const entry of activityEntries) {
            if (entry.action === 'project_submitted') {
                activity.push({
                    type: 'submitted',
                    createdAt: entry.createdAt
                })
            } else if (entry.action === 'project_unsubmitted') {
                activity.push({
                    type: 'unsubmitted',
                    createdAt: entry.createdAt
                })
            } else if (entry.action.startsWith('earned ') && entry.action.endsWith(' scraps')) {
                activity.push({
                    type: 'scraps_earned',
                    action: entry.action,
                    createdAt: entry.createdAt
                })
            }
        }

        // Add "project created" entry
        activity.push({
            type: 'created',
            createdAt: project[0].createdAt
        })

        // Sort by date descending (newest first)
        activity.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
            return dateB - dateA
        })

    // Check if the user has ever submitted feedback on any project
    let hasSubmittedFeedback = false
    if (isOwner) {
        const feedbackCheck = await db
            .select({ id: projectsTable.id })
            .from(projectsTable)
            .where(and(
                eq(projectsTable.userId, user.id),
                or(
                    isNotNull(projectsTable.feedbackSource),
                    isNotNull(projectsTable.feedbackGood),
                    isNotNull(projectsTable.feedbackImprove)
                )
            ))
            .limit(1)
        hasSubmittedFeedback = feedbackCheck.length > 0
    }

    // Calculate effective hours (subtract overlapping shipped project hours)
    // Uses activity-derived shipped dates for ordering (consistent with Airtable sync and admin review)
    const projectHours = project[0].hoursOverride ?? project[0].hours ?? 0
    const effectiveHoursResult = await computeEffectiveHoursForProject(project[0])
    const effectiveHours = effectiveHoursResult.effectiveHours
    const deductedHours = effectiveHoursResult.deductedHours

    return {
        project: {
            id: project[0].id,
            name: project[0].name,
            description: project[0].description,
            image: project[0].image,
            githubUrl: project[0].githubUrl,
            playableUrl: project[0].playableUrl,
            hackatimeProject: isOwner ? stripHackatimeIds(project[0].hackatimeProject) : undefined,
            hours: projectHours,
            hoursOverride: isOwner ? project[0].hoursOverride : undefined,
            tier: project[0].tier,
            tierOverride: isOwner ? project[0].tierOverride : undefined,
            status: project[0].status === 'pending_admin_approval' ? 'waiting_for_review' : project[0].status,
            scrapsAwarded: project[0].scrapsAwarded,
            views: project[0].views,
            updateDescription: project[0].updateDescription,
            aiDescription: isOwner ? project[0].aiDescription : undefined,
            reviewerNotes: isOwner ? project[0].reviewerNotes : undefined,
            usedAi: !!project[0].aiDescription,
            effectiveHours,
            deductedHours,
            createdAt: project[0].createdAt,
            updatedAt: project[0].updatedAt
        },
        owner: projectOwner[0] || null,
        isOwner,
        hasSubmittedFeedback: isOwner ? hasSubmittedFeedback : undefined,
        activity
    }
})

projects.post('/', async ({ body, headers }) => {
    const user = await getUserFromSession(headers as Record<string, string>)
    if (!user) return { error: 'Unauthorized' }

    const data = body as {
        name: string
        description: string
        image?: string
        githubUrl?: string
        hackatimeProject?: string
        tier?: number
        updateDescription?: string
        aiDescription?: string
    }

    if (!validateImageUrl(data.image)) {
        return { error: 'Image must be from cdn.hackclub.com' }
    }

    const projectName = await prefixHackatimeIds(parseHackatimeProjects(data.hackatimeProject || null), user.email)
    const tier = data.tier !== undefined ? Math.max(1, Math.min(4, data.tier)) : 1

    const newProject = await db
    	.insert(projectsTable)
    	.values({
    		userId: user.id,
    		name: data.name,
    		description: data.description,
    		image: data.image || null,
    		githubUrl: data.githubUrl || null,
    		hackatimeProject: projectName || null,
    		hours: 0,
    		tier,
    		updateDescription: data.updateDescription || null,
    		aiDescription: data.aiDescription || null
    	})
    	.returning()

    // Sync hours from Hackatime if project is linked
    if (projectName) {
    	const syncResult = await syncSingleProject(newProject[0].id)
    	newProject[0].hours = syncResult.hours
    }

    await db.insert(projectActivityTable).values({
        userId: user.id,
        projectId: newProject[0].id,
        action: 'project_created'
    })

    return { ...newProject[0], hackatimeProject: stripHackatimeIds(newProject[0].hackatimeProject) }
})

projects.put('/:id', async ({ params, body, headers }) => {
    const user = await getUserFromSession(headers as Record<string, string>)
    if (!user) return { error: 'Unauthorized' }

    // Check if project exists and is owned by user
    const existing = await db
        .select()
        .from(projectsTable)
        .where(and(eq(projectsTable.id, parseInt(params.id)), eq(projectsTable.userId, user.id)))
        .limit(1)

    if (!existing[0]) return { error: 'Not found' }

    // Reject edits while waiting for review or pending admin approval
    if (existing[0].status === 'waiting_for_review' || existing[0].status === 'pending_admin_approval') {
        return { error: 'Cannot edit project while waiting for review' }
    }

    const data = body as {
        name?: string
        description?: string
        image?: string | null
        githubUrl?: string | null
        playableUrl?: string | null
        hackatimeProject?: string | null
        tier?: number
        updateDescription?: string | null
        aiDescription?: string | null
        reviewerNotes?: string | null
    }

    if (!validateImageUrl(data.image)) {
        return { error: 'Image must be from cdn.hackclub.com' }
    }

    const playableCheck = validatePlayableUrl(data.playableUrl)
    if (!playableCheck.valid) {
        return { error: playableCheck.error }
    }

    const projectName = await prefixHackatimeIds(parseHackatimeProjects(data.hackatimeProject || null), user.email)
    const tier = data.tier !== undefined ? Math.max(1, Math.min(4, data.tier)) : undefined

    const updated = await db
    	.update(projectsTable)
    	.set({
    		name: data.name,
    		description: data.description,
    		image: data.image,
    		githubUrl: data.githubUrl,
    		playableUrl: data.playableUrl,
    		hackatimeProject: projectName,
    		tier,
    		updateDescription: data.updateDescription !== undefined ? (data.updateDescription || null) : undefined,
    		aiDescription: data.aiDescription !== undefined ? (data.aiDescription || null) : undefined,
    		reviewerNotes: data.reviewerNotes !== undefined ? (data.reviewerNotes || null) : undefined,
    		updatedAt: new Date()
    	})
        .where(and(eq(projectsTable.id, parseInt(params.id)), eq(projectsTable.userId, user.id)))
        .returning()

    if (!updated[0]) return { error: 'Not found' }

    // Sync hours from Hackatime if project is linked
    if (projectName) {
    	const syncResult = await syncSingleProject(updated[0].id)
    	updated[0].hours = syncResult.hours
    }

    return { ...updated[0], hackatimeProject: stripHackatimeIds(updated[0].hackatimeProject) }
})

projects.delete("/:id", async ({ params, headers }) => {
    const user = await getUserFromSession(headers as Record<string, string>)
    if (!user) return { error: "Unauthorized" }

    const updated = await db
        .update(projectsTable)
        .set({ deleted: 1, updatedAt: new Date() })
        .where(and(eq(projectsTable.id, parseInt(params.id)), eq(projectsTable.userId, user.id)))
        .returning()

    if (!updated[0]) return { error: "Not found" }

    await db.insert(projectActivityTable).values({
        userId: user.id,
        projectId: updated[0].id,
        action: 'project_deleted'
    })

    return { success: true }
})

// Unsubmit project (withdraw from review queue)
projects.post("/:id/unsubmit", async ({ params, headers }) => {
    const user = await getUserFromSession(headers as Record<string, string>)
    if (!user) return { error: "Unauthorized" }

    const project = await db
        .select()
        .from(projectsTable)
        .where(and(eq(projectsTable.id, parseInt(params.id)), eq(projectsTable.userId, user.id)))
        .limit(1)

    if (!project[0]) return { error: "Not found" }

    if (project[0].status !== 'waiting_for_review' && project[0].status !== 'pending_admin_approval') {
        return { error: "Project can only be unsubmitted while waiting for review" }
    }

    // If project was pending admin approval, clean up the reviewer's approval review
    if (project[0].status === 'pending_admin_approval') {
        await db
            .delete(reviewsTable)
            .where(and(
                eq(reviewsTable.projectId, parseInt(params.id)),
                eq(reviewsTable.action, 'approved')
            ))
    }

    const updated = await db
        .update(projectsTable)
        .set({
            status: 'in_progress',
            updatedAt: new Date()
        })
        .where(eq(projectsTable.id, parseInt(params.id)))
        .returning()

    await db.insert(projectActivityTable).values({
        userId: user.id,
        projectId: updated[0].id,
        action: 'project_unsubmitted'
    })

    return { ...updated[0], hackatimeProject: stripHackatimeIds(updated[0].hackatimeProject) }
})

// Submit project for review
projects.post("/:id/submit", async ({ params, headers, body }) => {
    const user = await getUserFromSession(headers as Record<string, string>)
    if (!user) return { error: "Unauthorized" }

    const data = body as {
        feedbackSource?: string
        feedbackGood?: string
        feedbackImprove?: string
    }

    // Check verification status before allowing submission
    if (user.accessToken) {
        const meResponse = await fetchUserIdentity(user.accessToken)
        if (meResponse) {
            const { identity } = meResponse
            // Update stored verification status
            await db.update(usersTable)
                .set({ verificationStatus: identity.verification_status })
                .where(eq(usersTable.id, user.id))
            
            if (identity.verification_status === 'ineligible') {
                return { error: "ineligible", redirectTo: "/auth/error?reason=not-eligible" }
            }
        }
    }

    const project = await db
        .select()
        .from(projectsTable)
        .where(and(eq(projectsTable.id, parseInt(params.id)), eq(projectsTable.userId, user.id)))
        .limit(1)

    if (!project[0]) return { error: "Not found" }

    if (project[0].status !== 'in_progress' && project[0].status !== 'shipped') {
        return { error: "Project cannot be submitted in current status" }
    }

    // Sync hours from Hackatime before submitting
    if (project[0].hackatimeProject) {
    	await syncSingleProject(parseInt(params.id))
    }

    const updated = await db
        .update(projectsTable)
        .set({ 
            status: 'waiting_for_review', 
            feedbackSource: data.feedbackSource || null,
            feedbackGood: data.feedbackGood || null,
            feedbackImprove: data.feedbackImprove || null,
            updatedAt: new Date() 
        })
        .where(eq(projectsTable.id, parseInt(params.id)))
        .returning()

    await db.insert(projectActivityTable).values({
        userId: user.id,
        projectId: updated[0].id,
        action: 'project_submitted'
    })

    // Submit to YSWS
    submitProjectToYSWS({
        name: updated[0].name,
        githubUrl: updated[0].githubUrl,
        playableUrl: updated[0].playableUrl,
        hackatimeProject: updated[0].hackatimeProject,
        email: user.email
    }).catch(err => console.error('[YSWS] failed:', err))

    // Send Slack DM notification that the project is waiting for review
    if (config.slackBotToken && user.slackId) {
        try {
            await notifyProjectSubmitted({
                userSlackId: user.slackId,
                projectName: updated[0].name,
                projectId: updated[0].id,
                frontendUrl: config.frontendUrl,
                token: config.slackBotToken
            })
        } catch (slackErr) {
            console.error('Failed to send Slack submission notification:', slackErr)
        }
    }

    return { ...updated[0], hackatimeProject: stripHackatimeIds(updated[0].hackatimeProject) }
})

// Get project reviews (public feedback)
projects.get("/:id/reviews", async ({ params, headers }) => {
    const user = await getUserFromSession(headers as Record<string, string>)
    if (!user) return { error: "Unauthorized" }

    const project = await db
        .select()
        .from(projectsTable)
        .where(and(eq(projectsTable.id, parseInt(params.id)), eq(projectsTable.userId, user.id)))
        .limit(1)

    if (!project[0]) return { error: "Not found" }

    const reviews = await db
        .select({
            id: reviewsTable.id,
            reviewerId: reviewsTable.reviewerId,
            action: reviewsTable.action,
            feedbackForAuthor: reviewsTable.feedbackForAuthor,
            createdAt: reviewsTable.createdAt
        })
        .from(reviewsTable)
        .where(eq(reviewsTable.projectId, parseInt(params.id)))

    const reviewerIds = reviews.map(r => r.reviewerId)
    let reviewers: { id: number; username: string | null; avatar: string | null }[] = []
    if (reviewerIds.length > 0) {
        reviewers = await db
            .select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar })
            .from(usersTable)
            .where(inArray(usersTable.id, reviewerIds))
    }

    // Hide approval reviews when project is pending admin approval (internal status)
    const filteredReviews = project[0].status === 'pending_admin_approval'
        ? reviews.filter(r => r.action !== 'approved')
        : reviews

    return filteredReviews.map(r => ({
        id: r.id,
        action: r.action,
        feedbackForAuthor: r.feedbackForAuthor,
        createdAt: r.createdAt,
        reviewer: reviewers.find(rv => rv.id === r.reviewerId) || null
    }))
})

export default projects
