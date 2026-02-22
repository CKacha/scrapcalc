import { Elysia } from "elysia";
import { randomInt } from "crypto";
import { eq, sql, and, desc, isNull, ne, or, gt } from "drizzle-orm";
import { db } from "../db";
import {
  shopItemsTable, 
  shopHeartsTable,
  shopOrdersTable,
  shopRollsTable,
  refineryOrdersTable,
  shopPenaltiesTable,
  refinerySpendingHistoryTable,
} from "../schemas/shop";
import { usersTable } from "../schemas/users";
import { getUserFromSession } from "../lib/auth";
import {
  getUserScrapsBalance,
  canAfford,
  calculateRollCost,
  computeRollThreshold,
  getUpgradeCost,
} from "../lib/scraps";
import { notifyShopWin } from "../lib/scraps-payout";

const shop = new Elysia({ prefix: "/shop" });

shop.get("/items", async ({ headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);

  const items = await db
    .select({
      id: shopItemsTable.id,
      name: shopItemsTable.name,
      image: shopItemsTable.image,
      description: shopItemsTable.description,
      price: shopItemsTable.price,
      category: shopItemsTable.category,
      count: shopItemsTable.count,
      baseProbability: shopItemsTable.baseProbability,
      baseUpgradeCost: shopItemsTable.baseUpgradeCost,
      costMultiplier: shopItemsTable.costMultiplier,
      boostAmount: shopItemsTable.boostAmount,
      rollCostOverride: shopItemsTable.rollCostOverride,
      createdAt: shopItemsTable.createdAt,
      updatedAt: shopItemsTable.updatedAt,
      heartCount:
        sql<number>`(SELECT COUNT(*) FROM shop_hearts WHERE shop_item_id = shop_items.id)`.as(
          "heart_count",
        ),
    })
    .from(shopItemsTable);

  if (user) {
    const userHearts = await db
      .select({ shopItemId: shopHeartsTable.shopItemId })
      .from(shopHeartsTable)
      .where(eq(shopHeartsTable.userId, user.id));

    const userBoosts = await db
      .select({
        shopItemId: refineryOrdersTable.shopItemId,
        boostPercent: sql<number>`COALESCE(SUM(${refineryOrdersTable.boostAmount}), 0)`,
        upgradeCount: sql<number>`COUNT(*)`,
      })
      .from(refineryOrdersTable)
      .where(eq(refineryOrdersTable.userId, user.id))
      .groupBy(refineryOrdersTable.shopItemId);

    const userPenalties = await db
      .select({
        shopItemId: shopPenaltiesTable.shopItemId,
        probabilityMultiplier: shopPenaltiesTable.probabilityMultiplier,
      })
      .from(shopPenaltiesTable)
      .where(eq(shopPenaltiesTable.userId, user.id));

    const userRollCounts = await db
      .select({
        shopItemId: shopRollsTable.shopItemId,
        rollCount: sql<number>`COUNT(*)`,
      })
      .from(shopRollsTable)
      .where(eq(shopRollsTable.userId, user.id))
      .groupBy(shopRollsTable.shopItemId);

    const userRefinerySpending = await db
      .select({
        shopItemId: refinerySpendingHistoryTable.shopItemId,
        totalSpent: sql<number>`COALESCE(SUM(${refinerySpendingHistoryTable.cost}), 0)`,
      })
      .from(refinerySpendingHistoryTable)
      .where(eq(refinerySpendingHistoryTable.userId, user.id))
      .groupBy(refinerySpendingHistoryTable.shopItemId);

    const heartedIds = new Set(userHearts.map((h) => h.shopItemId));
    const boostMap = new Map(
      userBoosts.map((b) => [
        b.shopItemId,
        {
          boostPercent: Number(b.boostPercent),
          upgradeCount: Number(b.upgradeCount),
        },
      ]),
    );
    const penaltyMap = new Map(
      userPenalties.map((p) => [p.shopItemId, p.probabilityMultiplier]),
    );
    const rollCountMap = new Map(
      userRollCounts.map((r) => [r.shopItemId, Number(r.rollCount)]),
    );
    const refinerySpentMap = new Map(
      userRefinerySpending.map((s) => [s.shopItemId, Number(s.totalSpent)]),
    );

    return items.map((item) => {
      const boostData = boostMap.get(item.id) ?? {
        boostPercent: 0,
        upgradeCount: 0,
      };
      const penaltyMultiplier = penaltyMap.get(item.id) ?? 100;
      const adjustedBaseProbability = Math.floor(
        (item.baseProbability * penaltyMultiplier) / 100,
      );
      const maxBoost = 100 - adjustedBaseProbability;
      const actualSpent = refinerySpentMap.get(item.id) ?? 0;
      const nextUpgradeCost =
        boostData.boostPercent >= maxBoost
          ? null
          : getUpgradeCost(item.price, boostData.upgradeCount, actualSpent);
      return {
        ...item,
        heartCount: Number(item.heartCount) || 0,
        userBoostPercent: boostData.boostPercent,
        upgradeCount: boostData.upgradeCount,
        adjustedBaseProbability,
        effectiveProbability: Math.min(
          adjustedBaseProbability + boostData.boostPercent,
          100,
        ),
        rollCostOverride: item.rollCostOverride,
        userHearted: heartedIds.has(item.id),
        nextUpgradeCost,
        rollCount: rollCountMap.get(item.id) ?? 0,
      };
    });
  }

  return items.map((item) => ({
    ...item,
    heartCount: Number(item.heartCount) || 0,
    userBoostPercent: 0,
    upgradeCount: 0,
    adjustedBaseProbability: item.baseProbability,
    effectiveProbability: Math.min(item.baseProbability, 100),
    rollCostOverride: item.rollCostOverride,
    userHearted: false,
    nextUpgradeCost: getUpgradeCost(item.price, 0),
    rollCount: 0,
  }));
});

