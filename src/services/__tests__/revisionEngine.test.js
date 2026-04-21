const { computeDecisions } = require('../revisionEngine');

// Helper to build a single item
function makeItem(overrides = {}) {
  return {
    product_id: 1,
    location_id: 1,
    upc: '8020647637812',
    original_qty: 2,
    product_name: 'Test Shoe',
    size: '42',
    color: 'Black',
    category: 'Shoes',
    location_name: 'SLC',
    order_item_id: 100,
    order_id: 10,
    ...overrides,
  };
}

function run(items, opts = {}) {
  return computeDecisions({
    items,
    targetMap: opts.targetMap || {},
    inventoryMap: opts.inventoryMap || {},
    salesMap: opts.salesMap || {},
    priorRevisionMap: opts.priorRevisionMap || {},
    discontinuedUPCs: opts.discontinuedUPCs || new Set(),
    overrides: opts.overrides || undefined,
  });
}

describe('computeDecisions', () => {
  test('item at target → cancel (at_or_above_target)', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 2 },
      inventoryMap: { '8020647637812|1': 2 },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('cancel');
    expect(decisions[0].adjustedQty).toBe(0);
    expect(decisions[0].reason).toBe('positive_stock_cancel');
    expect(decisions[0].targetQty).toBe(2);
  });

  test('item above target → cancel (positive_stock_cancel)', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 1 },
      inventoryMap: { '8020647637812|1': 3 },
    });
    expect(decisions[0].decision).toBe('cancel');
    expect(decisions[0].adjustedQty).toBe(0);
    expect(decisions[0].reason).toBe('positive_stock_cancel');
  });

  test('item below target → ship, adjustedQty = min(original_qty, target - onHand)', () => {
    const item = makeItem({ original_qty: 5 });
    const { decisions } = run([item], {
      targetMap: { '1|1': 4 },
      inventoryMap: { '8020647637812|1': 1 },
    });
    expect(decisions[0].decision).toBe('ship');
    expect(decisions[0].adjustedQty).toBe(3); // min(5, 4-1)
    expect(decisions[0].reason).toBe('below_target');
  });

  test('item below target, clamped to original_qty', () => {
    const item = makeItem({ original_qty: 1 });
    const { decisions } = run([item], {
      targetMap: { '1|1': 10 },
      inventoryMap: { '8020647637812|1': 0 },
    });
    expect(decisions[0].decision).toBe('ship');
    expect(decisions[0].adjustedQty).toBe(1); // min(1, 10-0) = 1
    expect(decisions[0].reason).toBe('zero_stock');
  });

  test('item with no target row → target defaults to 0, cancel', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: {},
      inventoryMap: { '8020647637812|1': 0 },
    });
    expect(decisions[0].decision).toBe('cancel');
    expect(decisions[0].adjustedQty).toBe(0);
    expect(decisions[0].reason).toBe('at_or_above_target');
    expect(decisions[0].targetQty).toBe(0);
  });

  test('item with manual override', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 0 },
      inventoryMap: { '8020647637812|1': 5 },
      overrides: [{ upc: '8020647637812', locationId: 1, decision: 'ship', adjustedQty: 2, reason: 'user_override' }],
    });
    expect(decisions[0].decision).toBe('ship');
    expect(decisions[0].adjustedQty).toBe(2);
    expect(decisions[0].reason).toBe('user_override');
  });

  test('discontinued product → always cancel regardless of target', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 5 },
      inventoryMap: { '8020647637812|1': 0 },
      discontinuedUPCs: new Set(['8020647637812']),
    });
    expect(decisions[0].decision).toBe('cancel');
    expect(decisions[0].adjustedQty).toBe(0);
    expect(decisions[0].reason).toBe('discontinued_product');
    expect(decisions[0].isDiscontinued).toBe(true);
  });

  test('received_not_inventoried → on_hand=0 but recent sales', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 3 },
      inventoryMap: { '8020647637812|1': 0 },
      salesMap: { '8020647637812|1': { qtySold: 5, transactions: 2, lastSale: '2026-04-01' } },
    });
    expect(decisions[0].decision).toBe('cancel');
    expect(decisions[0].adjustedQty).toBe(0);
    expect(decisions[0].reason).toBe('received_not_inventoried');
    expect(decisions[0].receivedNotInventoried).toBe(true);
  });

  test('zero_stock → on_hand=0, no sales, below target', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 3 },
      inventoryMap: { '8020647637812|1': 0 },
    });
    expect(decisions[0].decision).toBe('ship');
    expect(decisions[0].reason).toBe('zero_stock');
  });

  test('positive_stock_cancel → on_hand > 0 and >= target', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 1 },
      inventoryMap: { '8020647637812|1': 1 },
    });
    expect(decisions[0].decision).toBe('cancel');
    expect(decisions[0].reason).toBe('positive_stock_cancel');
  });

  test('at_or_above_target when target=0 and on_hand=0', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 0 },
      inventoryMap: { '8020647637812|1': 0 },
    });
    expect(decisions[0].decision).toBe('cancel');
    expect(decisions[0].reason).toBe('at_or_above_target');
  });

  test('summary is computed correctly', () => {
    const items = [
      makeItem({ product_id: 1, order_item_id: 100, original_qty: 3 }),
      makeItem({ product_id: 2, order_item_id: 101, original_qty: 2, upc: '8020647637829' }),
    ];
    const { summary } = run(items, {
      targetMap: { '1|1': 5, '2|1': 0 },
      inventoryMap: { '8020647637812|1': 0, '8020647637829|1': 0 },
    });
    expect(summary.totalItems).toBe(2);
    expect(summary.ship).toBe(1);
    expect(summary.cancel).toBe(1);
    expect(summary.originalTotalQty).toBe(5);
    expect(summary.adjustedTotalQty).toBe(3); // first ships 3, second cancels 0
  });

  test('below_target with positive on_hand — partial ship', () => {
    const item = makeItem({ original_qty: 5 });
    const { decisions } = run([item], {
      targetMap: { '1|1': 3 },
      inventoryMap: { '8020647637812|1': 1 },
    });
    expect(decisions[0].decision).toBe('ship');
    expect(decisions[0].adjustedQty).toBe(2); // min(5, 3-1)
    expect(decisions[0].reason).toBe('below_target');
  });

  test('discontinued takes priority over received_not_inventoried', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 5 },
      inventoryMap: { '8020647637812|1': 0 },
      salesMap: { '8020647637812|1': { qtySold: 3, transactions: 1 } },
      discontinuedUPCs: new Set(['8020647637812']),
    });
    expect(decisions[0].reason).toBe('discontinued_product');
  });

  test('override takes priority over discontinued', () => {
    const item = makeItem();
    const { decisions } = run([item], {
      targetMap: { '1|1': 5 },
      inventoryMap: { '8020647637812|1': 0 },
      discontinuedUPCs: new Set(['8020647637812']),
      overrides: [{ upc: '8020647637812', locationId: 1, decision: 'ship', adjustedQty: 1, reason: 'user_override' }],
    });
    expect(decisions[0].decision).toBe('ship');
    expect(decisions[0].reason).toBe('user_override');
  });
});
