/**
 * AreaCascadeFilter — search-only cascading area picker (Module 4.1).
 *
 * Unlike AreaSelector (Module 2.2), this component is purely a *filter*:
 *   - No map / Nominatim (those live in AreaSelector for picking an exact
 *     user location).
 *   - The output is `{ areaId }` — the deepest selected node, used to
 *     filter the search list by area. There's no map pin or label to
 *     format; the caller passes areaId straight into the query.
 *
 * The 5 <select>s are driven by `useDistricts()` (Module 2.2) plus
 * `useChildren({parentId, level})` for every deeper level. Picking a
 * node at any level resets the deeper selects. Emitting `null` for the
 * top-level (or for a deeper level after the parent was cleared) means
 * "no area filter".
 *
 * KEY DESIGN REMINDER: the parent's pick is purely structural. We
 * don't accept area *labels* here — Module 4.2's resource details
 * page is the right surface for a labeled display (it can resolve
 * the areaId via /api/areas and render the chain).
 */

import { useEffect, useState } from 'react';
import { useChildren, useDistricts } from '../hooks/useAreas';
import { AREA_LEVELS } from '../utils/constants';

export default function AreaCascadeFilter({ value = null, onChange }) {
  // chain: level -> { id, name } | null
  const [chain, setChain] = useState(() => ({
    DISTRICT: null,
    UPAZILA: null,
    UNION: null,
    WARD: null,
    VILLAGE: null,
  }));

  // Re-seed when the upstream value changes (URL -> page -> component).
  useEffect(() => {
    setChain({
      DISTRICT: null,
      UPAZILA: null,
      UNION: null,
      WARD: null,
      VILLAGE: null,
    });
    // We only react to external flips; the internal chain manages
    // its own state during user interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // The deepest selected id. Module 4.1 matches exact areaId; the
  // hierarchy isn't walked server-side yet.
  const deepest = (() => {
    for (let i = AREA_LEVELS.length - 1; i >= 0; i -= 1) {
      const node = chain[AREA_LEVELS[i].value];
      if (node && node.id) return node.id;
    }
    return null;
  })();

  // Emit onChange only when the deepest id actually changes.
  useEffect(() => {
    if (typeof onChange !== 'function') return;
    onChange(deepest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepest]);

  return (
    <div className="space-y-2">
      {AREA_LEVELS.map((level, idx) => {
        const parent =
          idx === 0 ? null : chain[AREA_LEVELS[idx - 1].value]?.id || null;
        const currentId = chain[level.value]?.id || '';
        return (
          <LevelSelect
            key={level.value}
            level={level}
            parentId={parent}
            value={currentId}
            disabled={idx > 0 && !parent}
            onChange={(id) => {
              const next = { ...chain };
              next[level.value] = id ? { id, name: '' } : null;
              for (let i = idx + 1; i < AREA_LEVELS.length; i += 1) {
                next[AREA_LEVELS[i].value] = null;
              }
              setChain(next);
            }}
          />
        );
      })}
    </div>
  );
}

function LevelSelect({ level, parentId, value, onChange, disabled }) {
  // The district level has no parent. `useDistricts` returns the
  // district slice; for deeper levels we ask `useChildren` for the
  // children of the currently selected parent.
  const query =
    level.value === 'DISTRICT'
      ? useDistricts()
      : useChildren({ parentId, level: level.value });

  const options = (query.data && query.data.areas) || [];
  const isFetching = query.isFetching;

  return (
    <div>
      <label
        htmlFor={`area-filter-${level.value.toLowerCase()}`}
        className="block text-xs font-medium text-slate-600"
      >
        {level.label}
      </label>
      <select
        id={`area-filter-${level.value.toLowerCase()}`}
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">
          {disabled
            ? `Select ${prevLabel(level.value)} first`
            : isFetching
            ? 'Loading…'
            : `Any ${level.label.toLowerCase()}`}
        </option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function prevLabel(levelValue) {
  const idx = AREA_LEVELS.findIndex((l) => l.value === levelValue);
  if (idx <= 0) return 'parent';
  return AREA_LEVELS[idx - 1].label.toLowerCase();
}