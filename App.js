import { FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AppSettingsProvider, useAppSettings } from './src/context/AppSettingsContext';
import { AuthScreen } from './src/screens/AuthScreen';
import { MapHomeScreen } from './src/screens/MapHomeScreen';
import { ONBOARDING_STORAGE_KEY, OnboardingScreen } from './src/screens/OnboardingScreen';
import { authService } from './src/services/authService';

function AppRootContent() {
  const { colors, isDark, isSettingsReady, defaultAnonymous, setDefaultAnonymous } =
    useAppSettings();
  const [session, setSession] = useState(null);
  const [authInitialMode, setAuthInitialMode] = useState('login');
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const bgHex = isDark ? '#121417' : '#F7F9FC';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', bgHex);
    }
    if (document.body) {
      document.body.style.backgroundColor = isDark ? '#121417' : '#F1F3F4';
    }
  }, [isDark]);

  useEffect(() => {
    let active = true;
    async function hydrateAppState() {
      try {
        const [currentSession, onboardingFlag] = await Promise.all([
          authService.getCurrentSession(),
          AsyncStorage.getItem(ONBOARDING_STORAGE_KEY),
        ]);
        if (active) {
          setSession(currentSession);
          setOnboardingDone(onboardingFlag === 'true');
        }
      } finally {
        if (active) setBootReady(true);
      }
    }
    hydrateAppState();
    return () => {
      active = false;
    };
  }, []);

  const handleSetAnonymousMode = useCallback(
    async (nextValue) => {
      const target = Boolean(nextValue);
      await setDefaultAnonymous(target);
      if (!session || session.isDemo) return;
      const updated = await authService.updateSession({ isAnonymousMode: target });
      if (updated) {
        setSession(updated);
      }
    },
    [session, setDefaultAnonymous]
  );

  const handleToggleAnonymousMode = useCallback(async () => {
    if (!session || session.isDemo) return;
    const currentMode =
      typeof session.isAnonymousMode === 'boolean' ? session.isAnonymousMode : defaultAnonymous;
    await handleSetAnonymousMode(!currentMode);
  }, [session, defaultAnonymous, handleSetAnonymousMode]);

  const handleLogout = useCallback(async () => {
    await authService.logout();
    setAuthInitialMode('login');
    setSession(null);
  }, []);

  const handleRequestCreateAccount = useCallback(async () => {
    await authService.logout();
    setAuthInitialMode('register');
    setSession(null);
  }, []);

  if (!isSettingsReady || !bootReady) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: colors.background }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Carregando Olho na Via...
        </Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {!onboardingDone ? (
        <OnboardingScreen onComplete={() => setOnboardingDone(true)} />
      ) : session ? (
        <MapHomeScreen
          session={session}
          onToggleAnonymousMode={handleToggleAnonymousMode}
          onSetAnonymousMode={handleSetAnonymousMode}
          onLogout={handleLogout}
          onRequestCreateAccount={handleRequestCreateAccount}
        />
      ) : (
        <AuthScreen
          initialMode={authInitialMode}
          onAuthenticated={(nextSession) => {
            setAuthInitialMode('login');
            setSession(nextSession);
          }}
        />
      )}
    </>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    ...FontAwesome6.font,
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const ensureMeta = (name, content) => {
      let tag = document.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', name);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };

    ensureMeta(
      'viewport',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    );
    ensureMeta('mobile-web-app-capable', 'yes');
    ensureMeta('theme-color', '#F7F9FC');

    const styleId = 'olhonavia-fa6-fonts';
    if (document.getElementById(styleId)) return;

    const rules = Object.entries(FontAwesome6.font || {})
      .map(([family, asset]) => {
        const uri = typeof asset === 'string' ? asset : asset?.uri;
        if (!uri) return '';
        return `@font-face { font-family: '${family}'; src: url('${uri}') format('truetype'); font-display: swap; }`;
      })
      .filter(Boolean)
      .join('\n');

    if (!rules) return;
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.type = 'text/css';
    styleEl.appendChild(document.createTextNode(rules));
    document.head.appendChild(styleEl);
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppSettingsProvider>
          <AppRootContent />
        </AppSettingsProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
