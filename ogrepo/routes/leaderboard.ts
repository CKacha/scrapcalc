import { Elysia, t } from 'elysia'
import { db } from '../db'
import { usersTable } from '../schemas/users'
import { projectsTable } from '../schemas/projects'
import { shopItemsTable, refineryOrdersTable, shopPenaltiesTable } from '../schemas/shop'
import { sql, desc, eq, and, or, isNull, ne } from 'drizzle-orm'
import { getHackatimeUser } from '../lib/hackatime-sync'

const leaderboard = new Elysia({ prefix: '/leaderboard' })

async function filterHackatimeBanned<T extends { email: string }>(users: T[]): Promise<T[]> {
	const filtered: T[] = []
	for (const user of users) {
		try {
			const htUser = await getHackatimeUser(user.email)
			if (htUser?.banned) continue
		} catch {
			// If lookup fails, don't exclude the user
		}
		filtered.push(user)
	}
	return filtered
}

leaderboard.get('/', async ({ query }) => {
	const sortBy = query.sortBy || 'scraps'

	if (sortBy === 'hours') {
		const results = await db
			.select({
				id: usersTable.id,
				username: usersTable.username,
				avatar: usersTable.avatar,
				email: usersTable.email,
				scrapsEarned: sql<number>`COALESCE((SELECT SUM(scraps_awarded) FROM projects WHERE user_id = ${usersTable.id} AND scraps_paid_at IS NOT NULL AND status != 'permanently_rejected'), 0)`.as('scraps_earned'),
				scrapsBonus: sql<number>`COALESCE((SELECT SUM(amount) FROM user_bonuses WHERE user_id = ${usersTable.id}), 0)`.as('scraps_bonus'),
				scrapsShopSpent: sql<number>`COALESCE((SELECT SUM(total_price) FROM shop_orders WHERE user_id = ${usersTable.id}), 0)`.as('scraps_shop_spent'),
				scrapsRefinerySpent: sql<number>`COALESCE((SELECT SUM(cost) FROM refinery_spending_history WHERE user_id = ${usersTable.id}), 0)`.as('scraps_refinery_spent'),
				hours: sql<number>`COALESCE(SUM(${projectsTable.hours}), 0)`.as('total_hours'),
				projectCount: sql<number>`COUNT(${projectsTable.id})`.as('project_count')
			})
			.from(usersTable)
			.leftJoin(projectsTable, and(
				eq(projectsTable.userId, usersTable.id),
				or(eq(projectsTable.deleted, 0), isNull(projectsTable.deleted)),
				sql`${projectsTable.status} != 'permanently_rejected'`
			))
			.where(ne(usersTable.role, 'banned'))
			.groupBy(usersTable.id)
			.orderBy(desc(sql`total_hours`))
			.limit(20)

		const filtered = await filterHackatimeBanned(results)

		return filtered.slice(0, 10).map((user, index) => ({
			rank: index + 1,
			id: user.id,
			username: user.username,
			avatar: user.avatar,
			hours: Number(user.hours),
			scraps: Number(user.scrapsEarned) + Number(user.scrapsBonus) - Number(user.scrapsShopSpent) - Number(user.scrapsRefinerySpent),
			scrapsEarned: Number(user.scrapsEarned),
			projectCount: Number(user.projectCount)
		}))
	}

	const results = await db
		.select({
			id: usersTable.id,
			username: usersTable.username,
			avatar: usersTable.avatar,
			email: usersTable.email,
			scrapsEarned: sql<number>`COALESCE((SELECT SUM(scraps_awarded) FROM projects WHERE user_id = ${usersTable.id} AND scraps_paid_at IS NOT NULL AND status != 'permanently_rejected'), 0)`.as('scraps_earned'),
			scrapsBonus: sql<number>`COALESCE((SELECT SUM(amount) FROM user_bonuses WHERE user_id = ${usersTable.id}), 0)`.as('scraps_bonus'),
			scrapsShopSpent: sql<number>`COALESCE((SELECT SUM(total_price) FROM shop_orders WHERE user_id = ${usersTable.id}), 0)`.as('scraps_shop_spent'),
			scrapsRefinerySpent: sql<number>`COALESCE((SELECT SUM(cost) FROM refinery_spending_history WHERE user_id = ${usersTable.id}), 0)`.as('scraps_refinery_spent'),
			hours: sql<number>`COALESCE(SUM(${projectsTable.hours}), 0)`.as('total_hours'),
			projectCount: sql<number>`COUNT(${projectsTable.id})`.as('project_count')
		})
		.from(usersTable)
		.leftJoin(projectsTable, and(
			eq(projectsTable.userId, usersTable.id),
			or(eq(projectsTable.deleted, 0), isNull(projectsTable.deleted)),
			sql`${projectsTable.status} != 'permanently_rejected'`
		))
		.where(ne(usersTable.role, 'banned'))
		.groupBy(usersTable.id)
		.orderBy(desc(sql`COALESCE((SELECT SUM(scraps_awarded) FROM projects WHERE user_id = ${usersTable.id} AND scraps_paid_at IS NOT NULL AND status != 'permanently_rejected'), 0) + COALESCE((SELECT SUM(amount) FROM user_bonuses WHERE user_id = ${usersTable.id}), 0) - COALESCE((SELECT SUM(total_price) FROM shop_orders WHERE user_id = ${usersTable.id}), 0) - COALESCE((SELECT SUM(cost) FROM refinery_spending_history WHERE user_id = ${usersTable.id}), 0)`))
		.limit(20)

	const filtered = await filterHackatimeBanned(results)

	return filtered.slice(0, 10).map((user, index) => ({
		rank: index + 1,
		id: user.id,
		username: user.username,
		avatar: user.avatar,
		hours: Number(user.hours),
		scraps: Number(user.scrapsEarned) + Number(user.scrapsBonus) - Number(user.scrapsShopSpent) - Number(user.scrapsRefinerySpent),
		scrapsEarned: Number(user.scrapsEarned),
		projectCount: Number(user.projectCount)
	}))
}, {
	query: t.Object({
		sortBy: t.Optional(t.Union([t.Literal('hours'), t.Literal('scraps')]))
	})
})

