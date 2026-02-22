https://github.com/CKacha/scrapcalc/settings/pages

get the pages on sometime idiot

the hell is a drizzle folder sob

that admin.ts was hell to parse

find & grab following:

import {
  shopItemsTable,
  shopOrdersTable,
  shopHeartsTable,
  shopRollsTable,
  refineryOrdersTable,
  shopPenaltiesTable,
  refinerySpendingHistoryTable,
} from "../schemas/shop";
import { calculateScrapsFromHours, getUserScrapsBalance, TIER_MULTIPLIERS, DOLLARS_PER_HOUR, SCRAPS_PER_DOLLAR } from "../lib/scraps";
import { computeItemPricing, updateShopItemPricing } from "../lib/shop-pricing";