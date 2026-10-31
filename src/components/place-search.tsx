'use client';

import { useEffect, useId, useRef, useState } from 'react';

export type SelectedPlace = {
  label: string;
  latitude: number;
  longitude: number;
};

type PlaceSearchProps = {
  placeholder: string;
  disabled?: boolean;
  onSelect: (place: SelectedPlace) => void;
};

// NYC Planning Labs GeoSearch: the city's own address search, free and
// keyless. Autocomplete handles partial input; search matches full addresses
// that autocomplete misses, so both are asked and merged.
const GEOSEARCH = 'https://geosearch.planninglabs.nyc/v2';
const DEBOUNCE_MS = 200;
const MAX_RESULTS = 6;

type GeoSearchResponse = {
  features: Array<{ properties: { label: string }; geometry: { coordinates: [number, number] } }>;
};

// Address autocomplete as an accessible combobox: type, then pick with the
// mouse or arrow keys and Enter.
export function PlaceSearch({ placeholder, disabled, onSelect }: PlaceSearchProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SelectedPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) return;
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      const ask = (endpoint: string) => fetch(`${GEOSEARCH}/${endpoint}?text=${encodeURIComponent(text)}`)
        .then((response) => (response.ok ? response.json() as Promise<GeoSearchResponse> : { features: [] }))
        .catch(() => ({ features: [] }) as GeoSearchResponse);
      void Promise.all([ask('autocomplete'), ask('search')]).then((answers) => {
        if (request !== requestRef.current) return;
        const places = new Map<string, SelectedPlace>();
        for (const feature of answers.flatMap((answer) => answer.features)) {
          const label = feature.properties.label.replace(/, USA$/, '');
          if (!places.has(label)) places.set(label, { label, longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] });
        }
        setResults([...places.values()].slice(0, MAX_RESULTS));
        setActive(0);
      });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const shown = open && query.trim().length >= 3 ? results : [];
  const choose = (place: SelectedPlace) => {
    setQuery(place.label);
    setOpen(false);
    onSelect(place);
  };

  return (
    <div className={`relative ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <input
        type="search"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown.length ? `${listId}-${active}` : undefined}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && shown.length) {
            event.preventDefault();
            setActive((index) => (index + 1) % shown.length);
          } else if (event.key === 'ArrowUp' && shown.length) {
            event.preventDefault();
            setActive((index) => (index - 1 + shown.length) % shown.length);
          } else if (event.key === 'Enter' && shown[active]) {
            event.preventDefault();
            choose(shown[active]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="h-8 w-full rounded-[9px] bg-transparent px-2.5 text-[15px] text-label outline-none placeholder:text-label-tertiary"
      />
      {shown.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-[12px] bg-white py-1 shadow-[0_10px_30px_rgb(15_23_42/0.18)]">
          {shown.map((place, index) => (
            <li
              key={`${place.label}-${index}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Pick on press, before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(place);
              }}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer px-3 py-2 text-[14px] ${index === active ? 'bg-accent text-white' : 'text-label'}`}
            >
              {place.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
