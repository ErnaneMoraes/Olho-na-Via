import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MATERIAL_YOU_DARK_THEME, MATERIAL_YOU_THEME, THEME_IDS } from '../theme/themes';

const SETTINGS_STORAGE_KEY = '@olhonavia:settings';

const DEFAULT_SETTINGS = {
  defaultAnonymous: false,
  cameraShutterSound: false,
  darkMode: false,
  adminModeEnabled: true,
};

const AppSettingsContext = createContext(null);

export function AppSettingsProvider({ children }) {
  const [defaultAnonymous, setDefaultAnonymousState] = useState(false);
  const [cameraShutterSound, setCameraShutterSoundState] = useState(false);
  const [darkMode, setDarkModeState] = useState(false);
  const [adminModeEnabled, setAdminModeEnabledState] = useState(true);
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
          const nextDarkMode = Boolean(parsed.darkMode);
          const nextAdminMode =
            parsed.adminModeEnabled === undefined ? true : Boolean(parsed.adminModeEnabled);
          settingsRef.current = {
            defaultAnonymous: nextDefaultAnonymous,
            cameraShutterSound: nextShutterSound,
            darkMode: nextDarkMode,
            adminModeEnabled: nextAdminMode,
          };
          setDefaultAnonymousState(nextDefaultAnonymous);
          setCameraShutterSoundState(nextShutterSound);
          setDarkModeState(nextDarkMode);
          setAdminModeEnabledState(nextAdminMode);
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
    setDarkModeState(Boolean(merged.darkMode));
    setAdminModeEnabledState(
      merged.adminModeEnabled === undefined ? true : Boolean(merged.adminModeEnabled)
    );
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

  const setDarkMode = useCallback(
    (value) => persistSettings({ darkMode: Boolean(value) }),
    [persistSettings]
  );

  const toggleDarkMode = useCallback(
    () => persistSettings({ darkMode: !settingsRef.current.darkMode }),
    [persistSettings]
  );

  const setAdminModeEnabled = useCallback(
    (value) => persistSettings({ adminModeEnabled: Boolean(value) }),
    [persistSettings]
  );

  const toggleAdminMode = useCallback(
    () => persistSettings({ adminModeEnabled: !settingsRef.current.adminModeEnabled }),
    [persistSettings]
  );

  const getAdminFlags = useCallback(
    (session) => {
      const isRealAdmin = Boolean(session?.isAdmin && !session?.isDemo);
      const effectiveIsAdmin = Boolean(isRealAdmin && adminModeEnabled);
      return { isRealAdmin, effectiveIsAdmin };
    },
    [adminModeEnabled]
  );

  const notifyDataRestored = useCallback(() => {
    setDataVersion((v) => v + 1);
  }, []);

  const activeTheme = darkMode ? MATERIAL_YOU_DARK_THEME : MATERIAL_YOU_THEME;

  const value = useMemo(
    () => ({
      themeId: THEME_IDS.MATERIAL_YOU,
      theme: activeTheme,
      colors: activeTheme.colors,
      isDark: darkMode,
      darkMode,
      setDarkMode,
      toggleDarkMode,
      shape: activeTheme.shape,
      radiusCard: activeTheme.shape.radiusCard,
      radiusButton: activeTheme.shape.radiusButton,
      radiusInput: activeTheme.shape.radiusInput,
      borderWidth: activeTheme.shape.borderWidth,
      cardShadow: activeTheme.cardShadow,
      typography: activeTheme.typography,
      isMaterialYouTheme: true,
      isGoogleMapsTheme: true,
      settings: {
        defaultAnonymous,
        cameraShutterSound,
        darkMode,
        adminModeEnabled,
      },
      defaultAnonymous,
      setDefaultAnonymous,
      postAnonymously: defaultAnonymous,
      setPostAnonymously: setDefaultAnonymous,
      cameraShutterSound,
      setCameraShutterSound,
      adminModeEnabled,
      setAdminModeEnabled,
      toggleAdminMode,
      getAdminFlags,
      dataVersion,
      notifyDataRestored,
      isSettingsReady,
    }),
    [
      activeTheme,
      darkMode,
      setDarkMode,
      toggleDarkMode,
      defaultAnonymous,
      setDefaultAnonymous,
      cameraShutterSound,
      setCameraShutterSound,
      adminModeEnabled,
      setAdminModeEnabled,
      toggleAdminMode,
      getAdminFlags,
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
