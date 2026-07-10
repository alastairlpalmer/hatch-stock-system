import React, { useState } from 'react';
import { computeFridgeGeometry, truncateLabel } from '../../utils/planogramGeometry';

/**
 * Hand-rolled SVG fridge diagram (no chart libs — same idiom as SalesCharts).
 *
 * Pure presentational: receives layout shelves and a slot render model, draws
 * the fridge with one rect per slot, coloured by stock status, plus a floating
 * HTML tooltip. Slots render FROM assignments — an empty slot is a real gap.
 *
 * slotModels: { "shelf-position": {
 *   label, qty, multiSlotCount, statusColor ('red'|'yellow'|'green'|'zinc'),
 *   stale, isGroup, tooltip: { title, subtitle, lines: [] }
 * } }
 */

const STATUS_FILL = {
  red: 'rgba(239, 68, 68, 0.16)',
  yellow: 'rgba(234, 179, 8, 0.16)',
  green: 'rgba(16, 185, 129, 0.16)',
  zinc: 'rgba(113, 113, 122, 0.10)',
};
const STATUS_TEXT = {
  red: '#f87171',
  yellow: '#facc15',
  green: '#34d399',
  zinc: '#d4d4d8',
};

export default function FridgeDiagram({ shelves, slotModels }) {
  const [hover, setHover] = useState(null); // { key, xPct, yPct }
  const geo = computeFridgeGeometry(shelves);
  const hovered = hover ? slotModels[hover.key] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${geo.width} ${geo.height}`} className="w-full h-auto" role="img" aria-label="Fridge planogram diagram">
        {/* fridge chrome */}
        <rect x={2} y={2} width={geo.width - 4} height={geo.height - 4} rx={10} fill="none" stroke="#3f3f46" strokeWidth={2.5} />
        <rect x={8} y={8} width={geo.width - 16} height={geo.height - 16} rx={6} fill="none" stroke="#27272a" strokeWidth={1} />

        {geo.shelves.map((row) => (
          <g key={row.shelf}>
            {/* shelf number gutter label */}
            <text
              x={14}
              y={row.y + row.slots[0].height / 2 + 4}
              fontSize={12}
              fontFamily="monospace"
              fill="#71717a"
            >
              {row.shelf}
            </text>
            {/* shelf baseline */}
            <line
              x1={10}
              x2={geo.width - 10}
              y1={row.y + row.slots[0].height + 3}
              y2={row.y + row.slots[0].height + 3}
              stroke="#3f3f46"
              strokeWidth={2}
            />
            {row.slots.map((slot) => {
              const key = `${row.shelf}-${slot.position}`;
              const model = slotModels[key];
              const isHover = hover?.key === key;
              return (
                <g
                  key={key}
                  opacity={model?.stale ? 0.4 : 1}
                  onMouseEnter={() =>
                    setHover({ key, xPct: ((slot.x + slot.width / 2) / geo.width) * 100, yPct: (slot.y / geo.height) * 100 })
                  }
                  onMouseLeave={() => setHover(null)}
                  onClick={() =>
                    setHover((h) => (h?.key === key ? null : { key, xPct: ((slot.x + slot.width / 2) / geo.width) * 100, yPct: (slot.y / geo.height) * 100 }))
                  }
                  style={{ cursor: model ? 'pointer' : 'default' }}
                >
                  <rect
                    x={slot.x}
                    y={slot.y}
                    width={slot.width}
                    height={slot.height}
                    rx={4}
                    fill={model ? STATUS_FILL[model.statusColor] || STATUS_FILL.zinc : 'transparent'}
                    stroke={isHover ? '#34d399' : model ? '#3f3f46' : '#3f3f46'}
                    strokeWidth={isHover ? 1.5 : 1}
                    strokeDasharray={model ? undefined : '4 3'}
                  />
                  <text x={slot.x + 4} y={slot.y + 12} fontSize={8} fontFamily="monospace" fill="#71717a">
                    {slot.code}
                  </text>
                  {model ? (
                    <>
                      <text
                        x={slot.x + slot.width / 2}
                        y={slot.y + slot.height / 2 + 3}
                        fontSize={10}
                        textAnchor="middle"
                        fill={model.isGroup ? '#5eead4' : '#e4e4e7'}
                      >
                        {truncateLabel(model.label, slot.width)}
                      </text>
                      {model.qty != null && (
                        <text
                          x={slot.x + slot.width - 5}
                          y={slot.y + slot.height - 6}
                          fontSize={11}
                          fontWeight={600}
                          textAnchor="end"
                          fill={STATUS_TEXT[model.statusColor] || STATUS_TEXT.zinc}
                        >
                          {model.qty}{model.multiSlotCount > 1 ? ` ×${model.multiSlotCount}` : ''}
                        </text>
                      )}
                      {model.stale && <circle cx={slot.x + slot.width - 7} cy={slot.y + 8} r={3.5} fill="#f59e0b" />}
                    </>
                  ) : (
                    <text x={slot.x + slot.width / 2} y={slot.y + slot.height / 2 + 3} fontSize={11} textAnchor="middle" fill="#52525b">
                      —
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>

      {hovered?.tooltip && (
        <div
          className="absolute z-10 pointer-events-none bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl px-3 py-2 text-xs max-w-[220px]"
          style={{
            left: `${Math.min(85, Math.max(5, hover.xPct))}%`,
            top: `${hover.yPct}%`,
            transform: 'translate(-50%, -110%)',
          }}
        >
          <div className="font-medium text-zinc-100">{hovered.tooltip.title}</div>
          {hovered.tooltip.subtitle && <div className="text-zinc-500">{hovered.tooltip.subtitle}</div>}
          {hovered.tooltip.lines?.map((line, i) => (
            <div key={i} className="text-zinc-400">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
