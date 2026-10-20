import React from 'react';
import { Animated } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

// Outline of the chrome swirl emblem (assets/emblem.png), traced to a vector.
const EMBLEM_PATH =
  'M 541 21.6 C 539.1 21.8, 534.1 22.4, 530 23 C 525.9 23.5, 516.9 24.7, 510 25.5 C 449.6 33, 371.7 58.6, 276.5 102.5 C 221.9 127.7, 212.4 134.3, 218.4 143.5 C 223 150.5, 247.1 158, 281.4 163 C 289 164.1, 296.2 165.3, 297.4 165.5 C 300.1 166.2, 337.2 170.2, 377 174.1 C 394.3 175.8, 410.5 177.4, 413 177.7 C 415.5 177.9, 429.7 179.3, 444.5 180.6 C 459.4 182, 472.9 183.3, 474.5 183.5 C 493.2 185.5, 509.3 187.4, 517.5 188.6 C 523 189.3, 533.8 190.9, 541.5 192 C 722.1 217.9, 859.1 284.9, 920.7 377.5 C 965.2 444.3, 965.5 537, 921.4 573.4 C 903.5 588.1, 883.8 594.3, 855 594.3 C 748.5 594.1, 573.1 505.4, 369.5 349 C 355.8 338.5, 335.6 322.6, 327 315.7 C 323.5 312.9, 316.7 307.4, 312 303.6 C 307.3 299.9, 295.6 290.1, 286 282 C 226.7 231.7, 216 223.2, 201.1 214.3 C 158.1 188.7, 115.3 201.2, 83 249 C 62.1 279.9, 45.1 327.8, 37.9 376 C 36.7 384, 35.4 393, 34.9 396 C 31.6 417.8, 31.3 477.4, 34.5 505.5 C 40.5 560.2, 48.7 602, 61.9 645.8 C 86.2 726.4, 134.5 815.7, 188.1 879.5 C 288.5 999.1, 427 1032.8, 599 979.3 C 622.4 972.1, 651.9 960.8, 691.5 944 C 717.5 933, 733 926.8, 759.1 917.1 C 797 903.1, 804.1 899.2, 805.6 891.5 C 807.4 881.9, 796 875.2, 765 867.6 C 736.2 860.6, 705.6 856.3, 633 849 C 621.7 847.9, 597.2 845.6, 578.5 844 C 519.4 838.8, 473.8 833.2, 443 827.4 C 420.4 823.2, 419 822.9, 403 819.3 C 252.3 785.6, 154.5 726, 100.7 635 C 78.1 596.9, 65.2 541.9, 71.1 509.6 C 88 417.9, 167.2 404.7, 311 469.8 C 437.3 526.9, 609 640.3, 756.6 764 C 818.7 816.1, 837.5 827, 865.3 827 C 927.6 827, 974.8 749.5, 989.2 623.5 C 990.7 610.4, 990.7 535.8, 989.2 522.5 C 988.6 517, 987.4 506.2, 986.5 498.5 C 975.2 398.8, 943 307.9, 886.3 216.2 C 860.4 174.2, 820.9 124.7, 800.8 109.1 C 798.2 107.1, 792.2 102.1, 787.3 97.9 C 771.2 84, 746.4 67.7, 725 57 C 686.2 37.5, 649.5 27.6, 595.5 22 C 588 21.2, 548.7 20.9, 541 21.6 Z';
// Measured outline length, in viewBox units; the trace animates the dash across it.
const PATH_LENGTH = 6628;

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface EmblemProps {
  size: number;
  // 0..1: how much of the outline is drawn. Omit for a finished emblem.
  draw?: Animated.Value | Animated.AnimatedInterpolation<number>;
  // 0..1: opacity of the chrome fill.
  fill?: Animated.Value | Animated.AnimatedInterpolation<number>;
}

export function Emblem({ size, draw, fill }: EmblemProps): React.JSX.Element {
  const dashOffset = draw ? draw.interpolate({ inputRange: [0, 1], outputRange: [PATH_LENGTH, 0] }) : 0;
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Defs>
        {/* Alternating bright and dark bands, like light reflected off polished silver. */}
        <LinearGradient id="chrome" x1="180" y1="60" x2="840" y2="980" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.22" stopColor="#C8CDD0" />
          <Stop offset="0.42" stopColor="#6F777B" />
          <Stop offset="0.58" stopColor="#F4F6F7" />
          <Stop offset="0.78" stopColor="#8C9498" />
          <Stop offset="1" stopColor="#E3E7E9" />
        </LinearGradient>
      </Defs>
      <AnimatedPath d={EMBLEM_PATH} fill="url(#chrome)" fillOpacity={fill ?? 1} />
      {draw ? (
        <AnimatedPath
          d={EMBLEM_PATH}
          fill="none"
          stroke="#F4F6F7"
          strokeWidth={6}
          strokeLinejoin="round"
          strokeDasharray={[PATH_LENGTH, PATH_LENGTH]}
          strokeDashoffset={dashOffset}
        />
      ) : null}
    </Svg>
  );
}
