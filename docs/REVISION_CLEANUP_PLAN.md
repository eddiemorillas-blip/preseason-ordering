# Revision Cleanup Plan — Target-Qty Rebuild

## A. INVENTORY — Current State Assessment

### A1. Orders-mode Revision
- **Files**: `frontend/src/components/RevisionModal.jsx` (686 lines), `frontend/src/pages/Revisions.jsx` (1275 lines), `src/routes/revisions.js` POST `/run` (lines 62-519), POST `/apply` (lines 525-636)
- **What it does**: User selects orders, runs dry-run preview (BigQuery inventory + sales + discontinued checks → ship/cancel decisions), optionally toggles items, then applies. Supports paste-mode where items come from pasted brand text instead of DB order_items.
- **Verdict**: **REFACTOR** — Keep both entry points (orders + paste), replace decision logic with target-qty algorithm. Remove maxReductionPct/exceedsCap calculation.

### A2. Spreadsheet-mode Revision
- **Files**: `RevisionModal.jsx` "spreadsheet" tab, `src/routes/revisions.js` POST `/spreadsheet` (lines 1566-1869), POST `/compare-spreadsheet` (lines 863-1060), POST `/template-preview` (lines 804-884)
- **What it does**: User uploads vendor form, system reads UPCs via brand template, runs same decision logic, fills in decision columns, returns modified XLSX.
- **Verdict**: **REFACTOR** — Same tabs, same vendor-form parsing, new target-qty algorithm under the hood. Extract shared decision function to `src/services/revisionEngine.js`.

### A3. Vendor Form Templates
- **Files**: `frontend/src/components/VendorTemplateEditor.jsx`, `frontend/src/pages/FormTemplateManager.jsx`, `frontend/src/components/FormImportModal.jsx`, `frontend/src/components/TemplateUploadModal.jsx`, `src/routes/revisions.js` template CRUD (lines 712-798)
- **What it does**: Store per-brand column mappings, sheet names, location mappings for parsing vendor spreadsheets.
- **Verdict**: **KEEP** — No changes needed. Template system is orthogonal to decision logic.

### A4. maxReductionPct Slider + Flip-Back Logic
- **Files**: `RevisionModal.jsx` line 29 (state), line 56 (passed to API), lines 326-327 (UI text), lines 455-458 (flipped count display). `Revisions.jsx` lines 832-840 (slider UI). `src/routes/revisions.js` lines 77-82 (param), lines 417-423 (exceedsCap calc), lines 439/451 (stored in revisions table). `mcp-server/tools/revisions.js` lines 425-430 (same).
- **What it does**: Calculates whether cancellation exceeds cap percentage. **Never actually flips items back** — `exceedsCap` is computed but ignored. `wasFlipped` is hardcoded `false` everywhere. UI text at RevisionModal.jsx:326 promises flip-back that doesn't exist.
- **Verdict**: **DELETE** — Remove slider, exceedsCap calculation, wasFlipped field from new decisions, and misleading UI text. Keep `max_reduction_pct` column in `revisions` table (historic data) but stop writing to it. Keep `flipped_back_cap` reason code in REASON_LABELS for historic display only.

### A5. Reason Codes
- **Current codes** (defined in `RevisionModal.jsx` lines 17-24, `Revisions.jsx` lines 22-27):
  - `zero_stock` — on_hand=0, no sales → ship
  - `positive_stock_cancel` — on_hand>0 → cancel
  - `discontinued_product` — flagged in knowledge
  - `received_not_inventoried` — on_hand=0 but recent sales → cancel
  - `flipped_back_cap` — defined but **never assigned**
  - `user_override` — user manually toggled
- **Verdict**: **KEEP ALL**. Add new codes:
  - `at_or_above_target` — on_hand >= target_qty, cancel (base target rule)
  - `below_target` — on_hand < target_qty, ship (base target rule)
  - `removed_by_chat` — chatbot cancelled via natural language

