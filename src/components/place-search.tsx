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
  placeholder: string;
  fallbackLabel: string;
  disabled?: boolean;
  onSelect: (place: SelectedPlace) => void;
};

export function PlaceSearch({ apiKey, placeholder, fallbackLabel, disabled, onSelect }: PlaceSearchProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  const fallbackLabelRef = useRef(fallbackLabel);
  const placeholderRef = useRef(placeholder);
  const autocompleteRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
    fallbackLabelRef.current = fallbackLabel;
  }, [fallbackLabel, onSelect]);

  useEffect(() => {
    placeholderRef.current = placeholder;
    if (autocompleteRef.current) autocompleteRef.current.placeholder = placeholder;
  }, [placeholder]);

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
      autocomplete.placeholder = placeholderRef.current;
      autocompleteRef.current = autocomplete;
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
            label: place.formattedAddress ?? place.displayName ?? fallbackLabelRef.current,
            latitude: place.location.lat(),
            longitude: place.location.lng(),
          });
        },
      );
      host.replaceChildren(autocomplete);
    });

    return () => {
      disposed = true;
      autocompleteRef.current = null;
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