leaderboard.get('/views', async () => {
	const results = await db
		.select({
			id: projectsTable.id,
			name: projectsTable.name,
			image: projectsTable.image,
			views: projectsTable.views,
			userId: projectsTable.userId,
			userEmail: usersTable.email,
			userRole: usersTable.role
		})
		.from(projectsTable)
		.innerJoin(usersTable, eq(projectsTable.userId, usersTable.id))
		.where(and(
			eq(projectsTable.status, 'shipped'),
			or(eq(projectsTable.deleted, 0), isNull(projectsTable.deleted)),
			ne(usersTable.role, 'banned')
		))
		.orderBy(desc(projectsTable.views))
		.limit(20)

	// Filter out Hackatime-banned users
	const filtered: typeof results = []
	for (const project of results) {
		try {
			const htUser = await getHackatimeUser(project.userEmail)
			if (htUser?.banned) continue
		} catch {
			// If lookup fails, don't exclude
		}
		filtered.push(project)
	}

	const userIds = [...new Set(filtered.slice(0, 10).map(p => p.userId))]
	let users: { id: number; username: string | null; avatar: string | null }[] = []
	if (userIds.length > 0) {
		users = await db
			.select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar })
			.from(usersTable)
			.where(sql`${usersTable.id} IN ${userIds}`)
	}

	const userMap = new Map(users.map(u => [u.id, u]))

	return filtered.slice(0, 10).map((project, index) => ({
		rank: index + 1,
		id: project.id,
		name: project.name,
		image: project.image,
		views: project.views,
		owner: userMap.get(project.userId) ?? null
	}))
})

leaderboard.get('/probability-leaders', async () => {
	const items = await db
		.select({
			id: shopItemsTable.id,
			name: shopItemsTable.name,
			image: shopItemsTable.image,
			baseProbability: shopItemsTable.baseProbability
		})
		.from(shopItemsTable)

	const allBoosts = await db
		.select({
			userId: refineryOrdersTable.userId,
			shopItemId: refineryOrdersTable.shopItemId,
			boostPercent: sql<number>`COALESCE(SUM(${refineryOrdersTable.boostAmount}), 0)`
		})
		.from(refineryOrdersTable)
		.groupBy(refineryOrdersTable.userId, refineryOrdersTable.shopItemId)

	const allPenalties = await db
		.select({
			userId: shopPenaltiesTable.userId,
			shopItemId: shopPenaltiesTable.shopItemId,
			probabilityMultiplier: shopPenaltiesTable.probabilityMultiplier
		})
		.from(shopPenaltiesTable)

	const boostMap = new Map<string, number>()
	for (const b of allBoosts) {
		boostMap.set(`${b.userId}-${b.shopItemId}`, Number(b.boostPercent))
	}

	const penaltyMap = new Map<string, number>()
	for (const p of allPenalties) {
		penaltyMap.set(`${p.userId}-${p.shopItemId}`, p.probabilityMultiplier)
	}

	const userIds = new Set<number>()
	for (const b of allBoosts) userIds.add(b.userId)
	for (const p of allPenalties) userIds.add(p.userId)

	const users = userIds.size > 0
		? await db
			.select({
				id: usersTable.id,
				username: usersTable.username,
				avatar: usersTable.avatar
			})
			.from(usersTable)
		: []

	const userMap = new Map(users.map(u => [u.id, u]))

	const result = items.map(item => {
		let topUser: { id: number; username: string | null; avatar: string | null } | null = null
		let topProbability = item.baseProbability

		for (const userId of userIds) {
			const boost = boostMap.get(`${userId}-${item.id}`) ?? 0
			const penaltyMultiplier = penaltyMap.get(`${userId}-${item.id}`) ?? 100
			const adjustedBase = Math.floor(item.baseProbability * penaltyMultiplier / 100)
			const effectiveProbability = Math.min(adjustedBase + boost, 100)

			if (effectiveProbability > topProbability) {
				topProbability = effectiveProbability
				topUser = userMap.get(userId) ?? null
			}
		}

		return {
			itemId: item.id,
			itemName: item.name,
			itemImage: item.image,
			baseProbability: item.baseProbability,
			topUser: topUser ? {
				id: topUser.id,
				username: topUser.username,
				avatar: topUser.avatar
			} : null,
			effectiveProbability: topProbability
		}
	})

	return result
})

export default leaderboard
