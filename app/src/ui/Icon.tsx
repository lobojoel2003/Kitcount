import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import type { SupplyIcon } from '../core/domain/catalog';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: ColorValue }) {
  return <MaterialCommunityIcons name={name} size={size} color={color as string} />;
}

const SUPPLY_GLYPHS: Record<SupplyIcon, IconName> = {
  needle: 'needle',
  naloxone: 'spray',
  strip: 'test-tube',
  cooker: 'pot-mix',
  cotton: 'medical-cotton-swab',
  water: 'water',
  pad: 'bandage',
  tourniquet: 'tape-measure',
  sharps: 'trash-can',
  wound: 'medical-bag',
  pipe: 'pipe',
  condom: 'shield-check',
  hygiene: 'hand-wash',
  food: 'food-apple',
  box: 'package-variant-closed',
};

export function supplyGlyph(icon: SupplyIcon): IconName {
  return SUPPLY_GLYPHS[icon] ?? 'package-variant-closed';
}
