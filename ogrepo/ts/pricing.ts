  const rollCost = calculateRollCost(price, prob, undefined, prob);

  const threshold = computeRollThreshold(prob);
  const expectedRollsAtBase = threshold > 0 ? Math.round((100 / threshold) * 10) / 10 : Infinity;
  const expectedSpendAtBase = Math.round(rollCost * expectedRollsAtBase);

  const probabilityGap = 100 - prob;
  const targetUpgrades = Math.max(5, Math.min(20, Math.ceil(dollarCost / 5)));
  const boostAmount = Math.max(1, Math.round(probabilityGap / targetUpgrades));

  // Upgrades start at 25% of item price and decay by 1.05x per level
  const baseUpgradeCost = Math.max(1, Math.floor(price * 0.25));
  const costMultiplier = 105; // stored as percentage, used as decay divisor