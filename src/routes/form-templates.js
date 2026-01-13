const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Get all form templates (all authenticated users)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ft.*,
        b.name as brand_name,
        (SELECT COUNT(*) FROM form_template_quantity_columns WHERE template_id = ft.id) as quantity_column_count
      FROM brand_form_templates ft
      LEFT JOIN brands b ON ft.brand_id = b.id
      ORDER BY b.name ASC, ft.name ASC
    `);
    res.json({ templates: result.rows });
  } catch (error) {
    console.error('Get form templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get templates for a specific brand
router.get('/brand/:brandId', authenticateToken, async (req, res) => {
  try {
    const { brandId } = req.params;
    const result = await pool.query(`
      SELECT
        ft.*,
        b.name as brand_name,
        (SELECT COUNT(*) FROM form_template_quantity_columns WHERE template_id = ft.id) as quantity_column_count
      FROM brand_form_templates ft
      LEFT JOIN brands b ON ft.brand_id = b.id
      WHERE ft.brand_id = $1
      ORDER BY ft.name ASC
    `, [brandId]);

    res.json({ templates: result.rows });
  } catch (error) {
    console.error('Get brand form templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a single template by ID with quantity columns
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get template
    const templateResult = await pool.query(`
      SELECT
        ft.*,
        b.name as brand_name
      FROM brand_form_templates ft
      LEFT JOIN brands b ON ft.brand_id = b.id
      WHERE ft.id = $1
    `, [id]);

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Get quantity columns
    const columnsResult = await pool.query(`
      SELECT * FROM form_template_quantity_columns
      WHERE template_id = $1
      ORDER BY column_order ASC, column_letter ASC
    `, [id]);

    res.json({
      template: templateResult.rows[0],
      quantityColumns: columnsResult.rows
    });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new form template (Admin and Buyer)
router.post('/', authenticateToken, authorizeRoles(['admin', 'buyer']), async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      brand_id,
      name,
      sheet_name,
      header_row,
      data_start_row,
      product_id_column,
      product_id_type,
      location_column,
      quantity_columns
    } = req.body;

    // Validate required fields
    if (!brand_id || !name || !product_id_column || !product_id_type) {
      return res.status(400).json({
        error: 'Missing required fields: brand_id, name, product_id_column, product_id_type'
      });
    }

    // Validate product_id_type
    if (!['upc', 'ean', 'sku'].includes(product_id_type)) {
      return res.status(400).json({
        error: 'product_id_type must be one of: upc, ean, sku'
      });
    }

    await client.query('BEGIN');

    // Insert template
    const templateResult = await client.query(`
      INSERT INTO brand_form_templates (
        brand_id, name, sheet_name, header_row, data_start_row,
        product_id_column, product_id_type, location_column
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      brand_id,
      name,
      sheet_name || null,
      header_row !== undefined ? header_row : 0,
      data_start_row !== undefined ? data_start_row : 1,
      product_id_column,
      product_id_type,
      location_column || null
    ]);

    const templateId = templateResult.rows[0].id;

    // Insert quantity columns if provided
    const insertedColumns = [];
    if (quantity_columns && Array.isArray(quantity_columns)) {
      for (let i = 0; i < quantity_columns.length; i++) {
        const col = quantity_columns[i];
        const colResult = await client.query(`
          INSERT INTO form_template_quantity_columns (
            template_id, column_letter, column_name, ship_date,
            ship_date_column, is_editable, column_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [
          templateId,
          col.column_letter,
          col.column_name || null,
          col.ship_date || null,
          col.ship_date_column || null,
          col.is_editable !== undefined ? col.is_editable : true,
          col.column_order !== undefined ? col.column_order : i
        ]);
        insertedColumns.push(colResult.rows[0]);
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Template created successfully',
      template: templateResult.rows[0],
      quantityColumns: insertedColumns
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update a template (Admin and Buyer)
router.patch('/:id', authenticateToken, authorizeRoles(['admin', 'buyer']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      name,
      sheet_name,
      header_row,
      data_start_row,
      product_id_column,
      product_id_type,
      location_column,
      quantity_columns
    } = req.body;

    // Check if template exists
    const existsResult = await client.query(
      'SELECT * FROM brand_form_templates WHERE id = $1',
      [id]
    );

    if (existsResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await client.query('BEGIN');

    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount++}`);
      updateValues.push(name);
    }
    if (sheet_name !== undefined) {
      updateFields.push(`sheet_name = $${paramCount++}`);
      updateValues.push(sheet_name);
    }
    if (header_row !== undefined) {
      updateFields.push(`header_row = $${paramCount++}`);
      updateValues.push(header_row);
    }
    if (data_start_row !== undefined) {
      updateFields.push(`data_start_row = $${paramCount++}`);
      updateValues.push(data_start_row);
    }
    if (product_id_column !== undefined) {
      updateFields.push(`product_id_column = $${paramCount++}`);
      updateValues.push(product_id_column);
    }
    if (product_id_type !== undefined) {
      if (!['upc', 'ean', 'sku'].includes(product_id_type)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'product_id_type must be one of: upc, ean, sku'
        });
      }
      updateFields.push(`product_id_type = $${paramCount++}`);
      updateValues.push(product_id_type);
    }
    if (location_column !== undefined) {
      updateFields.push(`location_column = $${paramCount++}`);
      updateValues.push(location_column);
    }

    // Always update updated_at
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(id);

    if (updateFields.length > 1) {  // More than just updated_at
      const updateQuery = `
        UPDATE brand_form_templates
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `;
      var templateResult = await client.query(updateQuery, updateValues);
    } else {
      var templateResult = existsResult;
    }

    // Update quantity columns if provided
    let columnsResult = null;
    if (quantity_columns !== undefined && Array.isArray(quantity_columns)) {
      // Delete existing columns
      await client.query(
        'DELETE FROM form_template_quantity_columns WHERE template_id = $1',
        [id]
      );

      // Insert new columns
      const insertedColumns = [];
      for (let i = 0; i < quantity_columns.length; i++) {
        const col = quantity_columns[i];
        const colResult = await client.query(`
          INSERT INTO form_template_quantity_columns (
            template_id, column_letter, column_name, ship_date,
            ship_date_column, is_editable, column_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [
          id,
          col.column_letter,
          col.column_name || null,
          col.ship_date || null,
          col.ship_date_column || null,
          col.is_editable !== undefined ? col.is_editable : true,
          col.column_order !== undefined ? col.column_order : i
        ]);
        insertedColumns.push(colResult.rows[0]);
      }
      columnsResult = insertedColumns;
    } else {
      // Get existing columns
      const colsQuery = await client.query(
        'SELECT * FROM form_template_quantity_columns WHERE template_id = $1 ORDER BY column_order ASC',
        [id]
      );
      columnsResult = colsQuery.rows;
    }

    await client.query('COMMIT');

    res.json({
      message: 'Template updated successfully',
      template: templateResult.rows[0],
      quantityColumns: columnsResult
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete a template (Admin and Buyer)
router.delete('/:id', authenticateToken, authorizeRoles(['admin', 'buyer']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if template exists
    const existsResult = await pool.query(
      'SELECT * FROM brand_form_templates WHERE id = $1',
      [id]
    );

    if (existsResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Check if template has associated imported forms
    const hasFormsResult = await pool.query(
      'SELECT COUNT(*) FROM imported_forms WHERE template_id = $1',
      [id]
    );

    if (parseInt(hasFormsResult.rows[0].count) > 0) {
      return res.status(409).json({
        error: 'Cannot delete template with associated imported forms',
        formCount: parseInt(hasFormsResult.rows[0].count)
      });
    }

    // Delete template (cascade will delete quantity columns)
    await pool.query('DELETE FROM brand_form_templates WHERE id = $1', [id]);

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
