import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MATERIAL_YOU_THEME, THEME_IDS } from '../theme/themes';

const SETTINGS_STORAGE_KEY = '@olhonavia:settings';

const DEFAULT_SETTINGS = {
  defaultAnonymous: false,
  cameraShutterSound: false,
};

const AppSettingsContext = createContext(null);

export function AppSettingsProvider({ children }) {
  const [defaultAnonymous, setDefaultAnonymousState] = useState(false);
  const [cameraShutterSound, setCameraShutterSoundState] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [isSettingsReady, setIsSettingsReady] = useState(false);
  const settingsRef = useRef({ ...DEFAULT_SETTINGS });

  useEffect(() => {
    let active = true;
    async function hydrate() {
      try {
        const rawSettings = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!active) return;

        if (rawSettings) {
          const parsed = JSON.parse(rawSettings);
          const nextDefaultAnonymous = Boolean(parsed.defaultAnonymous);
          const nextShutterSound = Boolean(parsed.cameraShutterSound);
          settingsRef.current = {
            defaultAnonymous: nextDefaultAnonymous,
            cameraShutterSound: nextShutterSound,
          };
          setDefaultAnonymousState(nextDefaultAnonymous);
          setCameraShutterSoundState(nextShutterSound);
        }
      } catch {
        // Fallback silencioso para padrões seguros
      } finally {
        if (active) setIsSettingsReady(true);
      }
    }

    hydrate();
    return () => {
      active = false;
    };
  }, []);

  const persistSettings = useCallback(async (patch) => {
    const merged = {
      ...DEFAULT_SETTINGS,
      ...settingsRef.current,
      ...patch,
    };
    settingsRef.current = merged;
    setDefaultAnonymousState(Boolean(merged.defaultAnonymous));
    setCameraShutterSoundState(Boolean(merged.cameraShutterSound));
    try {
      await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Ignora erro de escrita pontual
    }
  }, []);

  const setDefaultAnonymous = useCallback(
    (value) => persistSettings({ defaultAnonymous: Boolean(value) }),
    [persistSettings]
  );

  const setCameraShutterSound = useCallback(
    (value) => persistSettings({ cameraShutterSound: Boolean(value) }),
    [persistSettings]
  );

  const notifyDataRestored = useCallback(() => {
    setDataVersion((v) => v + 1);
  }, []);

  const value = useMemo(
    () => ({
      themeId: THEME_IDS.MATERIAL_YOU,
      theme: MATERIAL_YOU_THEME,
      colors: MATERIAL_YOU_THEME.colors,
      isDark: false,
      shape: MATERIAL_YOU_THEME.shape,
      radiusCard: MATERIAL_YOU_THEME.shape.radiusCard,
      radiusButton: MATERIAL_YOU_THEME.shape.radiusButton,
      radiusInput: MATERIAL_YOU_THEME.shape.radiusInput,
      borderWidth: MATERIAL_YOU_THEME.shape.borderWidth,
      cardShadow: MATERIAL_YOU_THEME.cardShadow,
      typography: MATERIAL_YOU_THEME.typography,
      isMaterialYouTheme: true,
      isGoogleMapsTheme: true,
      settings: {
        defaultAnonymous,
        cameraShutterSound,
      },
      defaultAnonymous,
      setDefaultAnonymous,
      postAnonymously: defaultAnonymous,
      setPostAnonymously: setDefaultAnonymous,
      cameraShutterSound,
      setCameraShutterSound,
      dataVersion,
      notifyDataRestored,
      isSettingsReady,
    }),
    [
      defaultAnonymous,
      setDefaultAnonymous,
      cameraShutterSound,
      setCameraShutterSound,
      dataVersion,
      notifyDataRestored,
      isSettingsReady,
    ]
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) {
    throw new Error('useAppSettings deve ser usado dentro de AppSettingsProvider');
  }
  return ctx;
}
