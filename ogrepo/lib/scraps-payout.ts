import { db } from '../db'
import { projectsTable } from '../schemas/projects'
import { usersTable } from '../schemas/users'
import { sql, and, isNull, eq, or, inArray } from 'drizzle-orm'
import { config } from '../config'

const PAYOUT_CHECK_INTERVAL_MS = 60 * 60 * 1000 // Check every hour
const PAYOUT_INTERVAL_DAYS = 2

// Slack channel for scraps announcements
const SCRAPS_CHANNEL_ID = 'C0AE5RQV26S'

let payoutInterval: ReturnType<typeof setInterval> | null = null

/**
 * Compute the next payout date: every 2 days at midnight UTC,
 * anchored from the scraps start date (Feb 3 2026 00:00 UTC).
 */
export function getNextPayoutDate(): Date {
	const epoch = new Date('2026-02-03T00:00:00Z')
	const now = new Date()
	const msSinceEpoch = now.getTime() - epoch.getTime()
	const daysSinceEpoch = msSinceEpoch / (24 * 60 * 60 * 1000)
	const cyclesPassed = Math.floor(daysSinceEpoch / PAYOUT_INTERVAL_DAYS)
	const nextCycle = cyclesPassed + 1
	return new Date(epoch.getTime() + nextCycle * PAYOUT_INTERVAL_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * Check if we are currently within a payout window (first hour of a payout day at midnight UTC).
 */
function isPayoutTime(): boolean {
	const epoch = new Date('2026-02-03T00:00:00Z')
	const now = new Date()
	const msSinceEpoch = now.getTime() - epoch.getTime()
	const daysSinceEpoch = msSinceEpoch / (24 * 60 * 60 * 1000)
	const remainder = daysSinceEpoch % PAYOUT_INTERVAL_DAYS
	// Within the first hour of a payout boundary (remainder close to 0)
	return remainder < (1 / 24) || remainder > (PAYOUT_INTERVAL_DAYS - 1 / 24)
}

/**
 * Send a message to the scraps Slack channel.
 */
async function sendChannelMessage(text: string, blocks?: unknown[]): Promise<boolean> {
	const token = config.slackBotToken
	if (!token) {
		console.error('[SCRAPS-PAYOUT] No Slack bot token configured')
		return false
	}

	try {
		const payload: Record<string, unknown> = {
			channel: SCRAPS_CHANNEL_ID,
			text,
			unfurl_links: false,
			unfurl_media: false
		}
		if (blocks) {
			payload.blocks = blocks
		}

		const res = await fetch('https://slack.com/api/chat.postMessage', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		})

		const data = await res.json() as { ok: boolean; error?: string }
		if (!data.ok) {
			console.error('[SCRAPS-PAYOUT] Failed to send channel message:', data.error)
			return false
		}
		return true
	} catch (err) {
		console.error('[SCRAPS-PAYOUT] Error sending channel message:', err)
		return false
	}
}

/**
 * Pay out all pending scraps for shipped projects where scrapsPaidAt is not set.
 */
export async function payoutPendingScraps(): Promise<{ paidCount: number; totalScraps: number }> {
	const now = new Date()

	// Get shipped projects that haven't been paid yet
	const pendingProjects = await db
		.select({
			id: projectsTable.id,
			scrapsAwarded: projectsTable.scrapsAwarded,
			userId: projectsTable.userId
		})
		.from(projectsTable)
		.where(and(
			eq(projectsTable.status, 'shipped'),
			isNull(projectsTable.scrapsPaidAt),
			sql`${projectsTable.scrapsAwarded} > 0`,
			or(eq(projectsTable.deleted, 0), isNull(projectsTable.deleted))
		))

	if (pendingProjects.length === 0) {
		return { paidCount: 0, totalScraps: 0 }
	}

	const projectIds = pendingProjects.map(p => p.id)
	const totalScraps = pendingProjects.reduce((sum, p) => sum + p.scrapsAwarded, 0)
	const uniqueUserIds = [...new Set(pendingProjects.map(p => p.userId))]

	// Mark all pending projects as paid
	await db
		.update(projectsTable)
		.set({
			scrapsPaidAt: now
		})
		.where(inArray(projectsTable.id, projectIds))

	const paidCount = pendingProjects.length
	console.log(`[SCRAPS-PAYOUT] Paid out ${totalScraps} scraps across ${paidCount} projects for ${uniqueUserIds.length} users`)

	// Look up Slack IDs for users who received payouts
	const payoutUsers = await db
		.select({ id: usersTable.id, slackId: usersTable.slackId, username: usersTable.username })
		.from(usersTable)
		.where(inArray(usersTable.id, uniqueUserIds))

	const userMentions = payoutUsers
		.map(u => u.slackId ? `<@${u.slackId}>` : u.username)
		.filter(Boolean)
		.join(', ')

	const nextPayout = getNextPayoutDate()
	const nextPayoutStr = nextPayout.toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		timeZone: 'UTC'
	}) + ' UTC'

	// Send channel announcement
	const blocks = [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `:scraps: *scraps payout complete!* :scraps:\n\n${userMentions} — *${totalScraps.toLocaleString()} scraps* have been paid out across *${paidCount}* project${paidCount !== 1 ? 's' : ''} for *${uniqueUserIds.length}* user${uniqueUserIds.length !== 1 ? 's' : ''}!\n\nnext payout: ${nextPayoutStr}`
			}
		}
	]

	await sendChannelMessage(
		`scraps payout complete! ${totalScraps} scraps paid out across ${paidCount} projects for ${uniqueUserIds.length} users. next payout: ${nextPayoutStr}`,
		blocks
	)

	return { paidCount, totalScraps }
}

