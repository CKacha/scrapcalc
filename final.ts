export type RefineryInputs = {
  // items
  price: number;              
  baseProbability: number;    
  boostAmount: number;         

  // unique state per user
  penaltyMultiplier?: number;  // 100% reg, can be 50 after win( might recover on losses?)
  boostPercent?: number;       // total of refineryOrders.boostAmount
  upgradeCount?: number;       // # of rows in refineryOrders
  refinerySpent?: number;      // total of refinery_spending_history.cost
  previousRolls?: number;      // count(shop_rolls) of wtvr item this is used on
  rollCostOverride?: number | null; // prob not used but just in case 
};

const UPGRADE_START_PERCENT = 0.25;
const UPGRADE_DECAY = 1.05;
const UPGRADE_MAX_BUDGET_MULTIPLIER = 3;

export function computeRollThreshold(displayedProbability: number): number {
  return Math.max(1, Math.floor((displayedProbability * 17) / 20));
}

export function calculateRollCost(
  basePrice: number,
  effectiveProbability: number,
  rollCostOverride?: number | null,
  baseProbability?: number
): number {
  if (rollCostOverride != null && rollCostOverride > 0) return rollCostOverride;

  // IMPORTANT: uses baseProbability if provided (so upgrades don't change base cost)
  const baseProb = baseProbability ?? effectiveProbability;
  return Math.max(1, Math.round(basePrice * (baseProb / 100)));
}

export function escalateRollCost(baseRollCost: number, previousRolls: number): number {
  // +5% per prior roll
  const rolls = Math.max(0, previousRolls || 0);
  return Math.round(baseRollCost * (1 + 0.05 * rolls));
}

export function getUpgradeCost(price: number, upgradeCount: number, spent: number): number | null {
  const maxBudget = price * UPGRADE_MAX_BUDGET_MULTIPLIER;
  const cumulative = Math.max(0, spent || 0);
  if (cumulative >= maxBudget) return null;

  const nextCost = Math.max(
    1,
    Math.floor(price * UPGRADE_START_PERCENT / Math.pow(UPGRADE_DECAY, Math.max(0, upgradeCount || 0)))
  );

  if (cumulative + nextCost > maxBudget) {
    const remaining = Math.floor(maxBudget - cumulative);
    return remaining > 0 ? remaining : null;
  }
  return nextCost;
}

export function computeEffectiveProbability(
  baseProbability: number,
  penaltyMultiplier: number,
  boostPercent: number
) {
  const adjustedBaseProbability = Math.floor((baseProbability * penaltyMultiplier) / 100);
  const maxBoost = 100 - adjustedBaseProbability;
  const clampedBoost = Math.min(Math.max(0, boostPercent), maxBoost);
  const effectiveProbability = Math.min(adjustedBaseProbability + clampedBoost, 100);

  return { adjustedBaseProbability, maxBoost, clampedBoost, effectiveProbability };
}

export function expectedAtProbability(price: number, displayedProb: number) {
  const baseRollCost = calculateRollCost(price, displayedProb, null, displayedProb);
  const threshold = computeRollThreshold(displayedProb);

  const expectedRolls = threshold > 0 ? Math.round((100 / threshold) * 10) / 10 : Infinity;
  const expectedSpend = Number.isFinite(expectedRolls) ? Math.round(baseRollCost * expectedRolls) : Infinity;

  return { baseRollCost, threshold, expectedRolls, expectedSpend };
}

export function computeRefinerySnapshot(input: RefineryInputs) {
  const penaltyMultiplier = input.penaltyMultiplier ?? 100;
  const boostPercent = input.boostPercent ?? 0;
  const upgradeCount = input.upgradeCount ?? 0;
  const refinerySpent = input.refinerySpent ?? 0;
  const previousRolls = input.previousRolls ?? 0;

  const { adjustedBaseProbability, maxBoost, clampedBoost, effectiveProbability } =
    computeEffectiveProbability(input.baseProbability, penaltyMultiplier, boostPercent);

  const baseRollCost = calculateRollCost(
    input.price,
    effectiveProbability,
    input.rollCostOverride ?? null,
    input.baseProbability
  );

  const rollCost = escalateRollCost(baseRollCost, previousRolls);
  const threshold = computeRollThreshold(effectiveProbability);

  const nextUpgradeCost =
    clampedBoost >= maxBoost ? null : getUpgradeCost(input.price, upgradeCount, refinerySpent);

  const nextBoostPercent = Math.min(clampedBoost + input.boostAmount, maxBoost);
  const nextEffectiveProbability = Math.min(adjustedBaseProbability + nextBoostPercent, 100);

  return {
    adjustedBaseProbability,
    boostPercent: clampedBoost,
    effectiveProbability,
    threshold,          
    baseRollCost,
    rollCost,         
    nextUpgradeCost,
    nextBoostPercent,
    nextEffectiveProbability,
    upgradeBudgetMax: input.price * UPGRADE_MAX_BUDGET_MULTIPLIER,
  };
}