shop.get("/items/:id", async ({ params, headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  const itemId = parseInt(params.id);

  const items = await db
    .select({
      id: shopItemsTable.id,
      name: shopItemsTable.name,
      image: shopItemsTable.image,
      description: shopItemsTable.description,
      price: shopItemsTable.price,
      category: shopItemsTable.category,
      count: shopItemsTable.count,
      baseProbability: shopItemsTable.baseProbability,
      baseUpgradeCost: shopItemsTable.baseUpgradeCost,
      costMultiplier: shopItemsTable.costMultiplier,
      boostAmount: shopItemsTable.boostAmount,
      rollCostOverride: shopItemsTable.rollCostOverride,
      createdAt: shopItemsTable.createdAt,
      updatedAt: shopItemsTable.updatedAt,
      heartCount:
        sql<number>`(SELECT COUNT(*) FROM shop_hearts WHERE shop_item_id = shop_items.id)`.as(
          "heart_count",
        ),
    })
    .from(shopItemsTable)
    .where(eq(shopItemsTable.id, itemId))
    .limit(1);

  if (items.length === 0) {
    return { error: "Item not found" };
  }

  const item = items[0];
  let hearted = false;
  let userBoostPercent = 0;
  let penaltyMultiplier = 100;

  if (user) {
    const heart = await db
      .select()
      .from(shopHeartsTable)
      .where(
        and(
          eq(shopHeartsTable.userId, user.id),
          eq(shopHeartsTable.shopItemId, itemId),
        ),
      )
      .limit(1);

    hearted = heart.length > 0;

    const boost = await db
      .select({
        boostPercent: sql<number>`COALESCE(SUM(${refineryOrdersTable.boostAmount}), 0)`,
      })
      .from(refineryOrdersTable)
      .where(
        and(
          eq(refineryOrdersTable.userId, user.id),
          eq(refineryOrdersTable.shopItemId, itemId),
        ),
      );

    userBoostPercent = boost.length > 0 ? Number(boost[0].boostPercent) : 0;

    const penalty = await db
      .select({
        probabilityMultiplier: shopPenaltiesTable.probabilityMultiplier,
      })
      .from(shopPenaltiesTable)
      .where(
        and(
          eq(shopPenaltiesTable.userId, user.id),
          eq(shopPenaltiesTable.shopItemId, itemId),
        ),
      )
      .limit(1);

    penaltyMultiplier =
      penalty.length > 0 ? penalty[0].probabilityMultiplier : 100;
  }

  const adjustedBaseProbability = Math.floor(
    (item.baseProbability * penaltyMultiplier) / 100,
  );

  return {
    ...item,
    heartCount: Number(item.heartCount) || 0,
    userBoostPercent,
    adjustedBaseProbability,
    effectiveProbability: Math.min(
      adjustedBaseProbability + userBoostPercent,
      100,
    ),
    userHearted: hearted,
  };
});

shop.post("/items/:id/heart", async ({ params, headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  const itemId = parseInt(params.id);
  if (!Number.isInteger(itemId)) {
    return { error: "Invalid item id" };
  }

  const item = await db
    .select()
    .from(shopItemsTable)
    .where(eq(shopItemsTable.id, itemId))
    .limit(1);

  if (item.length === 0) {
    return { error: "Item not found" };
  }

  // Atomic toggle using CTE to avoid race conditions
  const result = await db.execute(sql`
		WITH del AS (
			DELETE FROM shop_hearts
			WHERE user_id = ${user.id} AND shop_item_id = ${itemId}
			RETURNING 1
		),
		ins AS (
			INSERT INTO shop_hearts (user_id, shop_item_id)
			SELECT ${user.id}, ${itemId}
			WHERE NOT EXISTS (SELECT 1 FROM del)
			ON CONFLICT DO NOTHING
			RETURNING 1
		)
		SELECT EXISTS(SELECT 1 FROM ins) AS hearted
	`);

  const hearted = (result.rows[0] as { hearted: boolean })?.hearted ?? false;

  // Get the updated heart count
  const countResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(shopHeartsTable)
    .where(eq(shopHeartsTable.shopItemId, itemId));

  const heartCount = Number(countResult[0]?.count) || 0;

  return { hearted, heartCount };
});

shop.get("/categories", async () => {
  const result = await db
    .selectDistinct({ category: shopItemsTable.category })
    .from(shopItemsTable);

  return result.map((r) => r.category);
});

shop.get("/balance", async ({ headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  return await getUserScrapsBalance(user.id);
});

shop.post("/items/:id/purchase", async ({ params, body, headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  const itemId = parseInt(params.id);
  if (!Number.isInteger(itemId)) {
    return { error: "Invalid item id" };
  }

  const { quantity = 1, shippingAddress } = body as {
    quantity?: number;
    shippingAddress?: string;
  };

  if (quantity < 1 || !Number.isInteger(quantity)) {
    return { error: "Invalid quantity" };
  }

  const items = await db
    .select()
    .from(shopItemsTable)
    .where(eq(shopItemsTable.id, itemId))
    .limit(1);

  if (items.length === 0) {
    return { error: "Item not found" };
  }

  const item = items[0];

  if (item.count < quantity) {
    return { error: "Not enough stock available" };
  }

  const totalPrice = item.price * quantity;

  // Get user's phone number for the order
  const userPhone = await db
    .select({ phone: usersTable.phone })
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);

  const phone = userPhone[0]?.phone || null;

  try {
    const order = await db.transaction(async (tx) => {
      // Lock the user row to serialize spend operations and prevent race conditions
      await tx.execute(
        sql`SELECT 1 FROM users WHERE id = ${user.id} FOR UPDATE`,
      );

      // Re-check affordability inside the transaction
      const affordable = await canAfford(user.id, totalPrice, tx);
      if (!affordable) {
        const { balance } = await getUserScrapsBalance(user.id, tx);
        throw { type: "insufficient_funds", balance };
      }

      // Lock the item row to prevent overselling from concurrent purchases
      const lockedItem = await tx.execute(
        sql`SELECT * FROM shop_items WHERE id = ${itemId} FOR UPDATE`,
      );
      const rawRow = lockedItem.rows[0] as Record<string, unknown> | undefined;

      if (!rawRow || (rawRow.count as number) < quantity) {
        throw { type: "out_of_stock" };
      }

      const currentItem = {
        id: rawRow.id as number,
        name: rawRow.name as string,
        price: rawRow.price as number,
        count: rawRow.count as number,
        baseProbability: rawRow.base_probability as number,
        baseUpgradeCost: rawRow.base_upgrade_cost as number,
        costMultiplier: rawRow.cost_multiplier as number,
        boostAmount: rawRow.boost_amount as number,
        rollCostOverride: (rawRow.roll_cost_override as number | null) ?? null,
      };

      // Atomic SQL decrement — always uses the live DB value
      await tx
        .update(shopItemsTable)
        .set({
          count: sql`${shopItemsTable.count} - ${quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(shopItemsTable.id, itemId));

      const newOrder = await tx
        .insert(shopOrdersTable)
        .values({
          userId: user.id,
          shopItemId: itemId,
          quantity,
          pricePerItem: item.price,
          totalPrice,
          shippingAddress: shippingAddress || null,
          phone,
          status: "pending",
        })
        .returning();

      return newOrder[0];
    });

    return {
      success: true,
      order: {
        id: order.id,
        itemName: item.name,
        quantity: order.quantity,
        totalPrice: order.totalPrice,
        status: order.status,
      },
    };
  } catch (e) {
    const err = e as { type?: string; balance?: number };
    if (err.type === "insufficient_funds") {
      return {
        error: "Insufficient scraps",
        required: totalPrice,
        available: err.balance,
      };
    }
    if (err.type === "out_of_stock") {
      return { error: "Not enough stock" };
    }
    throw e;
  }
});

shop.get("/orders", async ({ headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  const orders = await db
    .select({
      id: shopOrdersTable.id,
      quantity: shopOrdersTable.quantity,
      pricePerItem: shopOrdersTable.pricePerItem,
      totalPrice: shopOrdersTable.totalPrice,
      status: shopOrdersTable.status,
      orderType: shopOrdersTable.orderType,
      shippingAddress: shopOrdersTable.shippingAddress,
      isFulfilled: shopOrdersTable.isFulfilled,
      createdAt: shopOrdersTable.createdAt,
      itemId: shopItemsTable.id,
      itemName: shopItemsTable.name,
      itemImage: shopItemsTable.image,
    })
    .from(shopOrdersTable)
    .innerJoin(
      shopItemsTable,
      eq(shopOrdersTable.shopItemId, shopItemsTable.id),
    )
    .where(eq(shopOrdersTable.userId, user.id))
    .orderBy(desc(shopOrdersTable.createdAt));

  return orders;
});

shop.post("/items/:id/try-luck", async ({ params, headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  const itemId = parseInt(params.id);
  if (!Number.isInteger(itemId)) {
    return { error: "Invalid item id" };
  }

  const items = await db
    .select()
    .from(shopItemsTable)
    .where(eq(shopItemsTable.id, itemId))
    .limit(1);

  if (items.length === 0) {
    return { error: "Item not found" };
  }

  const item = items[0];
  const itemRollCostOverride = item.rollCostOverride;

  if (item.count < 1) {
    return { error: "Out of stock" };
  }

  // Get user's phone number for orders
  const userPhoneResult = await db
    .select({ phone: usersTable.phone })
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);

  const userPhone = userPhoneResult[0]?.phone || null;

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the user row to serialize spend operations and prevent race conditions
      await tx.execute(
        sql`SELECT 1 FROM users WHERE id = ${user.id} FOR UPDATE`,
      );

      // Lock the item row to prevent overselling from concurrent rolls
      const lockedItem = await tx.execute(
        sql`SELECT * FROM shop_items WHERE id = ${itemId} FOR UPDATE`,
      );
      const rawRow = lockedItem.rows[0] as Record<string, unknown> | undefined;

      if (!rawRow || (rawRow.count as number) < 1) {
        throw { type: "out_of_stock" };
      }

      // Raw SQL returns snake_case columns — map to camelCase
      const currentItem = {
        id: rawRow.id as number,
        name: rawRow.name as string,
        price: rawRow.price as number,
        count: rawRow.count as number,
        baseProbability: rawRow.base_probability as number,
        baseUpgradeCost: rawRow.base_upgrade_cost as number,
        costMultiplier: rawRow.cost_multiplier as number,
        boostAmount: rawRow.boost_amount as number,
        rollCostOverride: (rawRow.roll_cost_override as number | null) ?? null,
      };

      // Compute boost and penalty inside transaction
      const boostResult = await tx
        .select({
          boostPercent: sql<number>`COALESCE(SUM(${refineryOrdersTable.boostAmount}), 0)`,
        })
        .from(refineryOrdersTable)
        .where(
          and(
            eq(refineryOrdersTable.userId, user.id),
            eq(refineryOrdersTable.shopItemId, itemId),
          ),
        );

      const penaltyResult = await tx
        .select({
          probabilityMultiplier: shopPenaltiesTable.probabilityMultiplier,
        })
        .from(shopPenaltiesTable)
        .where(
          and(
            eq(shopPenaltiesTable.userId, user.id),
            eq(shopPenaltiesTable.shopItemId, itemId),
          ),
        )
        .limit(1);

      const boostPercent =
        boostResult.length > 0 ? Number(boostResult[0].boostPercent) : 0;
      const penaltyMultiplier =
        penaltyResult.length > 0 ? penaltyResult[0].probabilityMultiplier : 100;
      const adjustedBaseProbability = Math.floor(
        (currentItem.baseProbability * penaltyMultiplier) / 100,
      );
      const effectiveProbability = Math.min(
        adjustedBaseProbability + boostPercent,
        100,
      );

      const baseRollCost = calculateRollCost(
        currentItem.price,
        effectiveProbability,
        currentItem.rollCostOverride,
        currentItem.baseProbability,
      );

      // Roll cost escalates by 5% per previous roll on this item
      const rollCountResult = await tx
        .select({ count: sql<number>`count(*)` })
        .from(shopRollsTable)
        .where(
          and(
            eq(shopRollsTable.userId, user.id),
            eq(shopRollsTable.shopItemId, itemId),
          ),
        );
      const previousRolls = Number(rollCountResult[0]?.count ?? 0);
      const rollCost = Math.round(baseRollCost * (1 + 0.05 * previousRolls));

      // Check if user can afford the roll cost
      const {
        balance: currentBalance,
        earned,
        spent,
      } = await getUserScrapsBalance(user.id, tx);
      console.log(
        `[SHOP] try-luck user=${user.id} item=${itemId} price=${currentItem.price} baseProbability=${currentItem.baseProbability} effectiveProbability=${effectiveProbability} rollCost=${rollCost} balance=${currentBalance} (earned=${earned} spent=${spent})`,
      );
      const canAffordRoll = currentBalance >= rollCost;
      if (!canAffordRoll) {
        throw {
          type: "insufficient_funds",
          balance: currentBalance,
          cost: rollCost,
        };
      }

      const rolled = randomInt(1, 101);
      const actualThreshold = computeRollThreshold(effectiveProbability);
      const won = rolled <= actualThreshold;
      const displayRolled = !won && rolled <= effectiveProbability
        ? randomInt(effectiveProbability + 1, 101)
        : rolled;

      // Record the roll inside the transaction
      await tx.insert(shopRollsTable).values({
        userId: user.id,
        shopItemId: itemId,
        rolled,
        threshold: actualThreshold,
        won,
      });

      if (won) {
        // Atomic SQL decrement — always uses the live DB value
        await tx
          .update(shopItemsTable)
          .set({
            count: sql`${shopItemsTable.count} - 1`,
            updatedAt: new Date(),
          })
          .where(eq(shopItemsTable.id, itemId));

        const newOrder = await tx
          .insert(shopOrdersTable)
          .values({
            userId: user.id,
            shopItemId: itemId,
            quantity: 1,
            pricePerItem: rollCost,
            totalPrice: rollCost,
            shippingAddress: null,
            phone: userPhone,
            status: "pending",
            orderType: "luck_win",
          })
          .returning();

        await tx
          .delete(refineryOrdersTable)
          .where(
            and(
              eq(refineryOrdersTable.userId, user.id),
              eq(refineryOrdersTable.shopItemId, itemId),
            ),
          );

        const existingPenalty = await tx
          .select({
            probabilityMultiplier: shopPenaltiesTable.probabilityMultiplier,
          })
          .from(shopPenaltiesTable)
          .where(
            and(
              eq(shopPenaltiesTable.userId, user.id),
              eq(shopPenaltiesTable.shopItemId, itemId),
            ),
          )
          .limit(1);

        if (existingPenalty.length > 0) {
          const newMultiplier = Math.max(
            1,
            Math.floor(existingPenalty[0].probabilityMultiplier / 2),
          );
          await tx
            .update(shopPenaltiesTable)
            .set({
              probabilityMultiplier: newMultiplier,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(shopPenaltiesTable.userId, user.id),
                eq(shopPenaltiesTable.shopItemId, itemId),
              ),
            );
        } else {
          await tx.insert(shopPenaltiesTable).values({
            userId: user.id,
            shopItemId: itemId,
            probabilityMultiplier: 50,
          });
        }

        return {
          won: true,
          orderId: newOrder[0].id,
          effectiveProbability,
          rolled: displayRolled,
          rollCost,
        };
      }

      // Create consolation order for scrap paper when user loses
      const consolationOrder = await tx
        .insert(shopOrdersTable)
        .values({
          userId: user.id,
          shopItemId: itemId,
          quantity: 1,
          pricePerItem: rollCost,
          totalPrice: rollCost,
          shippingAddress: null,
          phone: userPhone,
          status: "pending",
          orderType: "consolation",
          notes: `Consolation scrap paper - rolled ${displayRolled}, needed ${effectiveProbability} or less`,
        })
        .returning();

      // Recover penalty slightly on each loss (move multiplier 5 points toward 100)
      if (penaltyMultiplier < 100) {
        const recoveredMultiplier = Math.min(100, penaltyMultiplier + 5);
        await tx
          .update(shopPenaltiesTable)
          .set({
            probabilityMultiplier: recoveredMultiplier,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(shopPenaltiesTable.userId, user.id),
              eq(shopPenaltiesTable.shopItemId, itemId),
            ),
          );
      }

      return {
        won: false,
        penaltyRecovered: penaltyMultiplier < 100,
        effectiveProbability,
        rolled: displayRolled,
        rollCost,
        consolationOrderId: consolationOrder[0].id,
      };
    });

    if (result.won) {
      // Notify Slack channel about the win (fire and forget)
      notifyShopWin(user.id, item.name, item.image ?? "").catch((err) =>
        console.error("[SHOP] Failed to notify shop win:", err),
      );
      return {
        success: true,
        won: true,
        orderId: result.orderId,
        effectiveProbability: result.effectiveProbability,
        rolled: result.rolled,
        rollCost: result.rollCost,
        refineryReset: true,
        probabilityHalved: true,
      };
    }
    return {
      success: true,
      won: false,
      consolationOrderId: result.consolationOrderId,
      effectiveProbability: result.effectiveProbability,
      rolled: result.rolled,
      rollCost: result.rollCost,
    };
  } catch (e) {
    const err = e as { type?: string; balance?: number; cost?: number };
    if (err.type === "insufficient_funds") {
      return {
        error: "Insufficient scraps",
        required: err.cost,
        available: err.balance,
      };
    }
    if (err.type === "out_of_stock") {
      return { error: "Out of stock" };
    }
    throw e;
  }
});

shop.post("/items/:id/upgrade-probability", async ({ params, headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  const itemId = parseInt(params.id);
  if (!Number.isInteger(itemId)) {
    return { error: "Invalid item id" };
  }

  const items = await db
    .select()
    .from(shopItemsTable)
    .where(eq(shopItemsTable.id, itemId))
    .limit(1);

  if (items.length === 0) {
    return { error: "Item not found" };
  }

  const item = items[0];

  if (item.count < 1) {
    return { error: "Item is out of stock" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the user row to serialize spend operations and prevent race conditions
      await tx.execute(
        sql`SELECT 1 FROM users WHERE id = ${user.id} FOR UPDATE`,
      );

      // Re-check stock inside transaction with row lock
      const stockCheck = await tx.execute(
        sql`SELECT "count" FROM shop_items WHERE id = ${itemId} FOR UPDATE`,
      );
      if (
        !stockCheck.rows[0] ||
        (stockCheck.rows[0] as { count: number }).count < 1
      ) {
        throw { type: "out_of_stock" };
      }

      const boostResult = await tx
        .select({
          boostPercent: sql<number>`COALESCE(SUM(${refineryOrdersTable.boostAmount}), 0)`,
        })
        .from(refineryOrdersTable)
        .where(
          and(
            eq(refineryOrdersTable.userId, user.id),
            eq(refineryOrdersTable.shopItemId, itemId),
          ),
        );

      const currentBoost =
        boostResult.length > 0 ? Number(boostResult[0].boostPercent) : 0;

      const penaltyResult = await tx
        .select({
          probabilityMultiplier: shopPenaltiesTable.probabilityMultiplier,
        })
        .from(shopPenaltiesTable)
        .where(
          and(
            eq(shopPenaltiesTable.userId, user.id),
            eq(shopPenaltiesTable.shopItemId, itemId),
          ),
        )
        .limit(1);

      const penaltyMultiplier =
        penaltyResult.length > 0 ? penaltyResult[0].probabilityMultiplier : 100;
      const adjustedBaseProbability = Math.floor(
        (item.baseProbability * penaltyMultiplier) / 100,
      );

      const maxBoost = 100 - adjustedBaseProbability;
      if (currentBoost >= maxBoost) {
        throw { type: "max_probability" };
      }

      // Count number of upgrades purchased (not total boost %)
      const upgradeCountResult = await tx
        .select({ count: sql<number>`COUNT(*)` })
        .from(refineryOrdersTable)
        .where(
          and(
            eq(refineryOrdersTable.userId, user.id),
            eq(refineryOrdersTable.shopItemId, itemId),
          ),
        );
      const upgradeCount = Number(upgradeCountResult[0]?.count) || 0;

      const actualSpentResult = await tx
        .select({
          total: sql<number>`COALESCE(SUM(${refinerySpendingHistoryTable.cost}), 0)`,
        })
        .from(refinerySpendingHistoryTable)
        .where(
          and(
            eq(refinerySpendingHistoryTable.userId, user.id),
            eq(refinerySpendingHistoryTable.shopItemId, itemId),
          ),
        );
      const actualSpent = Number(actualSpentResult[0]?.total) || 0;

      const upgradeCost = getUpgradeCost(item.price, upgradeCount, actualSpent);
      if (upgradeCost === null) {
        throw { type: "max_upgrades" };
      }
      const cost = upgradeCost;

      const affordable = await canAfford(user.id, cost, tx);
      if (!affordable) {
        const { balance } = await getUserScrapsBalance(user.id, tx);
        throw { type: "insufficient_funds", balance, cost };
      }

      const boostAmount = item.boostAmount;
      const newBoost = currentBoost + boostAmount;

      // Record the refinery order
      await tx.insert(refineryOrdersTable).values({
        userId: user.id,
        shopItemId: itemId,
        cost,
        boostAmount,
      });

      // Record spending in history (never deleted)
      await tx.insert(refinerySpendingHistoryTable).values({
        userId: user.id,
        shopItemId: itemId,
        cost,
      });

      const newUpgradeCount = upgradeCount + 1;
      const nextCost =
        newBoost >= maxBoost
          ? null
          : getUpgradeCost(item.price, newUpgradeCount, actualSpent + cost);

      return {
        boostPercent: newBoost,
        boostAmount,
        nextCost,
        effectiveProbability: Math.min(adjustedBaseProbability + newBoost, 100),
      };
    });

    return result;
  } catch (e) {
    const err = e as { type?: string; balance?: number; cost?: number };
    if (err.type === "max_probability") {
      return { error: "Already at maximum probability" };
    }
    if (err.type === "max_upgrades") {
      return { error: "Upgrade budget exhausted" };
    }
    if (err.type === "insufficient_funds") {
      return {
        error: "Insufficient scraps",
        required: err.cost,
        available: err.balance,
      };
    }
    throw e;
  }
});

shop.get("/items/:id/leaderboard", async ({ params }) => {
  const itemId = parseInt(params.id);
  if (!Number.isInteger(itemId)) {
    return { error: "Invalid item id" };
  }

  const items = await db
    .select()
    .from(shopItemsTable)
    .where(eq(shopItemsTable.id, itemId))
    .limit(1);

  if (items.length === 0) {
    return { error: "Item not found" };
  }

  const item = items[0];

  const leaderboard = await db
    .select({
      userId: refineryOrdersTable.userId,
      username: usersTable.username,
      avatar: usersTable.avatar,
      boostPercent: sql<number>`COALESCE(SUM(${refineryOrdersTable.boostAmount}), 0)`,
    })
    .from(refineryOrdersTable)
    .innerJoin(usersTable, eq(refineryOrdersTable.userId, usersTable.id))
    .where(eq(refineryOrdersTable.shopItemId, itemId))
    .groupBy(refineryOrdersTable.userId, usersTable.username, usersTable.avatar)
    .orderBy(desc(sql`SUM(${refineryOrdersTable.boostAmount})`))
    .limit(20);

  return leaderboard.map((entry) => ({
    ...entry,
    boostPercent: Number(entry.boostPercent),
    effectiveProbability: Math.min(
      item.baseProbability + Number(entry.boostPercent),
      100,
    ),
  }));
});

shop.get("/items/:id/buyers", async ({ params }) => {
  const itemId = parseInt(params.id);
  if (!Number.isInteger(itemId)) {
    return { error: "Invalid item id" };
  }

  const buyers = await db
    .select({
      userId: shopOrdersTable.userId,
      username: usersTable.username,
      avatar: usersTable.avatar,
      quantity: shopOrdersTable.quantity,
      purchasedAt: shopOrdersTable.createdAt,
    })
    .from(shopOrdersTable)
    .innerJoin(usersTable, eq(shopOrdersTable.userId, usersTable.id))
    .where(
      and(
        eq(shopOrdersTable.shopItemId, itemId),
        ne(shopOrdersTable.orderType, "consolation"),
        ne(shopOrdersTable.status, "deleted"),
      ),
    )
    .orderBy(desc(shopOrdersTable.createdAt))
    .limit(20);

  return buyers;
});

shop.get("/items/:id/hearts", async ({ params }) => {
  const itemId = parseInt(params.id);
  if (!Number.isInteger(itemId)) {
    return { error: "Invalid item id" };
  }

  const hearts = await db
    .select({
      userId: shopHeartsTable.userId,
      username: usersTable.username,
      avatar: usersTable.avatar,
      createdAt: shopHeartsTable.createdAt,
    })
    .from(shopHeartsTable)
    .innerJoin(usersTable, eq(shopHeartsTable.userId, usersTable.id))
    .where(eq(shopHeartsTable.shopItemId, itemId))
    .orderBy(desc(shopHeartsTable.createdAt))
    .limit(20);

  return hearts;
});

shop.get("/addresses", async ({ headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    console.log("[/shop/addresses] Unauthorized - no user session");
    return { error: "Unauthorized" };
  }

  const userData = await db
    .select({ accessToken: usersTable.accessToken })
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);

  if (userData.length === 0 || !userData[0].accessToken) {
    console.log("[/shop/addresses] No access token found for user", user.id);
    return [];
  }

  try {
    const response = await fetch("https://identity.hackclub.com/api/v1/me", {
      headers: {
        Authorization: `Bearer ${userData[0].accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(
        "[/shop/addresses] Hack Club API error:",
        response.status,
        errorText,
      );
      return [];
    }

    const data = (await response.json()) as {
      identity?: {
        addresses?: Array<{
          id: string;
          first_name: string;
          last_name: string;
          line_1: string;
          line_2: string;
          city: string;
          state: string;
          postal_code: string;
          country: string;
          phone_number: string;
          primary: boolean;
        }>;
      };
    };

    console.log(
      "[/shop/addresses] Got addresses:",
      data.identity?.addresses?.length ?? 0,
    );
    return data.identity?.addresses ?? [];
  } catch (e) {
    console.error("[/shop/addresses] Error fetching from Hack Club:", e);
    return [];
  }
});

shop.get("/orders/pending-address", async ({ headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  const orders = await db
    .select({
      id: shopOrdersTable.id,
      quantity: shopOrdersTable.quantity,
      pricePerItem: shopOrdersTable.pricePerItem,
      totalPrice: shopOrdersTable.totalPrice,
      status: shopOrdersTable.status,
      orderType: shopOrdersTable.orderType,
      createdAt: shopOrdersTable.createdAt,
      itemId: shopItemsTable.id,
      itemName: shopItemsTable.name,
      itemImage: shopItemsTable.image,
    })
    .from(shopOrdersTable)
    .innerJoin(
      shopItemsTable,
      eq(shopOrdersTable.shopItemId, shopItemsTable.id),
    )
    .where(
      and(
        eq(shopOrdersTable.userId, user.id),
        isNull(shopOrdersTable.shippingAddress),
      ),
    )
    .orderBy(desc(shopOrdersTable.createdAt));

  return orders;
});

shop.post("/orders/:id/address", async ({ params, body, headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  const orderId = parseInt(params.id);
  if (!Number.isInteger(orderId)) {
    return { error: "Invalid order id" };
  }

  const { shippingAddress } = body as { shippingAddress?: string };
  if (!shippingAddress) {
    return { error: "Shipping address is required" };
  }

  const orders = await db
    .select()
    .from(shopOrdersTable)
    .where(eq(shopOrdersTable.id, orderId))
    .limit(1);

  if (orders.length === 0) {
    return { error: "Order not found" };
  }

  if (orders[0].userId !== user.id) {
    return { error: "Unauthorized" };
  }

  await db
    .update(shopOrdersTable)
    .set({
      shippingAddress,
      updatedAt: new Date(),
    })
    .where(eq(shopOrdersTable.id, orderId));

  return { success: true };
});

shop.post("/items/:id/refinery/undo", async ({ params, headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  const itemId = parseInt(params.id);
  if (!Number.isInteger(itemId)) {
    return { error: "Invalid item id" };
  }

  const item = await db
    .select()
    .from(shopItemsTable)
    .where(eq(shopItemsTable.id, itemId))
    .limit(1);

  if (item.length === 0) {
    return { error: "Item not found" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT 1 FROM users WHERE id = ${user.id} FOR UPDATE`,
      );

      // Check if user has purchased or won this item - only allow undoing upgrades made AFTER the most recent purchase
      const lastPurchase = await tx
        .select({ createdAt: shopOrdersTable.createdAt })
        .from(shopOrdersTable)
        .where(
          and(
            eq(shopOrdersTable.userId, user.id),
            eq(shopOrdersTable.shopItemId, itemId),
            or(
              eq(shopOrdersTable.orderType, "purchase"),
              eq(shopOrdersTable.orderType, "luck_win"),
            ),
          ),
        )
        .orderBy(desc(shopOrdersTable.createdAt))
        .limit(1);

      const orderConditions = [
        eq(refineryOrdersTable.userId, user.id),
        eq(refineryOrdersTable.shopItemId, itemId),
      ];

      if (lastPurchase.length > 0) {
        orderConditions.push(
          gt(refineryOrdersTable.createdAt, lastPurchase[0].createdAt),
        );
      }

      const orders = await tx
        .select()
        .from(refineryOrdersTable)
        .where(and(...orderConditions))
        .orderBy(desc(refineryOrdersTable.createdAt))
        .limit(1);

      if (orders.length === 0) {
        if (lastPurchase.length > 0) {
          return {
            error:
              "Cannot undo refinery upgrades from before your last purchase",
          };
        }
        return { error: "No refinery upgrades to undo" };
      }

      const order = orders[0];

      await tx
        .delete(refineryOrdersTable)
        .where(eq(refineryOrdersTable.id, order.id));

      // delete one specific spending history row instead of all with matching cost
      const matchingHistory = await tx
        .select({ id: refinerySpendingHistoryTable.id })
        .from(refinerySpendingHistoryTable)
        .where(
          and(
            eq(refinerySpendingHistoryTable.userId, user.id),
            eq(refinerySpendingHistoryTable.shopItemId, itemId),
            eq(refinerySpendingHistoryTable.cost, order.cost),
          ),
        )
        .orderBy(desc(refinerySpendingHistoryTable.createdAt))
        .limit(1);

      if (matchingHistory.length > 0) {
        await tx
          .delete(refinerySpendingHistoryTable)
          .where(eq(refinerySpendingHistoryTable.id, matchingHistory[0].id));
      }

      const boost = await tx
        .select({
          boostPercent: sql<number>`COALESCE(SUM(${refineryOrdersTable.boostAmount}), 0)`,
          upgradeCount: sql<number>`COUNT(*)`,
        })
        .from(refineryOrdersTable)
        .where(
          and(
            eq(refineryOrdersTable.userId, user.id),
            eq(refineryOrdersTable.shopItemId, itemId),
          ),
        );

      const newBoostPercent =
        boost.length > 0 ? Number(boost[0].boostPercent) : 0;
      const newUpgradeCount =
        boost.length > 0 ? Number(boost[0].upgradeCount) : 0;

      const penalty = await tx
        .select({
          probabilityMultiplier: shopPenaltiesTable.probabilityMultiplier,
        })
        .from(shopPenaltiesTable)
        .where(
          and(
            eq(shopPenaltiesTable.userId, user.id),
            eq(shopPenaltiesTable.shopItemId, itemId),
          ),
        )
        .limit(1);

      const penaltyMultiplier =
        penalty.length > 0 ? penalty[0].probabilityMultiplier : 100;
      const adjustedBaseProbability = Math.floor(
        (item[0].baseProbability * penaltyMultiplier) / 100,
      );
      const maxBoost = 100 - adjustedBaseProbability;

      const spentAfterUndo = await tx
        .select({
          total: sql<number>`COALESCE(SUM(${refinerySpendingHistoryTable.cost}), 0)`,
        })
        .from(refinerySpendingHistoryTable)
        .where(
          and(
            eq(refinerySpendingHistoryTable.userId, user.id),
            eq(refinerySpendingHistoryTable.shopItemId, itemId),
          ),
        );
      const actualSpent = Number(spentAfterUndo[0]?.total) || 0;

      const nextCost =
        newBoostPercent >= maxBoost
          ? null
          : getUpgradeCost(item[0].price, newUpgradeCount, actualSpent);

      return {
        boostPercent: newBoostPercent,
        upgradeCount: newUpgradeCount,
        refundedCost: order.cost,
        effectiveProbability: Math.min(
          adjustedBaseProbability + newBoostPercent,
          100,
        ),
        nextCost,
      };
    });

    return result;
  } catch (e) {
    console.error("[SHOP] refinery undo failed:", e);
    return { error: "Failed to undo refinery upgrade" };
  }
});

shop.post("/items/:id/refinery/undo-all", async ({ params, headers }) => {
  const user = await getUserFromSession(headers as Record<string, string>);
  if (!user) {
    return { error: "Unauthorized" };
  }

  const itemId = parseInt(params.id);
  if (!Number.isInteger(itemId)) {
    return { error: "Invalid item id" };
  }

  const item = await db
    .select()
    .from(shopItemsTable)
    .where(eq(shopItemsTable.id, itemId))
    .limit(1);

  if (item.length === 0) {
    return { error: "Item not found" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT 1 FROM users WHERE id = ${user.id} FOR UPDATE`,
      );

      // Check if user has purchased or won this item
      const lastPurchase = await tx
        .select({ createdAt: shopOrdersTable.createdAt })
        .from(shopOrdersTable)
        .where(
          and(
            eq(shopOrdersTable.userId, user.id),
            eq(shopOrdersTable.shopItemId, itemId),
            or(
              eq(shopOrdersTable.orderType, "purchase"),
              eq(shopOrdersTable.orderType, "luck_win"),
            ),
          ),
        )
        .orderBy(desc(shopOrdersTable.createdAt))
        .limit(1);

      const orderConditions = [
        eq(refineryOrdersTable.userId, user.id),
        eq(refineryOrdersTable.shopItemId, itemId),
      ];

      if (lastPurchase.length > 0) {
        orderConditions.push(
          gt(refineryOrdersTable.createdAt, lastPurchase[0].createdAt),
        );
      }

      const orders = await tx
        .select()
        .from(refineryOrdersTable)
        .where(and(...orderConditions));

      if (orders.length === 0) {
        if (lastPurchase.length > 0) {
          return {
            error:
              "Cannot undo refinery upgrades from before your last purchase",
          };
        }
        return { error: "No refinery upgrades to undo" };
      }

      let totalRefunded = 0;

      for (const order of orders) {
        await tx
          .delete(refineryOrdersTable)
          .where(eq(refineryOrdersTable.id, order.id));

        const matchingHistory = await tx
          .select({ id: refinerySpendingHistoryTable.id })
          .from(refinerySpendingHistoryTable)
          .where(
            and(
              eq(refinerySpendingHistoryTable.userId, user.id),
              eq(refinerySpendingHistoryTable.shopItemId, itemId),
              eq(refinerySpendingHistoryTable.cost, order.cost),
            ),
          )
          .orderBy(desc(refinerySpendingHistoryTable.createdAt))
          .limit(1);

        if (matchingHistory.length > 0) {
          await tx
            .delete(refinerySpendingHistoryTable)
            .where(eq(refinerySpendingHistoryTable.id, matchingHistory[0].id));
        }

        totalRefunded += order.cost;
      }

      // Get remaining boost (from locked orders before last purchase)
      const boost = await tx
        .select({
          boostPercent: sql<number>`COALESCE(SUM(${refineryOrdersTable.boostAmount}), 0)`,
          upgradeCount: sql<number>`COUNT(*)`,
        })
        .from(refineryOrdersTable)
        .where(
          and(
            eq(refineryOrdersTable.userId, user.id),
            eq(refineryOrdersTable.shopItemId, itemId),
          ),
        );

      const newBoostPercent =
        boost.length > 0 ? Number(boost[0].boostPercent) : 0;
      const newUpgradeCount =
        boost.length > 0 ? Number(boost[0].upgradeCount) : 0;

      const penalty = await tx
        .select({
          probabilityMultiplier: shopPenaltiesTable.probabilityMultiplier,
        })
        .from(shopPenaltiesTable)
        .where(
          and(
            eq(shopPenaltiesTable.userId, user.id),
            eq(shopPenaltiesTable.shopItemId, itemId),
          ),
        )
        .limit(1);

      const penaltyMultiplier =
        penalty.length > 0 ? penalty[0].probabilityMultiplier : 100;
      const adjustedBaseProbability = Math.floor(
        (item[0].baseProbability * penaltyMultiplier) / 100,
      );
      const maxBoost = 100 - adjustedBaseProbability;

      const spentAfterUndo = await tx
        .select({
          total: sql<number>`COALESCE(SUM(${refinerySpendingHistoryTable.cost}), 0)`,
        })
        .from(refinerySpendingHistoryTable)
        .where(
          and(
            eq(refinerySpendingHistoryTable.userId, user.id),
            eq(refinerySpendingHistoryTable.shopItemId, itemId),
          ),
        );
      const actualSpent = Number(spentAfterUndo[0]?.total) || 0;

      const nextCost =
        newBoostPercent >= maxBoost
          ? null
          : getUpgradeCost(item[0].price, newUpgradeCount, actualSpent);

      return {
        boostPercent: newBoostPercent,
        upgradeCount: newUpgradeCount,
        refundedCost: totalRefunded,
        undoneCount: orders.length,
        effectiveProbability: Math.min(
          adjustedBaseProbability + newBoostPercent,
          100,
        ),
        nextCost,
      };
    });

    return result;
  } catch (e) {
    console.error("[SHOP] refinery undo-all failed:", e);
    return { error: "Failed to undo refinery upgrades" };
  }
});

export default shop;
