import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Current on-screen keyboard height (0 when hidden).
 *
 * The app draws edge-to-edge, so Android no longer resizes the window for the
 * keyboard (adjustResize is ignored) and KeyboardAvoidingView alone isn't
 * enough inside a Modal. Screens use this height to lift their content instead.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', e =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
