import { useCallback, useRef } from 'react';
import { TextInput, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from 'react-native';
import { spacing } from '../theme';

/**
 * Props for a ScrollView holding text fields: when the keyboard opens, Screen shrinks and the
 * ScrollView lays out again, and this scrolls the focused field back into view with a little
 * room below it. Spread the result onto the ScrollView.
 */
export function useFocusedFieldVisible(): {
  ref: React.RefObject<ScrollView | null>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: () => void;
  scrollEventThrottle: number;
} {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);

  const onLayout = useCallback(() => {
    const field = TextInput.State.currentlyFocusedInput();
    const scroll = ref.current;
    const scrollNode = scroll?.getNativeScrollRef();
    if (!field || !scroll || !scrollNode) return;
    // Both measured in the same frame, so their difference is exact on either platform.
    scrollNode.measureInWindow((_sx, scrollTop, _sw, scrollHeight) => {
      field.measureInWindow((_x, fieldTop, _w, fieldHeight) => {
        const hiddenBelow = fieldTop + fieldHeight + spacing.lg - (scrollTop + scrollHeight);
        const hiddenAbove = scrollTop + spacing.md - fieldTop;
        if (hiddenBelow > 0) {
          scroll.scrollTo({ y: offset.current + hiddenBelow, animated: true });
        } else if (hiddenAbove > 0) {
          scroll.scrollTo({ y: Math.max(0, offset.current - hiddenAbove), animated: true });
        }
      });
    });
  }, []);

  return { ref, onScroll, onLayout, scrollEventThrottle: 16 };
}
