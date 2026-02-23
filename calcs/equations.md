final method in case someone wanna know how dis works

upgrade(subset i) = [(0.25)price/1.05^(i-1)]

(Each upgrade level k = 0..25)

Adjusted base probability
	if “Already won?” is ON: adjustedBase = floor(base% * 50 / 100)
else: adjustedBase = base%

probaility is
displayed = min(adjustedBase + min(k*boostAmount, 100 - adjustedBase), 100)

Actual win chance
threshold = floor(displayed * 17 / 20) 
p = threshold / 100

Upgrade spending (decaying)
sum floor(price*0.25/1.05^i) for i=0..k-1, capped at price*3

Expected roll spending
baseline expected rolls = 1/p
roll cost escalates +5% per prior roll SOB

Expected total
expectedTotal = upgradeSpent + expectedRollSpend
Pick the k with the smallest expectedTotal.