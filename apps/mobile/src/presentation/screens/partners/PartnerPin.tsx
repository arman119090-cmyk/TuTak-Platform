import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PartnerCategory } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { PartnerMark } from '../../components/PartnerMark';
import { CATEGORY_ICONS } from './categories';
import { mapPinStyles } from './mapPinStyles';

/**
 * One partner on the map.
 *
 * A disc with the partner's own logo, on a stem that points at the
 * coordinate — the stem matters, because a bare circle centred on a point is
 * ambiguous about which point it means once there are two of them a block
 * apart. Per Arman's confirmed request, 2026-08-23: "заменить иконку
 * категории на карте на логотип партнёра" — the category icon is now only
 * the fallback for a partner that has published no logo (every partner that
 * predates the media system, and any that simply hasn't uploaded one), via
 * `PartnerMark`'s `fallback` prop.
 *
 * Selected, it takes the brand fill and grows. Unselected pins stay dark with
 * a light border so a dense street reads as a set of markers rather than as a
 * wall of blue. The disc's own border remains the ring around the logo image
 * too — `PartnerMark` renders the mark itself inset from the disc's edge by
 * exactly the border's width, so the ring reads as a frame rather than a
 * second, overlapping outline.
 */
export function PartnerPin({
  name,
  category,
  cashbackPercent,
  logoUrl,
  selected,
}: {
  /** The partner's display name — the mark's accessibility label. */
  name: string;
  category: PartnerCategory;
  cashbackPercent: number;
  logoUrl?: string | null;
  selected: boolean;
}) {
  const { color, premium, text, radius } = useTheme();
  const discSize = selected ? 34 : 28;
  const borderWidth = selected ? 2 : 1;
  const markSize = discSize - borderWidth * 2;

  return (
    <View style={mapPinStyles.wrap} pointerEvents="none">
      {selected ? (
        // Only the selected pin states its rate. Every pin carrying a number
        // turns the map into a page of numbers; one does the job, and the
        // list below carries the rest.
        <View
          style={[
            mapPinStyles.badge,
            {
              backgroundColor: premium.brand.primary,
              borderRadius: radius.full,
              marginBottom: 2,
            },
          ]}
        >
          <Text style={[text.overline, { color: color.textInverse }]}>
            {cashbackPercent}%
          </Text>
        </View>
      ) : null}

      <View
        style={[
          mapPinStyles.disc,
          selected ? mapPinStyles.discSelected : null,
          {
            backgroundColor: selected ? premium.brand.primary : premium.card.background,
            borderColor: selected ? premium.brand.light : premium.card.border,
          },
        ]}
      >
        <PartnerMark
          name={name}
          logoUrl={logoUrl}
          size={markSize}
          circular
          // `transparent`, not the component's own default tint: the disc
          // above already carries the selected/unselected background this
          // pin has always shown behind the icon, and a second, differently
          // coloured square behind a round disc would look like a mistake
          // rather than a fallback.
          fallbackBackgroundColor="transparent"
          fallback={
            <Ionicons
              name={CATEGORY_ICONS[category]}
              size={selected ? 18 : 15}
              color={selected ? color.textInverse : color.textPrimary}
            />
          }
        />
      </View>

      <View
        style={[
          mapPinStyles.stem,
          { backgroundColor: selected ? premium.brand.primary : premium.card.border },
        ]}
      />
    </View>
  );
}
