import React, { useState, useEffect } from 'react';
import { useStock } from '../../context/StockContext';

export default function LocationStock() {
  const { data, updateLocationStock, updateLocationConfig, updateLocationAssignedItems, bulkImportProducts, setLocationStock, updateMealTypeConfig } = useStock();
  const [selectedLocation, setSelectedLocation] = useState('');
  // Which collapsed meal-type groups are expanded to show member flavours.
  const [expandedGroups, setExpandedGroups] = useState({});

  // Update selected location when locations load or change
  useEffect(() => {
    if (data.locations.length > 0 && !selectedLocation) {
      setSelectedLocation(data.locations[0].id);
    }
  }, [data.locations, selectedLocation]);
  const [showConfig, setShowConfig] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);

  // Stock upload states
  const [showStockUpload, setShowStockUpload] = useState(false);
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [extractedStockItems, setExtractedStockItems] = useState([]);
  const [productsToCreate, setProductsToCreate] = useState([]);
  const [uploadImages, setUploadImages] = useState([]);
  const [reviewMode, setReviewMode] = useState(false);

  const location = data.locations.find(l => l.id === selectedLocation);
  const locStock = data.locationStock[selectedLocation] || {};
  const locConfig = data.locationConfig[selectedLocation] || {};

  const getProductsForLocation = () => {
    if (!location) return [];
    if (location.assignedItems?.length > 0) {
      return data.products.filter(p => location.assignedItems.includes(p.sku));
    }
    return data.products;
  };

  const getUnassignedProducts = () => {
    if (!location) return [];
    const assigned = location.assignedItems || [];
    return data.products.filter(p => !assigned.includes(p.sku));
  };

  const addProductToLocation = async (sku) => {
    if (!location) return;
    const currentAssigned = location.assignedItems || [];
    const newAssigned = [...currentAssigned, sku];
    await updateLocationAssignedItems(selectedLocation, newAssigned);
  };

  const removeProductFromLocation = async (sku) => {
    if (!location) return;
    const currentAssigned = location.assignedItems || [];
    const newAssigned = currentAssigned.filter(s => s !== sku);
    await updateLocationAssignedItems(selectedLocation, newAssigned);
  };

  const updateStock = async (sku, value) => {
    const newVal = Math.max(0, parseInt(value) || 0);
    await updateLocationStock(selectedLocation, sku, newVal);
  };

  const adjustStock = async (sku, delta) => {
    const current = locStock[sku] || 0;
    await updateStock(sku, current + delta);
  };

  const handleUpdateConfig = async (sku, field, value) => {
    const currentConfig = locConfig[sku] || {};
    const newConfig = {
      ...currentConfig,
      [field]: parseInt(value) || 0
    };
    await updateLocationConfig(selectedLocation, sku, newConfig);
  };

  // Shared status thresholds so per-SKU rows and collapsed meal groups agree.
  const computeStatus = (qty, min = 0, max = 0) => {
    if (max > 0 && qty >= max) return { status: 'full', color: 'green' };
    if (min > 0 && qty <= min) return { status: 'low', color: 'red' };
    if (min > 0 && qty <= min * 1.5) return { status: 'warning', color: 'yellow' };
    return { status: 'ok', color: 'zinc' };
  };

  const getStockStatus = (sku, qty) => {
    const config = locConfig[sku] || {};
    return computeStatus(qty, config.minStock || 0, config.maxStock || 0);
  };

  const getGroupStockStatus = (qty, config = {}) =>
    computeStatus(qty, config.minStock || 0, config.maxStock || 0);

  // Update group capacity (min/max) for a meal-type bucket at this location.
  const handleUpdateMealConfig = async (mealType, field, value) => {
    const current = (data.locationMealConfig[selectedLocation] || {})[mealType] || {};
    await updateMealTypeConfig(selectedLocation, mealType, {
      ...current,
      [field]: parseInt(value) || 0,
    });
  };

  // AI-powered stock screenshot analysis
  const analyzeStockScreenshotWithAI = async (imageData, mimeType) => {
    const existingProducts = data.products.map(p => `- ${p.name} (SKU: ${p.sku}, Category: ${p.category || 'Unknown'})`).join('\n');
    const mealTypeNames = (data.mealTypes || []).map(m => m.name);
    const mealTypeList = mealTypeNames.length > 0 ? mealTypeNames.join(', ') : 'Meat, Veg/Vegan';

    const prompt = `Analyze this stock management screenshot and extract all product information.

EXISTING PRODUCTS IN SYSTEM:
${existingProducts || 'No existing products'}

FRESH MEAL TYPES (buckets for Frive fresh meals): ${mealTypeList}

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "items": [
    {
      "name": "full product name as shown",
      "nameClean": "cleaned/normalized product name for matching",
      "category": "one of: Meals, Drinks, Snacks, Breakfast, Other",
      "stockCount": 0,
      "price": 0.00,
      "matchedSku": "SKU if it matches an existing product, otherwise null",
      "isFreshMeal": false,
      "mealType": "one of the FRESH MEAL TYPES above if this is a fresh meal, otherwise null",
      "confidence": "high/medium/low"
    }
  ],
  "totalItemsFound": 0,
  "categories": ["list of unique categories found"]
}

MATCHING RULES:
1. Match products by comparing names - look for brand names like "Barebells", "Fiesty", "Marna", "Parsley Box", "Fiid", "MOMA", "Misfits", "Peperami", "Jack Links", etc.
2. Include variant info in the name (e.g., "Barebells Milkshake - Chocolate", "MOMA Porridge Pot - Berry")
3. Stock count is shown as "Stock: X" - extract the number X
4. Price is shown as £X.XX
5. Categories are shown as section headers (Drinks, Meals, Breakfast, Snacks)
6. If a product closely matches an existing one, use its SKU in matchedSku
7. Be thorough - extract EVERY visible product row
8. Fresh meals are Frive ready-meals (curries, pasta, lasagne, risotto, stews, etc.). Set isFreshMeal=true and pick the best mealType bucket from the list above (meat dishes → Meat; vegan/vegetarian/plant-based → Veg/Vegan). For ordinary snacks/drinks set isFreshMeal=false and mealType=null.

Example parsing:
- "Barebells Milkshake -..." with "Stock: 10" and "£3.25" → name: "Barebells Milkshake", stockCount: 10, price: 3.25
- Look for truncated names and expand them logically based on context`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: imageData.split(',')[1]
                }
              },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      const result = await response.json();
      const textContent = result.content?.find(c => c.type === 'text')?.text || '';

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Could not parse AI response');
    } catch (error) {
      console.error('AI analysis error:', error);
      throw error;
    }
  };

  // Find best matching product from existing products
  const findBestProductMatch = (itemName, itemCategory) => {
    const normalizedName = itemName.toLowerCase().trim();

    // Try exact match first
    let match = data.products.find(p =>
      p.name.toLowerCase() === normalizedName
    );
    if (match) return { match, confidence: 'exact' };

    // Try contains match
    match = data.products.find(p =>
      p.name.toLowerCase().includes(normalizedName) ||
      normalizedName.includes(p.name.toLowerCase())
    );
    if (match) return { match, confidence: 'high' };

    // Try word-based matching
    const itemWords = normalizedName.split(/[\s\-]+/).filter(w => w.length > 2);
    let bestMatch = null;
    let bestScore = 0;

    for (const product of data.products) {
      const productWords = product.name.toLowerCase().split(/[\s\-]+/).filter(w => w.length > 2);
      const matchingWords = itemWords.filter(w =>
        productWords.some(pw => pw.includes(w) || w.includes(pw))
      );
      const score = matchingWords.length / Math.max(itemWords.length, productWords.length);

      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = product;
      }
    }

    if (bestMatch) {
      return { match: bestMatch, confidence: bestScore >= 0.7 ? 'high' : 'medium' };
    }

    return { match: null, confidence: 'none' };
  };

  // Handle stock screenshot upload
  const handleStockUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadProcessing(true);
    setShowStockUpload(true);
    setUploadError(null);
    setExtractedStockItems([]);
    setProductsToCreate([]);

    const imageDataList = [];

    // Read all files
    for (const file of files) {
      const imageData = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve({ data: ev.target?.result, type: file.type || 'image/png' });
        reader.readAsDataURL(file);
      });
      imageDataList.push(imageData);
    }

    setUploadImages(imageDataList);

    try {
      // Process each image
      const allItems = [];

      for (const img of imageDataList) {
        const analyzed = await analyzeStockScreenshotWithAI(img.data, img.type);
        if (analyzed.items) {
          allItems.push(...analyzed.items);
        }
      }

      // Process and deduplicate items
      const processedItems = [];
      const newProducts = [];
      const seenNames = new Set();

      for (const item of allItems) {
        // Skip duplicates
        const normalizedName = (item.nameClean || item.name).toLowerCase().trim();
        if (seenNames.has(normalizedName)) continue;
        seenNames.add(normalizedName);

        // Try to match to existing product
        let matchResult = { match: null, confidence: 'none' };

        if (item.matchedSku) {
          const existingProduct = data.products.find(p => p.sku === item.matchedSku);
          if (existingProduct) {
            matchResult = { match: existingProduct, confidence: 'high' };
          }
        }

        if (!matchResult.match) {
          matchResult = findBestProductMatch(item.name, item.category);
        }

        if (matchResult.match) {
          processedItems.push({
            ...item,
            matchedSku: matchResult.match.sku,
            matchedName: matchResult.match.name,
            isNew: false,
            matchConfidence: matchResult.confidence,
            selected: true,
            stockCount: item.stockCount || 0
          });
        } else {
          // Generate SKU for new product
          const categoryPrefix = (item.category || 'OTHER').substring(0, 3).toUpperCase();
          const generatedSku = `${categoryPrefix}-${Date.now().toString().slice(-4)}-${processedItems.length + newProducts.length + 1}`;

          processedItems.push({
            ...item,
            sku: generatedSku,
            isNew: true,
            selected: true,
            matchConfidence: 'new',
            stockCount: item.stockCount || 0
          });

          newProducts.push({
            sku: generatedSku,
            name: item.name,
            category: item.category || 'Other',
            unitCost: item.price || 0,
            salePrice: item.price || 0,
            // AI guess — lands unconfirmed for review in Admin → Fresh Meals
            isFreshMeal: !!item.isFreshMeal,
            mealType: item.mealType || null,
            mealTypeConfirmed: false,
          });
        }
      }

      setExtractedStockItems(processedItems);
      setProductsToCreate(newProducts);
      setReviewMode(true);
      setUploadProcessing(false);

    } catch (error) {
      console.error('Stock upload error:', error);
      setUploadError('Failed to analyze screenshots. Please try again.');
      setUploadProcessing(false);
    }
  };

  // Update extracted item
  const updateExtractedStockItem = (idx, field, value) => {
    const items = [...extractedStockItems];
    items[idx][field] = value;

    // If manually matching to existing product
    if (field === 'matchedSku' && value) {
      const product = data.products.find(p => p.sku === value);
      if (product) {
        items[idx].matchedName = product.name;
        items[idx].isNew = false;
        items[idx].matchConfidence = 'manual';
        setProductsToCreate(prev => prev.filter(p => p.sku !== items[idx].sku));
      }
    }

    setExtractedStockItems(items);
  };

  // Toggle item selection
  const toggleStockItemSelection = (idx) => {
    const items = [...extractedStockItems];
    items[idx].selected = !items[idx].selected;
    setExtractedStockItems(items);
  };

  // Apply extracted stock data
  const applyExtractedStockData = async () => {
    // Create new products first
    const selectedNewProducts = productsToCreate.filter(p =>
      extractedStockItems.some(item => item.selected && item.isNew && item.sku === p.sku)
    );

    if (selectedNewProducts.length > 0) {
      const newProductsList = [...data.products, ...selectedNewProducts];
      await bulkImportProducts(newProductsList);
    }

    // Build new location stock as array for API
    const stockUpdates = [];
    const existingStock = { ...(data.locationStock[selectedLocation] || {}) };

    for (const item of extractedStockItems) {
      if (!item.selected) continue;

      const sku = item.isNew ? item.sku : item.matchedSku;
      if (sku) {
        existingStock[sku] = item.stockCount || 0;
      }
    }

    // Convert to array format expected by API
    for (const [sku, quantity] of Object.entries(existingStock)) {
      stockUpdates.push({ sku, quantity });
    }

    // Save location stock
    await setLocationStock(selectedLocation, stockUpdates);

    // Reset upload state
    setShowStockUpload(false);
    setReviewMode(false);
    setExtractedStockItems([]);
    setProductsToCreate([]);
    setUploadImages([]);
  };

  const products = getProductsForLocation();
  const unassignedProducts = getUnassignedProducts();

  // Frive fresh meals collapse into meal-type group rows; everything else renders
  // per-SKU as before.
  const freshMeals = products.filter(p => p.isFreshMeal);
  const regularProducts = products.filter(p => !p.isFreshMeal);

  // Regular products grouped by category (alphabetical, products alphabetical
  // within), matching the Stock Levels page layout
  const groupedProducts = (() => {
    const groups = {};
    regularProducts.forEach(p => {
      const cat = p.category || 'Uncategorised';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        items: items.sort((x, y) => (x.name || x.sku).localeCompare(y.name || y.sku)),
      }));
  })();

  // Collapse fresh meals into one row per meal-type bucket. Current stock is the
  // SUM of member SKUs' location stock (single source of truth — VendLive sync,
  // restocks and screenshot import keep writing per-SKU). Capacity is per group.
  const mealConfig = data.locationMealConfig[selectedLocation] || {};
  const mealGroups = (() => {
    const groups = {};
    freshMeals.forEach(p => {
      const key = p.mealType || 'Unclassified';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    const order = (data.mealTypes || []).map(m => m.name);
    const rank = (name) => {
      const i = order.indexOf(name);
      return i === -1 ? 999 : i; // unknown/Unclassified buckets sort last
    };
    return Object.entries(groups)
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([mealType, items]) => ({
        mealType,
        items: items.sort((x, y) => (x.name || x.sku).localeCompare(y.name || y.sku)),
        totalQty: items.reduce((acc, p) => acc + (locStock[p.sku] || 0), 0),
        config: mealConfig[mealType] || {},
      }));
  })();

  // Gross margin from the VendLive-synced prices; null when either is missing
  const getMargin = (product) => {
    if (!product.salePrice || !product.unitCost) return null;
    const amount = product.salePrice - product.unitCost;
    return { amount, pct: (amount / product.salePrice) * 100 };
  };
  const totalUnits = products.reduce((acc, p) => acc + (locStock[p.sku] || 0), 0);
  // Low-stock: regular products counted per-SKU; each meal group counted once.
  const lowStockCount =
    regularProducts.filter(p => {
      const config = locConfig[p.sku] || {};
      return config.minStock && (locStock[p.sku] || 0) <= config.minStock;
    }).length +
    mealGroups.filter(g => g.config.minStock && g.totalQty <= g.config.minStock).length;
  const rowCount = regularProducts.length + mealGroups.length;

  const hasAssignedItems = location?.assignedItems?.length > 0;
  const colSpan = showConfig ? 9 : 7;

  // One per-SKU stock row. Reused for regular products and for the expanded
  // member flavours inside a collapsed meal group (indent flag).
  const renderProductRow = (product, { indent = false } = {}) => {
    const qty = locStock[product.sku] || 0;
    const config = locConfig[product.sku] || {};
    const { status, color } = getStockStatus(product.sku, qty);
    const margin = getMargin(product);

    return (
      <tr key={product.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
        <td className={`px-4 py-3 text-zinc-200 ${indent ? 'pl-10' : ''}`}>{product.name}</td>
        <td className="px-4 py-3 text-zinc-500 text-xs font-mono">{product.sku}</td>
        {showConfig && (
          <>
            <td className="px-4 py-3">
              <input
                type="number"
                value={config.minStock || ''}
                onChange={e => handleUpdateConfig(product.sku, 'minStock', e.target.value)}
                placeholder="0"
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
              />
            </td>
            <td className="px-4 py-3">
              <input
                type="number"
                value={config.maxStock || ''}
                onChange={e => handleUpdateConfig(product.sku, 'maxStock', e.target.value)}
                placeholder="0"
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
              />
            </td>
          </>
        )}
        <td className="px-4 py-3 text-right text-zinc-300">
          {product.salePrice ? (
            `£${product.salePrice.toFixed(2)}`
          ) : (
            <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">No price</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          {margin ? (
            <span className={margin.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              £{margin.amount.toFixed(2)}
              <span className="text-zinc-500 text-xs ml-1">({margin.pct.toFixed(0)}%)</span>
            </span>
          ) : (
            <span className="text-zinc-600 text-xs" title="Needs both sale price and cost price">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          <span className={`inline-block px-2 py-0.5 rounded text-xs ${
            color === 'red' ? 'bg-red-500/20 text-red-400' :
            color === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' :
            color === 'green' ? 'bg-emerald-500/20 text-emerald-400' :
            'bg-zinc-700 text-zinc-400'
          }`}>
            {status}
          </span>
        </td>
        <td className="px-4 py-3">
          <input
            type="number"
            value={qty}
            onChange={e => updateStock(product.sku, e.target.value)}
            className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-emerald-500 ml-auto block"
          />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => adjustStock(product.sku, -10)} className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white text-xs">-10</button>
            <button onClick={() => adjustStock(product.sku, -1)} className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white">-</button>
            <button onClick={() => adjustStock(product.sku, 1)} className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white">+</button>
            <button onClick={() => adjustStock(product.sku, 10)} className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white text-xs">+10</button>
            {showConfig && hasAssignedItems && (
              <button
                onClick={() => removeProductFromLocation(product.sku)}
                className="w-8 h-8 rounded bg-zinc-800 text-red-400 hover:bg-red-900/50 hover:text-red-300 ml-2"
                title="Remove from location"
              >
                ×
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // One collapsed meal-type group row, plus member flavour rows when expanded.
  const renderMealGroup = (group) => {
    const expanded = !!expandedGroups[group.mealType];
    const { status, color } = getGroupStockStatus(group.totalQty, group.config);
    const unclassified = group.mealType === 'Unclassified';
    // Restock planning aid: how many to load to reach the group's target (max).
    const toAdd = group.config.maxStock ? Math.max(0, group.config.maxStock - group.totalQty) : 0;

    return (
      <React.Fragment key={`meal-${group.mealType}`}>
        <tr className="border-b border-zinc-800/50 bg-teal-500/5 hover:bg-teal-500/10">
          <td className="px-4 py-3">
            <button
              onClick={() => setExpandedGroups(prev => ({ ...prev, [group.mealType]: !expanded }))}
              className="flex items-center gap-2 text-left"
            >
              <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
              <span className="text-zinc-100 font-medium">{group.mealType}</span>
            </button>
          </td>
          <td className="px-4 py-3 text-zinc-500 text-xs">
            {group.items.length} flavour{group.items.length === 1 ? '' : 's'}
          </td>
          {showConfig && (
            <>
              <td className="px-4 py-3">
                <input
                  type="number"
                  value={group.config.minStock || ''}
                  onChange={e => handleUpdateMealConfig(group.mealType, 'minStock', e.target.value)}
                  placeholder="0"
                  className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
                />
              </td>
              <td className="px-4 py-3">
                <input
                  type="number"
                  value={group.config.maxStock || ''}
                  onChange={e => handleUpdateMealConfig(group.mealType, 'maxStock', e.target.value)}
                  placeholder="0"
                  className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
                />
              </td>
            </>
          )}
          <td className="px-4 py-3 text-right text-zinc-600 text-xs">—</td>
          <td className="px-4 py-3 text-right text-zinc-600 text-xs">—</td>
          <td className="px-4 py-3 text-center">
            {unclassified ? (
              <span className="inline-block px-2 py-0.5 rounded text-xs bg-zinc-700 text-zinc-400" title="Set a meal type in Admin → Fresh Meals">unclassified</span>
            ) : (
              <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                color === 'red' ? 'bg-red-500/20 text-red-400' :
                color === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' :
                color === 'green' ? 'bg-emerald-500/20 text-emerald-400' :
                'bg-zinc-700 text-zinc-400'
              }`}>
                {status}
              </span>
            )}
          </td>
          <td className="px-4 py-3 text-right">
            <div>
              <span className="text-lg font-semibold text-teal-300">{group.totalQty}</span>
              <span className="text-zinc-500 text-xs ml-1">units</span>
            </div>
            {toAdd > 0 && (
              <div className="text-amber-400 text-xs mt-0.5">add {toAdd} → {group.config.maxStock}</div>
            )}
          </td>
          <td className="px-4 py-3 text-center text-zinc-600 text-xs">
            {expanded ? 'expanded' : 'tap to expand'}
          </td>
        </tr>
        {expanded && (
          group.items.length === 0 ? (
            <tr><td colSpan={colSpan} className="px-4 py-3 pl-10 text-zinc-600 text-xs">No flavours stocked this week.</td></tr>
          ) : (
            group.items.map(product => renderProductRow(product, { indent: true }))
          )
        )}
      </React.Fragment>
    );
  };

  // Show message if no locations exist
  if (data.locations.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold">Location Stock</h2>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
          <p className="text-zinc-400 mb-4">No locations configured yet.</p>
          <p className="text-zinc-500 text-sm">Go to Admin → Locations to add your first location.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Location Stock</h2>
          <p className="text-zinc-500 text-sm mt-1 hidden md:block">View and update stock levels at each location</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <select
            value={selectedLocation}
            onChange={e => { setSelectedLocation(e.target.value); setShowAddProduct(false); }}
            className="bg-zinc-800 border border-zinc-700 rounded px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
          >
            {data.locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <label className="flex-1 sm:flex-none px-3 py-2.5 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-500 transition-colors cursor-pointer text-center">
              <span className="hidden sm:inline">Upload Screenshot</span><span className="sm:hidden">Upload</span>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleStockUpload}
                className="hidden"
              />
            </label>
            <button
              onClick={() => { setShowConfig(!showConfig); setShowAddProduct(false); }}
              className={`flex-1 sm:flex-none px-3 py-2.5 rounded text-sm transition-colors ${
                showConfig ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {showConfig ? 'Done' : 'Config'}
            </button>
          </div>
        </div>
      </div>

      {/* Stock Upload Modal */}
      {showStockUpload && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">
              {reviewMode ? 'Review Extracted Stock Data' : 'Analyzing Screenshots'}
            </h3>
            <button
              onClick={() => { setShowStockUpload(false); setReviewMode(false); setExtractedStockItems([]); }}
              className="text-zinc-500 hover:text-zinc-300 text-xl"
            >
              ×
            </button>
          </div>

          {uploadProcessing && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin text-teal-400 text-3xl mb-4">↻</div>
              <p className="text-zinc-400">Analyzing stock screenshots with AI...</p>
              <p className="text-zinc-500 text-sm mt-2">Extracting products, quantities, and prices</p>
            </div>
          )}

          {uploadError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-400 text-sm">{uploadError}</p>
            </div>
          )}

          {reviewMode && (
            <div className="space-y-6">
              {/* Screenshots Preview */}
              {uploadImages.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {uploadImages.map((img, idx) => (
                    <img
                      key={idx}
                      src={img.data}
                      alt={`Screenshot ${idx + 1}`}
                      className="h-24 rounded border border-zinc-700 flex-shrink-0"
                    />
                  ))}
                </div>
              )}

              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-teal-400">{extractedStockItems.length}</div>
                  <div className="text-xs text-zinc-500">Items Found</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-emerald-400">
                    {extractedStockItems.filter(i => !i.isNew).length}
                  </div>
                  <div className="text-xs text-zinc-500">Matched</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-yellow-400">
                    {extractedStockItems.filter(i => i.isNew).length}
                  </div>
                  <div className="text-xs text-zinc-500">New Products</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-blue-400">
                    {extractedStockItems.filter(i => i.selected).reduce((acc, i) => acc + (i.stockCount || 0), 0)}
                  </div>
                  <div className="text-xs text-zinc-500">Total Units</div>
                </div>
              </div>

              {/* Category Legend */}
              <div className="flex gap-4 text-xs">
                <span className="text-emerald-400">Matched (Existing Product)</span>
                <span className="text-yellow-400">New Product</span>
              </div>

              {/* Extracted Items List */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {extractedStockItems.map((item, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      item.selected
                        ? item.isNew
                          ? 'bg-yellow-500/5 border-yellow-500/30'
                          : 'bg-emerald-500/5 border-emerald-500/30'
                        : 'bg-zinc-800/30 border-zinc-700 opacity-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => toggleStockItemSelection(idx)}
                      className="w-4 h-4 rounded border-zinc-600"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          item.isNew
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {item.isNew ? 'NEW' : item.matchConfidence?.toUpperCase() || 'MATCHED'}
                        </span>
                        <span className="text-xs bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-400">
                          {item.category}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-200 mt-1">{item.name}</p>
                      {!item.isNew && item.matchedName && item.matchedName !== item.name && (
                        <p className="text-xs text-zinc-500">→ {item.matchedName}</p>
                      )}
                    </div>

                    {/* Match to existing product dropdown for new items */}
                    {item.isNew && item.selected && (
                      <select
                        value={item.matchedSku || ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            updateExtractedStockItem(idx, 'matchedSku', e.target.value);
                          }
                        }}
                        className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs max-w-[150px]"
                      >
                        <option value="">Create New</option>
                        {data.products.map(p => (
                          <option key={p.sku} value={p.sku}>{p.name}</option>
                        ))}
                      </select>
                    )}

                    <div className="text-center">
                      <p className="text-zinc-500 text-xs">Stock</p>
                      <input
                        type="number"
                        value={item.stockCount || 0}
                        onChange={(e) => updateExtractedStockItem(idx, 'stockCount', parseInt(e.target.value) || 0)}
                        className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-center text-sm"
                      />
                    </div>

                    <div className="text-center">
                      <p className="text-zinc-500 text-xs">Price</p>
                      <p className="text-zinc-300 text-sm">£{(item.price || 0).toFixed(2)}</p>
                    </div>
                  </div>
                ))}

                {extractedStockItems.length === 0 && !uploadProcessing && (
                  <p className="text-zinc-500 text-center py-8">No items extracted from screenshots</p>
                )}
              </div>

              {/* New Products Warning */}
              {productsToCreate.filter(p => extractedStockItems.some(i => i.selected && i.isNew && i.sku === p.sku)).length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-yellow-400 mb-2">
                    New Products to Create ({productsToCreate.filter(p => extractedStockItems.some(i => i.selected && i.isNew && i.sku === p.sku)).length})
                  </h4>
                  <p className="text-zinc-400 text-xs mb-2">
                    These will be added to your product catalog and assigned to this location.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {productsToCreate
                      .filter(p => extractedStockItems.some(i => i.selected && i.isNew && i.sku === p.sku))
                      .map(p => (
                        <span key={p.sku} className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded">
                          {p.name} ({p.category})
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-zinc-800">
                <button
                  onClick={applyExtractedStockData}
                  disabled={extractedStockItems.filter(i => i.selected).length === 0}
                  className="flex-1 px-4 py-3 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Apply Stock Updates ({extractedStockItems.filter(i => i.selected).length} items)
                </button>
                <button
                  onClick={() => { setShowStockUpload(false); setReviewMode(false); }}
                  className="px-4 py-3 bg-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {location && !showStockUpload && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">{rowCount}</div>
              <div className="text-xs text-zinc-500 mt-1">{mealGroups.length > 0 ? 'Products / meal groups' : 'Products'}</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">{totalUnits}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Units</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{lowStockCount}</div>
              <div className="text-xs text-zinc-500 mt-1">Low Stock Items</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-zinc-400 capitalize">{location.type}</div>
              <div className="text-xs text-zinc-500 mt-1">Location Type</div>
            </div>
          </div>

          {showConfig && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-medium text-zinc-300">Assigned Products</h4>
                  <p className="text-xs text-zinc-500 mt-1">
                    {hasAssignedItems
                      ? `${products.length} products assigned to this location`
                      : 'All products allowed (no specific assignments)'}
                  </p>
                </div>
                {unassignedProducts.length > 0 && (
                  <button
                    onClick={() => setShowAddProduct(!showAddProduct)}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-500"
                  >
                    + Add Product
                  </button>
                )}
              </div>

              {showAddProduct && unassignedProducts.length > 0 && (
                <div className="mb-4 p-3 bg-zinc-800/50 rounded-lg">
                  <p className="text-xs text-zinc-400 mb-2">Select products to add:</p>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {unassignedProducts.map(p => (
                      <button
                        key={p.sku}
                        onClick={() => addProductToLocation(p.sku)}
                        className="px-3 py-1.5 bg-zinc-700 hover:bg-emerald-600 text-zinc-300 hover:text-white rounded text-sm transition-colors"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                  {showConfig && (
                    <>
                      <th className="text-center px-4 py-3 text-zinc-500 font-medium">Min Stock</th>
                      <th className="text-center px-4 py-3 text-zinc-500 font-medium">Max Stock</th>
                    </>
                  )}
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Sale Price</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Margin</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Current Stock</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rowCount === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-4 py-8 text-center text-zinc-600">
                      No products assigned to this location
                    </td>
                  </tr>
                ) : (
                  <>
                    {/* Frive fresh meals — collapsed into one row per meal type */}
                    {mealGroups.length > 0 && (
                      <React.Fragment key="fresh-meals">
                        <tr className="bg-teal-900/40">
                          <td colSpan={colSpan} className="px-4 py-2">
                            <span className="text-teal-300 font-medium text-xs uppercase tracking-wide">Fresh Meals (Frive)</span>
                            <span className="text-zinc-500 text-xs ml-3">
                              {mealGroups.length} group{mealGroups.length === 1 ? '' : 's'} · {mealGroups.reduce((acc, g) => acc + g.totalQty, 0)} units here · combined volume per meal type
                            </span>
                          </td>
                        </tr>
                        {mealGroups.map(group => renderMealGroup(group))}
                      </React.Fragment>
                    )}

                    {/* Everything else — per-SKU, grouped by category */}
                    {groupedProducts.map(group => (
                      <React.Fragment key={group.category}>
                        <tr className="bg-zinc-800/60">
                          <td colSpan={colSpan} className="px-4 py-2">
                            <span className="text-emerald-400 font-medium text-xs uppercase tracking-wide">{group.category}</span>
                            <span className="text-zinc-500 text-xs ml-3">
                              {group.items.length} product{group.items.length === 1 ? '' : 's'} · {group.items.reduce((acc, p) => acc + (locStock[p.sku] || 0), 0)} units here
                            </span>
                          </td>
                        </tr>
                        {group.items.map(product => renderProductRow(product))}
                      </React.Fragment>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>

          {showConfig && (
            <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-4">
              <p className="text-blue-300 text-sm">
                <strong>Configuration Tips:</strong> Set min/max stock levels per product. Items at or below minimum show as "low". Use the + Add Product button to assign new products to this location (syncs with Admin settings).
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
