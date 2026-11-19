import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * The Kitcount mark: a rounded supply tile holding a tally check — a kit
 * counted. Same geometry as assets/brand/logo.svg.
 */
export function Logo({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 128 128" accessibilityLabel="Kitcount logo">
      <Defs>
        <LinearGradient id="kc-bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#14B8A6" />
          <Stop offset="1" stopColor="#0F766E" />
        </LinearGradient>
      </Defs>
      <Rect x="4" y="4" width="120" height="120" rx="30" fill="url(#kc-bg)" />
      <Rect x="30" y="34" width="68" height="64" rx="12" fill="#FFFFFF" opacity="0.18" />
      <Path d="M44 30h40a6 6 0 0 1 6 6v6H38v-6a6 6 0 0 1 6-6z" fill="#FFFFFF" opacity="0.9" />
      <Rect x="30" y="42" width="68" height="56" rx="12" fill="#FFFFFF" />
      <Path d="M46 71l11 11 24-26" fill="none" stroke="#0F766E" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