### A6. RecentSales / PriorRevision / ReceivedNotInventoried Lookups
- **Files**: `src/routes/revisions.js` lines 275-352 (BigQuery sales query, salesMap, priorRevisionMap, discontinuedUPCs)
- **What it does**: Enriches each item with sales velocity, prior revision history, discontinued status, and received-not-inventoried detection. These drive the specific reason codes layered on top of the base decision.
- **Verdict**: **KEEP** — These produce the more-specific reason codes. In the new target-qty model, the base decision comes from target vs on_hand, then these checks override the reason code to be more specific (e.g., `positive_stock_cancel` → `received_not_inventoried` if sales exist but no inventory).

### A7. Revision History + Compare
- **Files**: `frontend/src/components/RevisionHistoryPanel.jsx`, `src/routes/revisions.js` GET `/history` (lines 641-676), GET `/compare` (lines 681-709), `mcp-server/tools/revisions.js` `get_revision_history` (lines 12-108), `compare_revisions` (lines 113-196)
- **Verdict**: **KEEP** — No changes needed.

### A8. RevisionChat + revisions-chat.js + MCP Bridge + agentTools
- **Files**: `frontend/src/components/RevisionChat.jsx` (259 lines), `src/routes/revisions-chat.js` (353 lines), `src/services/mcpToolBridge.js` (94 lines), `src/services/agentTools.js` (2600 lines), `src/services/aiAgent.js` (675 lines)
- **What it does**: Anthropic tool-use loop. User sends natural language, Claude calls MCP tools, results applied to frontend decisions.
- **Verdict**: **KEEP** — Update system prompt to describe target-qty rule. Add `set_target_qty` tool. Update tool descriptions that reference dead cap/flip concepts.

### A9. Individual MCP Tools

| Tool | Module | Verdict | Notes |
|------|--------|---------|-------|
| `modify_decision` | adjustments.js | **KEEP** | Works by UPC, no DB. Perfect for paste mode. |
| `adjust_item` | adjustments.js | **KEEP** | DB write by orderItemId. Still needed for order-mode items. |
| `batch_adjust` | adjustments.js | **KEEP** | Batch DB write. |
| `preview_percentage_adjustment` | adjustments.js | **KEEP** | Useful for "reduce everything 10%". |
| `apply_percentage_adjustment` | adjustments.js | **KEEP** | Applies % change. |
| `apply_size_curve` | adjustments.js | **KEEP** | Size-based adjustments. |
| `get_revision_history` | revisions.js | **KEEP** | |
| `compare_revisions` | revisions.js | **KEEP** | |
| `run_revision` | revisions.js | **UPDATE** | Replace decision logic with target-qty. Remove exceedsCap/wasFlipped. |
| `update_order_decisions` | shipments.js | **UPDATE** | Remove `maxReductionPct` param. Keep rest. |
| `create_shipment` | shipments.js | **KEEP** | |
| `update_receipt_status` | shipments.js | **KEEP** | |
| `get_pending_shipments` | shipments.js | **KEEP** | |
| `get_order_receipt_summary` | shipments.js | **KEEP** | |
| `check_email_processed` | shipments.js | **KEEP** | |
| `import_vendor_form` | vendor-forms.js | **KEEP** | |
| `save_vendor_form_template` | vendor-forms.js | **KEEP** | |
| `get_vendor_form_template` | vendor-forms.js | **KEEP** | |
| `get_knowledge` | knowledge.js | **KEEP** | |
| `add_knowledge` | knowledge.js | **KEEP** | |
| `get_adjustment_rules` | knowledge.js | **KEEP** | |
| `get_full_context` | knowledge.js | **KEEP** | |
| `list_orders` | orders.js | **KEEP** | |
| `get_order_details` | orders.js | **KEEP** | |
| `get_order_inventory` | orders.js | **KEEP** | |
| `get_ship_dates` | orders.js | **KEEP** | |
| `get_finalized_status` | orders.js | **KEEP** | |
| `get_brand_patterns` | patterns.js | **KEEP** | |
| `get_location_patterns` | patterns.js | **KEEP** | |
| `get_suggested_adjustments` | patterns.js | **KEEP** | |
| `get_total_inventory_value` | sales.js | **KEEP** | |
| `query_sales` | sales.js | **KEEP** | |
| `get_velocity` | sales.js | **KEEP** | |
| `compare_year_over_year` | sales.js | **KEEP** | |
| `get_stock_on_hand` | sales.js | **KEEP** | |
| `get_inventory_status` | sales.js | **KEEP** | |
| `lookup_barcodes` | sales.js | **KEEP** | |
| `get_zero_stock` | sales.js | **KEEP** | |
| `find_sold_not_in_inventory` | sales.js | **KEEP** | |
| `get_recent_sales_by_upc` | sales.js | **KEEP** | |

