'use client';

import { useEffect, useRef } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps-loader';
import { NYC_SEARCH_BOUNDS } from '@/lib/solar/config';

export type SelectedPlace = {
  label: string;
  latitude: number;
  longitude: number;
};

type PlaceSearchProps = {
  apiKey: string;
  disabled?: boolean;
  onSelect: (place: SelectedPlace) => void;
};

export function PlaceSearch({ apiKey, disabled, onSelect }: PlaceSearchProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;

    void loadGoogleMaps(apiKey).then(async () => {
      const { PlaceAutocompleteElement } = (await google.maps.importLibrary(
        'places',
      )) as google.maps.PlacesLibrary;
      if (disposed || !host) return;

      const autocomplete = new PlaceAutocompleteElement({
        includedRegionCodes: ['us'],
        locationRestriction: NYC_SEARCH_BOUNDS,
      });
      autocomplete.placeholder = '搜索纽约地址或建筑';
      autocomplete.style.width = '100%';
      autocomplete.addEventListener(
        'gmp-select',
        async (event: google.maps.places.PlacePredictionSelectEvent) => {
          const place = event.placePrediction.toPlace();
          await place.fetchFields({
            fields: ['displayName', 'formattedAddress', 'location'],
          });
          if (!place.location) return;
          onSelectRef.current({
            label: place.formattedAddress ?? place.displayName ?? '纽约建筑',
            latitude: place.location.lat(),
            longitude: place.location.lng(),
          });
        },
      );
      host.replaceChildren(autocomplete);
    });

    return () => {
      disposed = true;
      host?.replaceChildren();
    };
  }, [apiKey]);

  return (
    <div
      ref={hostRef}
      aria-disabled={disabled}
      className={disabled ? 'pointer-events-none opacity-50' : ''}
    />
  );
}