/**
 * Notify the scraps channel when a user wins a shop item (not consolation).
 */
export async function notifyShopWin(userId: number, itemName: string, itemImage: string): Promise<void> {
	// Look up user slack ID
	const users = await db
		.select({ slackId: usersTable.slackId, username: usersTable.username })
		.from(usersTable)
		.where(eq(usersTable.id, userId))
		.limit(1)

	const user = users[0]
	if (!user) return

	const userMention = user.slackId ? `<@${user.slackId}>` : (user.username ?? `User #${userId}`)

	const blocks: unknown[] = []

	if (itemImage) {
		blocks.push({
			type: 'image',
			image_url: itemImage,
			alt_text: itemName,
			title: {
				type: 'plain_text',
				text: itemName
			}
		})
	}

	blocks.push({
		type: 'section',
		text: {
			type: 'mrkdwn',
			text: `:blobhaj_party: *${userMention}* just won *${itemName}* from the scraps shop! :scraps:`
		}
	})

	await sendChannelMessage(
		`${user.username ?? `User #${userId}`} just won ${itemName} from the scraps shop!`,
		blocks
	)
}

// Track whether we already ran payout in the current cycle to avoid duplicates
let lastPayoutCycle: number | null = null

function getCurrentCycle(): number {
	const epoch = new Date('2026-02-03T00:00:00Z')
	const now = new Date()
	const msSinceEpoch = now.getTime() - epoch.getTime()
	const daysSinceEpoch = msSinceEpoch / (24 * 60 * 60 * 1000)
	return Math.floor(daysSinceEpoch / PAYOUT_INTERVAL_DAYS)
}

async function checkAndPayout(): Promise<void> {
	if (!isPayoutTime()) return

	const currentCycle = getCurrentCycle()
	if (lastPayoutCycle === currentCycle) return // Already ran this cycle

	console.log('[SCRAPS-PAYOUT] Payout time detected, running payout...')
	const { paidCount, totalScraps } = await payoutPendingScraps()
	lastPayoutCycle = currentCycle
	console.log(`[SCRAPS-PAYOUT] Payout complete: ${paidCount} projects, ${totalScraps} scraps paid out`)
}

export function startScrapsPayout(): void {
	if (payoutInterval) return

	console.log('[SCRAPS-PAYOUT] Starting payout scheduler (every 2 days at midnight UTC, checks hourly)')
	console.log(`[SCRAPS-PAYOUT] Next payout: ${getNextPayoutDate().toISOString()}`)

	// Check immediately on start
	checkAndPayout().catch(err => console.error('[SCRAPS-PAYOUT] Error:', err))

	// Then check every hour
	payoutInterval = setInterval(() => {
		checkAndPayout().catch(err => console.error('[SCRAPS-PAYOUT] Error:', err))
	}, PAYOUT_CHECK_INTERVAL_MS)
}

export function stopScrapsPayout(): void {
	if (payoutInterval) {
		clearInterval(payoutInterval)
		payoutInterval = null
		console.log('[SCRAPS-PAYOUT] Stopped payout scheduler')
	}
}