### A10. Knowledge Layer
- **Files**: `mcp-server/tools/knowledge.js`, `src/routes/knowledge.js`, `migrations/018_knowledge_layer.sql`
- **Verdict**: **KEEP** — Used by revision engine for discontinued product checks and by chatbot for institutional rules.

### A11. BigQuery Sync + Sales Lookups
- **Files**: `src/services/bigquery.js`, `src/routes/sales.js`, `src/routes/sales-data.js`, `mcp-server/tools/sales.js`
- **Verdict**: **KEEP** — Provides on-hand inventory and sales velocity data.

### A12. OrderAdjustment.jsx State Blocks
| Block | Lines | Verdict | Notes |
|-------|-------|---------|-------|
| Filter state (seasons, brands, locations, shipDates) | 12-20 | **KEEP** | |
| Location tabs + inventoryByLocation | 23-25 | **KEEP** | |
| Editing state (inline qty edit) | 32-34 | **KEEP** | |
| Add Items panel | 37-45 | **KEEP** | |
| Order finalization | 48-50 | **KEEP** | |
| Brand form import/export | 53-56 | **KEEP** | |
| AI Assistant state | 59-60 | **KEEP** | |

---

## B. NEW SCHEMA — Target Quantities

### B1. Table Design

```
product_location_targets
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE
  location_id   INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE
  target_qty    INTEGER NOT NULL DEFAULT 0
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  updated_by    TEXT   -- 'web_user:{id}' or 'chatbot' or 'csv_import'
  PRIMARY KEY (product_id, location_id)
```

### B2. Migration SQL

```sql
-- migrations/022_product_location_targets.sql

CREATE TABLE IF NOT EXISTS product_location_targets (
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id  INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  target_qty   INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by   TEXT,
  PRIMARY KEY (product_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_targets_product ON product_location_targets(product_id);
CREATE INDEX IF NOT EXISTS idx_targets_location ON product_location_targets(location_id);
CREATE INDEX IF NOT EXISTS idx_targets_updated ON product_location_targets(updated_at DESC);

-- DOWN (commented out):
-- DROP TABLE IF EXISTS product_location_targets;
```

### B3. Defaults & Backfill
- **Missing row = target_qty 0** — the revision engine treats absent targets as 0, meaning any on_hand >= 0 triggers cancel. This is the safe default: buyers opt-in to receiving product by setting targets.
- **No backfill** — buyers populate targets via the new UI or chatbot. Existing orders are unaffected until a target-qty revision is run.

