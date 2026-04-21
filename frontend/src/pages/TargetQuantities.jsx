import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import Layout from '../components/Layout';

const TargetQuantities = () => {
  const [brands, setBrands] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [dirty, setDirty] = useState(new Map()); // Map of "productId|locationId" -> targetQty

  useEffect(() => {
    (async () => {
      try {
        const [brandsRes, seasonsRes] = await Promise.all([
          api.get('/brands'),
          api.get('/seasons'),
        ]);
        setBrands(brandsRes.data.brands || []);
        const sorted = (seasonsRes.data.seasons || []).sort((a, b) => {
          const da = a.start_date ? new Date(a.start_date) : new Date(0);
          const db = b.start_date ? new Date(b.start_date) : new Date(0);
          return db - da;
        });
        setSeasons(sorted);
        if (sorted.length > 0) setSelectedSeasonId(sorted[0].id.toString());
      } catch (e) {
        console.error('Failed to load data:', e);
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedBrandId) fetchTargets();
  }, [selectedBrandId, selectedSeasonId]);

  const fetchTargets = async () => {
    setLoading(true);
    setError('');
    setDirty(new Map());
    try {
      const params = { brandId: selectedBrandId };
      if (selectedSeasonId) params.seasonId = selectedSeasonId;
      const res = await api.get('/targets', { params });
      setTargets(res.data.targets || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load targets');
    } finally {
      setLoading(false);
    }
  };

  const handleTargetChange = (productId, locationId, value) => {
    const key = `${productId}|${locationId}`;
    const qty = parseInt(value) || 0;
    setDirty(prev => new Map(prev).set(key, qty));
  };

  const getTargetValue = (row) => {
    const key = `${row.product_id}|${row.location_id}`;
    if (dirty.has(key)) return dirty.get(key);
    return row.target_qty;
  };

  const handleSave = async () => {
    if (dirty.size === 0) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const targetsToSave = [];
      for (const [key, qty] of dirty) {
        const [productId, locationId] = key.split('|').map(Number);
        targetsToSave.push({ productId, locationId, targetQty: qty });
      }
      const res = await api.put('/targets', { targets: targetsToSave });
      setSuccess(`Saved ${res.data.updated} target${res.data.updated !== 1 ? 's' : ''}`);
      setDirty(new Map());
      // Refresh data
      await fetchTargets();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save targets');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSet = (value) => {
    const qty = parseInt(value);
    if (isNaN(qty) || qty < 0) return;
    const newDirty = new Map(dirty);
    for (const row of filteredRows) {
      newDirty.set(`${row.product_id}|${row.location_id}`, qty);
    }
    setDirty(newDirty);
  };

  // Group by product, pivot locations into columns
  const locations = useMemo(() => {
    const locs = new Map();
    for (const t of targets) {
      if (!locs.has(t.location_id)) {
        locs.set(t.location_id, t.location_name);
      }
    }
    return [...locs.entries()].sort((a, b) => a[0] - b[0]);
  }, [targets]);

  const productRows = useMemo(() => {
    const map = new Map();
    for (const t of targets) {
      if (!map.has(t.product_id)) {
        map.set(t.product_id, {
          product_id: t.product_id,
          upc: t.upc,
          product_name: t.product_name,
          size: t.size,
          color: t.color,
          category: t.category,
          locations: {},
        });
      }
      map.get(t.product_id).locations[t.location_id] = t;
    }
    return [...map.values()];
  }, [targets]);

  const filteredRows = useMemo(() => {
    return productRows.filter(p => {
      if (searchFilter) {
        const s = searchFilter.toLowerCase();
        if (!(p.product_name || '').toLowerCase().includes(s) &&
            !(p.upc || '').includes(s) &&
            !(p.size || '').toLowerCase().includes(s) &&
            !(p.color || '').toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [productRows, searchFilter]);

  // For the flat list used in bulk set and save
  const filteredFlatRows = useMemo(() => {
    const rows = [];
    for (const p of filteredRows) {
      for (const [locId] of locations) {
        const t = p.locations[locId];
        if (t) rows.push(t);
      }
    }
    return rows;
  }, [filteredRows, locations]);

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Target Quantities</h1>
          {dirty.size > 0 && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
            >
              {saving ? 'Saving...' : `Save ${dirty.size} Change${dirty.size !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Brand</label>
            <select
              value={selectedBrandId}
              onChange={e => setSelectedBrandId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">Select Brand</option>
              {brands.filter(b => b.active !== false).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Season</label>
            <select
              value={selectedSeasonId}
              onChange={e => setSelectedSeasonId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">All Seasons</option>
              {seasons.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              type="text"
              placeholder="Product name, UPC, size, color..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Set All Visible To</label>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map(n => (
                <button
                  key={n}
                  onClick={() => handleBulkSet(n)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3">
            <p className="text-sm text-green-800">{success}</p>
          </div>
        )}

        {!selectedBrandId ? (
          <div className="text-center py-16 text-gray-400">Select a brand to manage targets</div>
        ) : loading ? (
          <div className="text-center py-16 text-gray-400">Loading...</div>
        ) : filteredRows.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No products found</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">UPC</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Size</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Color</th>
                    {locations.map(([locId, locName]) => (
                      <th key={locId} className="text-center px-3 py-2 text-xs font-medium text-gray-500">
                        {locName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(p => (
                    <tr key={p.product_id} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium truncate max-w-[200px]">{p.product_name}</td>
                      <td className="px-3 py-2 text-xs font-mono text-gray-500">{p.upc}</td>
                      <td className="px-3 py-2">{p.size || '-'}</td>
                      <td className="px-3 py-2 text-xs">{p.color || '-'}</td>
                      {locations.map(([locId]) => {
                        const t = p.locations[locId];
                        if (!t) return <td key={locId} className="px-3 py-2 text-center text-gray-300">-</td>;
                        const val = getTargetValue(t);
                        const isDirty = dirty.has(`${t.product_id}|${t.location_id}`);
                        return (
                          <td key={locId} className="px-3 py-1 text-center">
                            <input
                              type="number"
                              min="0"
                              value={val}
                              onChange={e => handleTargetChange(t.product_id, t.location_id, e.target.value)}
                              className={`w-16 text-center px-1 py-1 border rounded text-sm ${
                                isDirty ? 'border-blue-400 bg-blue-50' :
                                val === 0 ? 'border-gray-200 bg-gray-50 text-gray-400' :
                                'border-gray-300 bg-white text-blue-700 font-medium'
                              }`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t flex justify-between">
              <span>{filteredRows.length} product{filteredRows.length !== 1 ? 's' : ''} x {locations.length} location{locations.length !== 1 ? 's' : ''}</span>
              {dirty.size > 0 && <span className="text-blue-600 font-medium">{dirty.size} unsaved change{dirty.size !== 1 ? 's' : ''}</span>}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default TargetQuantities;