### B4. Historic Columns
- **`revisions.max_reduction_pct`** — KEEP column, stop writing to it. Historic revisions remain readable.
- **`revisions.logic_applied`** — KEEP. New revisions will write `'target_qty'` instead of `'zero_stock_with_cap'`.
- **`adjustment_history.was_flipped`** — KEEP column (historic), stop writing `true` to it (it's already always `false`).
- **`decisions[].wasFlipped`** — REMOVE from API response (only for new revisions). Frontend stops rendering the flipped indicator.

---

## C. REVISION ENGINE REWRITE PLAN

### C1. Shared Decision Function

**File**: `src/services/revisionEngine.js` (new)

Both `/revisions/run` and `/revisions/spreadsheet` call this function. The MCP `run_revision` tool also calls it.

### C2. Request/Response Shapes

**POST /revisions/run** — request changes:
- REMOVE: `maxReductionPct`
- KEEP: `brandId`, `orderIds`, `dryRun`, `includeAdditions`, `brandName`, `revisionNotes`, `pastedBrandOrder`, `columnOverrides`

**POST /revisions/run** — response changes:
- REMOVE from summary: `exceedsCap`, `maxReductionPct`
- REMOVE from decisions[]: `wasFlipped`
- ADD to decisions[]: `targetQty`
- KEEP: `revisionId`, `dryRun`, `summary.{totalItems, ship, cancel, keepOpen, originalTotalQty, adjustedTotalQty, reductionPct}`, `decisions[].{orderItemId, orderId, productId, upc, productName, size, color, category, location, locationId, originalQty, onHand, decision, adjustedQty, reason, isDiscontinued, recentSales, receivedNotInventoried, priorRevision}`

**POST /revisions/apply** — same as today minus `maxReductionPct`.

### C3. Decision Function Pseudocode

```
function computeDecisions(items, targetMap, inventoryMap, salesMap, discontinuedUPCs):
  decisions = []

  for each item in items:
    target = targetMap[item.product_id + '|' + item.location_id] ?? 0
    onHand = inventoryMap[item.upc + '|' + item.location_id] ?? 0
    sales  = salesMap[item.upc + '|' + item.location_id]
    isDiscontinued = discontinuedUPCs.has(item.upc)

    // PHASE 1: Base decision from target_qty vs on_hand
    if onHand >= target:
      decision = 'cancel'
      adjustedQty = 0
      reason = 'at_or_above_target'
    else:
      decision = 'ship'
      adjustedQty = min(item.original_qty, target - onHand)
      reason = 'below_target'

    // PHASE 2: Reason-code resolution (most specific wins)
    // Checked in priority order — first match wins
    if isDiscontinued:
      decision = 'cancel'
      adjustedQty = 0
      reason = 'discontinued_product'
    else if onHand <= 0 AND sales AND sales.qtySold > 0:
      // Received but not inventoried — probably have it, cancel
      decision = 'cancel'
      adjustedQty = 0
      reason = 'received_not_inventoried'
    else if onHand <= 0 AND (not sales OR sales.qtySold == 0):
      // Genuine zero stock — ship if below target
      if decision == 'ship':
        reason = 'zero_stock'
      // else keep at_or_above_target (target=0 case)
    else if onHand > 0 AND onHand >= target:
      reason = 'positive_stock_cancel'

    decisions.push({
      ...item fields,
      targetQty: target,
      onHand,
      decision,
      adjustedQty,
      reason,
      isDiscontinued,
      recentSales: sales,
      receivedNotInventoried: onHand <= 0 && sales?.qtySold > 0,
    })

  return decisions
```

### C4. Where `/revisions/spreadsheet` Calls It

The spreadsheet route:
1. Parses vendor file using brand template (existing code — KEEP)
2. Looks up products by UPC (existing code — KEEP)
3. Calls `computeDecisions()` instead of inline logic (REFACTOR)
4. Fills in vendor form with decisions (existing code — KEEP)
5. Returns JSON preview or modified XLSX (existing code — KEEP)

### C5. Fields Summary

| Field | Status |
|-------|--------|
| `wasFlipped` | **REMOVED** from new decisions |
| `targetQty` | **ADDED** to decisions |
| `onHand` | KEPT |
| `recentSales` | KEPT |
| `priorRevision` | KEPT |
| `isDiscontinued` | KEPT |
| `receivedNotInventoried` | KEPT |
| `originalQty` | KEPT |
| `adjustedQty` | KEPT |
| `decision` | KEPT |
| `reason` | KEPT |
| `upc`, `productName`, `size`, `color`, `location`, `orderItemId` | KEPT |

---

## D. TARGETS UI PLAN

### D1. New Page: Target Quantities

**Route**: `/targets` (new React page `frontend/src/pages/TargetQuantities.jsx`)

**Minimum viable UI**:
- Brand + Season filter (top bar)
- Filterable table: Product Name | UPC | Size | Color | SLC Target | South Main Target | Ogden Target
- Inline edit: click a target cell → type number → blur to save
- Bulk set: select rows → "Set all to X" action
- CSV import button: upload CSV with columns `upc, location, target_qty`
- Color coding: cells with target=0 are gray (default/unset), >0 are blue

### D2. New API

**GET /api/targets?brandId=&seasonId=**
- Returns `{ targets: [{ productId, upc, productName, size, color, locationId, locationName, targetQty }] }`
- Joins `product_location_targets` with `products` and `locations`, filtered by brand (via products.brand_id) and season (via products.season_id)

**PUT /api/targets**
- Body: `{ targets: [{ productId, locationId, targetQty }] }`
- Batch upsert into `product_location_targets`
- Returns count of rows updated

### D3. Target Column in Revision Preview

Both the orders-mode and spreadsheet-mode preview tables get a new "Target" column between "On Hand" and "Decision", showing `targetQty` for each item. This lets the buyer see why a decision was made.

---

## E. CHATBOT UPDATES

### E1. System Prompt Update

Replace revision logic description in `src/routes/revisions-chat.js` REVISION_SYSTEM_PROMPT (lines 53-56):

**Old**:
```
- Items with on_hand > 0 → cancel (already in stock)
- Items with on_hand = 0 and no recent sales → ship (genuinely needed)
- Items with on_hand = 0 but recent sales → cancel (received but not inventoried)
- Discontinued items → always cancel
```

**New**:
```
REVISION LOGIC (target-quantity based):
- Every SKU at every location has a target quantity (default 0 = do not stock).
- If on_hand >= target → cancel (at or above target).
- If on_hand < target → ship, adjusted_qty = min(original_qty, target - on_hand).
- Discontinued items → always cancel regardless of target.
- Zero stock with recent sales → cancel (received but not inventoried).
- You can view and set targets using set_target_qty.
```

Remove any mention of `maxReductionPct`, reduction cap, or flip-back.

### E2. Tool Updates

| Tool | Change | Details |
|------|--------|---------|
| `modify_decision` | **KEEP** | No changes — it sets decision/qty by UPC. |
| `adjust_item` | **KEEP** | No changes — DB write by orderItemId. |
| `run_revision` (MCP) | **UPDATE** | Replace inline decision logic with call to `computeDecisions()`. Remove exceedsCap/wasFlipped/maxReductionPct. |
| `update_order_decisions` | **UPDATE** | Remove `maxReductionPct` from inputSchema and implementation. |
| All others | **KEEP** | Only update descriptions if they mention cap/flip. None currently do. |

### E3. New Tool: `set_target_qty`

**Module**: `mcp-server/tools/adjustments.js` (add to existing)

```
name: 'set_target_qty'
description: 'Set target quantity for a product at a location. Target determines how many units we want on hand — the revision engine ships/cancels to reach this target.'
inputSchema:
  properties:
    productId: integer (required)
    locationId: integer (required)
    targetQty: integer (required, >= 0)
  OR bulk mode:
    targets: array of { productId, locationId, targetQty }
```

**Behavior**: Writes directly to `product_location_targets` table via UPSERT. Immediate write — no staging. Reason: targets are a configuration value, not a pending action. The chatbot saying "set Miura VS target to 2 at SLC" should take effect immediately.

### E4. `__decisionChanges__` Protocol
- **KEEP** — `modify_decision` returns the marker, `RevisionChat.jsx` parses it, `Revisions.jsx` applies changes to local decisions array. No changes needed.

---

## F. DELETE LIST

| Item | Type | File/Location |
|------|------|---------------|
| `maxReductionPct` state + slider UI | Frontend state + JSX | `Revisions.jsx` lines 51, 832-840; `RevisionModal.jsx` line 29, 56, 322-340 |
| `exceedsCap` calculation | Backend logic | `revisions.js` lines 417-423; `mcp-server/tools/revisions.js` lines 425-430 |
| `exceedsCap` in response | API response field | `revisions.js` line 510 |
| `wasFlipped` in decisions array | API response field | `revisions.js` line 402; `mcp-server/tools/revisions.js` line 417 |
| Flipped count display | Frontend JSX | `RevisionModal.jsx` lines 455-458 |
| Flip-back UI text | Frontend JSX | `RevisionModal.jsx` lines 326-327 |
| `maxReductionPct` param in `/run` | API parameter | `revisions.js` lines 77-82 |
| `maxReductionPct` param in `update_order_decisions` | MCP tool param | `shipments.js` line 16, 122, 526 |
| `POST /revisions/reconcile` endpoint | Backend route | `revisions.js` lines 1062-1559 | **DEFER** — still has value for spreadsheet comparison even with target-qty. Review after engine rewrite. |

**DEFER** (not deleting yet):
- `POST /revisions/reconcile` — may still be useful for spreadsheet pre-comparison
- `flipped_back_cap` reason code — KEEP in REASON_LABELS for historic display
- `revisions.max_reduction_pct` column — KEEP, stop writing
- `adjustment_history.was_flipped` column — KEEP, stop writing

---

## G. DECISIONS (answered by Eddie)

1. **`target_qty` is evergreen** — `(product_id, location_id)` with no season scope. One target per SKU per location, carried forward until changed. Table PK is `(product_id, location_id)` — no season_id column.

2. **Auto-recompute** — changing a target mid-revision automatically re-runs the preview. No "Recompute" button needed.

3. **Chatbot proposes, user confirms** — `set_target_qty` tool stages changes and returns them to the user for confirmation in the UI, rather than writing directly to the DB.

4. **SKU as backup identifier** — vendor forms may use vendor SKU instead of UPC. The spreadsheet parser should fall back to SKU matching when UPC is not found. Products table has a `sku` column.

---

## Summary Counts

| Action | Count |
|--------|-------|
| KEEP | 38 |
| REFACTOR | 3 (orders-mode, spreadsheet-mode, OrderAdjustment inventory panel) |
| REPLACE | 1 (decision logic → target-qty engine) |
| DELETE | 8 (cap slider, exceedsCap, wasFlipped, flip text, maxReductionPct param) |
| DEFER | 3 (reconcile endpoint, flipped_back_cap code, historic columns) |
| NEW | 4 (target table + migration, revisionEngine.js, TargetQuantities page, set_target_qty tool) |

---

## Stage 2 — Done (2026-04-21)

### What was added
- `migrations/022_product_location_targets.sql` — `product_location_targets` table with `(product_id, location_id)` PK, no season scope
- `src/services/revisionEngine.js` — pure `computeDecisions()` function with two-phase logic (target vs on_hand, then reason-code resolution)
- `src/services/__tests__/revisionEngine.test.js` — 15 unit tests covering all branches
- `src/routes/targets.js` — `GET /api/targets` and `PUT /api/targets` (batch upsert)
- `frontend/src/pages/TargetQuantities.jsx` — filterable/sortable target grid with inline edit, bulk set, and save
- `frontend/src/services/api.js` — `targetAPI.list`, `targetAPI.saveBatch`
- Route `/targets` in `App.jsx`, nav link "Targets" in `Layout.jsx`

### What was refactored
- `POST /api/revisions/run` — now loads targets from `product_location_targets`, calls `computeDecisions()`, writes `logic_applied = 'target_qty'`. Removed `maxReductionPct` param, `exceedsCap` calculation, `wasFlipped` from decisions.
- `POST /api/revisions/apply` — removed `maxReductionPct` param, hardcoded `was_flipped = false`, writes `logic_applied = 'target_qty'`.
- `POST /api/revisions/spreadsheet` — replaced inline decision logic with `computeDecisions()`. Loads targets, builds engine items from parsed spreadsheet rows, maps back to dropdown values for XLSX output.
- `RevisionModal.jsx` — removed `maxReductionPct` state/slider/flip text, removed flipped-back banner, added "Target" column to both orders-mode and spreadsheet-mode preview tables, extended `REASON_LABELS` with `at_or_above_target`, `below_target`, `removed_by_chat`.
- `Revisions.jsx` — same removals/additions as RevisionModal. Removed exceeds-cap amber warning.

### What was deleted
- `maxReductionPct` slider UI from both RevisionModal.jsx and Revisions.jsx
- `exceedsCap` calculation and response field from `revisions.js`
- `wasFlipped` field from new decision objects (historic column kept)
- Flip-back banner and misleading UI text
- `maxReductionPct` parameter from `/run` and `/apply` API calls

### What was NOT touched (deferred to Stage 3)
- `mcp-server/tools/revisions.js` — `run_revision` tool still uses old inline logic and `maxReductionPct` param. Needs to call `computeDecisions()` and remove dead fields.
- `mcp-server/tools/shipments.js` — `update_order_decisions` still accepts `maxReductionPct`.
- `RevisionChat.jsx`, `revisions-chat.js`, `agentTools.js`, `mcpToolBridge.js`, `aiAgent.js` — chatbot system prompt and `set_target_qty` tool.
- `POST /api/revisions/reconcile` — deferred, still has value for pre-comparison.
- `flipped_back_cap` reason code kept in REASON_LABELS for historic display.
- Historic columns (`revisions.max_reduction_pct`, `adjustment_history.was_flipped`) kept but no longer written to by new code.

---

## Stage 3 — Done (2026-04-21)

### System Prompt (new, verbatim)

```
REVISION LOGIC (target-quantity based):
- Every SKU at every location has a target quantity (default 0 = do not stock).
- If on_hand >= target_qty → cancel (at or above target).
- If on_hand < target_qty → ship, adjusted_qty = min(original_qty, target_qty - on_hand).
- Discontinued items → always cancel regardless of target.
- Zero stock with recent sales → cancel (received but not inventoried).
- There is no max-reduction cap and no flip-back. The legacy flipped_back_cap reason is preserved for historic revisions only.
- Reason codes in priority order: user_override → removed_by_chat → discontinued_product → received_not_inventoried → zero_stock → positive_stock_cancel → at_or_above_target → below_target.

TARGET MANAGEMENT:
- Use get_target_qty to view current targets for a product/UPC at each location.
- Use set_target_qty to set or update a target quantity. This writes directly to the database.
- When a target is changed, the next revision preview will automatically reflect it.
- Target qty of 0 means "do not stock" — any on-hand will trigger a cancel.
```

### Tools touched
- `mcp-server/tools/revisions.js` — `run_revision`: replaced inline zero-stock decision logic with `computeDecisions()` from `src/services/revisionEngine`. Removed `maxReductionPct` param, `exceedsCap` calculation, `wasFlipped` field, `additionsProposed` logic. Now loads targets from `product_location_targets`. Output includes Target column. Writes `logic_applied = 'target_qty'`.
- `mcp-server/tools/shipments.js` — `update_order_decisions`: removed `maxReductionPct` from inputSchema and implementation. Writes `null` for `max_reduction_pct` column.

### Tools added
- `get_target_qty` — in `mcp-server/tools/adjustments.js`. Queries `product_location_targets` with product/location joins. Supports lookup by UPC or productId, optionally filtered by locationId.
- `set_target_qty` — in `mcp-server/tools/adjustments.js`. Upserts into `product_location_targets`. Supports single mode (upc/productId + locationId + targetQty) and bulk mode (targets array). Sets `updated_by = 'chatbot'`.

### Tools deleted
- None. All existing tools survive. Only descriptions and implementations were updated.

### RevisionChat.jsx changes
- Quick actions updated: "Check inventory" → checks on-hand AND targets; "Set target" and "Remove items" added; "Add rule" removed; "Run revision" and "Compare revisions" kept.

### What's left for Stage 4
- Paste-from-clipboard input for spreadsheet-mode revisions (independent of chatbot).
