import { FontAwesome6 } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SharedStyles } from '../../components/StyleSheet/Styles';
import { PrimaryButton, SecondaryButton } from '../../components/common/Buttons';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import { SettingsModal } from '../../components/modals/SettingsModal';
import { LeafletMapView } from '../components/LeafletMapView';
import { NewReportModal } from '../components/NewReportModal';
import { PotholeCameraModal } from '../components/PotholeCameraModal';
import { PotholeDetailModal } from '../components/PotholeDetailModal';
import { useAppSettings } from '../context/AppSettingsContext';
import { recordDiagnosticEvent } from '../services/diagnosticLogService';
import {
  fetchPendingRepairReviews,
  fetchUnreadNotifications,
  markNotificationRead,
} from '../services/notificationService';
import { deletePotholePhotos } from '../services/potholeMediaService';
import { potholeRepository } from '../services/potholeRepository';
import { generateSeedPotholes } from '../services/potholeSeedService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { canCapturePotholePhotos } from '../utils/devicePlatform';

const GPS_TIMEOUT_MS = 10000;
const REGION_DEBOUNCE_MS = 500;
const VIEWPORT_REFETCH_THRESHOLD = 0.0025;
const WEB_FALLBACK_COORDS = { latitude: -23.5505, longitude: -46.6333 };

function getWebPositionWithTimeout(timeoutMs = GPS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('WEB_GEO_UNAVAILABLE'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

function getDefaultBoundsForCoords(coords) {
  return {
    minLat: coords.latitude - 0.012,
    maxLat: coords.latitude + 0.012,
    minLng: coords.longitude - 0.012,
    maxLng: coords.longitude + 0.012,
  };
}

function getCurrentPositionWithTimeout(timeoutMs = GPS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('GPS_TIMEOUT'));
      }
    }, timeoutMs);

    Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })
      .then((pos) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(pos);
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

export function MapHomeScreen({
  session,
  onToggleAnonymousMode,
  onLogout,
  onRequestCreateAccount,
}) {
  const insets = useSafeAreaInsets();
  const {
    colors,
    radiusCard,
    radiusButton,
    borderWidth,
    cardShadow,
    typography,
    defaultAnonymous,
    dataRefreshToken,
  } = useAppSettings();

  const leafletMapRef = useRef(null);
  const hasInitializedGpsRef = useRef(false);
  const userCoordsRef = useRef(null);
  const gpsStatusRef = useRef('loading');
  const currentBoundsRef = useRef(null);
  const lastFetchedCenterRef = useRef(null);
  const lastFetchedKeyRef = useRef('');
  const regionDebounceRef = useRef(null);
  const isDemoRef = useRef(Boolean(session?.isDemo));

  const [gpsStatus, setGpsStatus] = useState('loading'); // 'loading' | 'granted' | 'denied' | 'error'
  const [userCoords, setUserCoords] = useState(null);
  const [potholes, setPotholes] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'open' | 'fixed'
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCenteringGps, setIsCenteringGps] = useState(false);

  const [selectedPothole, setSelectedPothole] = useState(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);

  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  const [cameraContext, setCameraContext] = useState({ mode: 'new_report' });
  const [webOnlyModalVisible, setWebOnlyModalVisible] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState([]);
  const [pendingReviewNotifications, setPendingReviewNotifications] = useState([]);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [openingNotificationId, setOpeningNotificationId] = useState(null);

  const [newReportModalVisible, setNewReportModalVisible] = useState(false);
  const [draftMedia, setDraftMedia] = useState(null);
  const [pendingVerificationDraft, setPendingVerificationDraft] = useState(null);

  const refreshNotifications = useCallback(async () => {
    if (!session?.userId || session?.isDemo) {
      setUnreadNotifications([]);
      setPendingReviewNotifications([]);
      return;
    }
    const [unreadList, pendingList] = await Promise.all([
      fetchUnreadNotifications(session.userId),
      fetchPendingRepairReviews(session.userId),
    ]);
    setUnreadNotifications(Array.isArray(unreadList) ? unreadList : []);
    setPendingReviewNotifications(Array.isArray(pendingList) ? pendingList : []);
  }, [session?.userId, session?.isDemo]);

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications, dataRefreshToken]);

  useEffect(() => {
    isDemoRef.current = Boolean(session?.isDemo);
  }, [session?.isDemo]);

  const updateGpsStatus = useCallback((next) => {
    gpsStatusRef.current = next;
    setGpsStatus(next);
  }, []);

  const isAnonymousActive = session?.isDemo
    ? false
    : typeof session?.isAnonymousMode === 'boolean'
      ? session.isAnonymousMode
      : defaultAnonymous;

  const activeAuthorLabel = session?.isDemo
    ? session?.nickname || 'Visitante'
    : isAnonymousActive
      ? 'Modo Anônimo'
      : session?.nickname || 'Cidadão';

  const topSafeOffset =
    Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 12) + 8;

  const syncPotholesForBounds = useCallback(
    async (bounds, { showSpinner = false, anchorCoords = null } = {}) => {
      if (showSpinner) setIsRefreshing(true);
      try {
        const isSupabaseReady = isSupabaseConfigured();
        const coordsToUse = anchorCoords || userCoordsRef.current;
        const effectiveBounds =
          bounds ||
          currentBoundsRef.current ||
          (coordsToUse ? getDefaultBoundsForCoords(coordsToUse) : null);

        if (effectiveBounds) {
          currentBoundsRef.current = effectiveBounds;
        }

        const reports = await potholeRepository.listReports({
          bounds: effectiveBounds,
          isDemoSession: isDemoRef.current,
        });

        let combined = reports;
        if (coordsToUse && (!isSupabaseReady || (isDemoRef.current && reports.length === 0))) {
          const rawSeeds = generateSeedPotholes(coordsToUse.latitude, coordsToUse.longitude);
          const mergedSeeds = await potholeRepository.applySeedOverrides(rawSeeds);
          combined = [...reports, ...mergedSeeds];
        }

        setPotholes(combined);
        setSelectedPothole((prev) => {
          if (!prev) return null;
          return combined.find((item) => item.id === prev.id) || prev;
        });
      } finally {
        if (showSpinner) setIsRefreshing(false);
      }
    },
    []
  );

  const acquireLocationOnce = useCallback(async () => {
    updateGpsStatus('loading');

    if (Platform.OS === 'web') {
      let webCoords = null;
      try {
        const webPos = await getWebPositionWithTimeout(GPS_TIMEOUT_MS);
        if (webPos?.coords) {
          webCoords = {
            latitude: webPos.coords.latitude,
            longitude: webPos.coords.longitude,
          };
        }
      } catch {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const expoWebPos = await getCurrentPositionWithTimeout(GPS_TIMEOUT_MS);
            if (expoWebPos?.coords) {
              webCoords = {
                latitude: expoWebPos.coords.latitude,
                longitude: expoWebPos.coords.longitude,
              };
            }
          }
        } catch {
          // Usa centro padrão de fallback no desktop caso a permissão seja negada
        }
      }

      const resolvedWebCoords = webCoords || WEB_FALLBACK_COORDS;
      userCoordsRef.current = resolvedWebCoords;
      setUserCoords(resolvedWebCoords);
      updateGpsStatus('granted');
      lastFetchedCenterRef.current = resolvedWebCoords;
      lastFetchedKeyRef.current = `${resolvedWebCoords.latitude.toFixed(4)},${resolvedWebCoords.longitude.toFixed(4)},16`;
      await syncPotholesForBounds(getDefaultBoundsForCoords(resolvedWebCoords), {
        anchorCoords: resolvedWebCoords,
      });
      await recordDiagnosticEvent(
        'GPS',
        webCoords
          ? 'Geolocalização Web obtida com sucesso'
          : 'Geolocalização Web indisponível; usando centro padrão da cidade'
      );
      return;
    }

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        updateGpsStatus('denied');
        await recordDiagnosticEvent('GPS', 'Permissão de localização negada pelo usuário');
        return;
      }

      let hasCenteredInitial = false;

      // 1. Centralização instantânea usando última posição conhecida em cache do Android
      try {
        const lastKnown = await Location.getLastKnownPositionAsync({});
        if (lastKnown?.coords) {
          const quickCoords = {
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
          };
          userCoordsRef.current = quickCoords;
          setUserCoords(quickCoords);
          updateGpsStatus('granted');
          hasCenteredInitial = true;
          lastFetchedCenterRef.current = quickCoords;
          lastFetchedKeyRef.current = `${quickCoords.latitude.toFixed(4)},${quickCoords.longitude.toFixed(4)},16`;
          await syncPotholesForBounds(getDefaultBoundsForCoords(quickCoords), {
            anchorCoords: quickCoords,
          });
        }
      } catch {
        // Continua para obtenção GPS ativa
      }

      // 2. Refinamento ativo com timeout de 10s sem bloquear ou travar o app
      try {
        const freshPos = await getCurrentPositionWithTimeout(GPS_TIMEOUT_MS);
        if (freshPos?.coords) {
          const freshCoords = {
            latitude: freshPos.coords.latitude,
            longitude: freshPos.coords.longitude,
          };
          userCoordsRef.current = freshCoords;
          setUserCoords(freshCoords);
          leafletMapRef.current?.centerOn(freshCoords.latitude, freshCoords.longitude, 16);

          if (!hasCenteredInitial) {
            updateGpsStatus('granted');
            lastFetchedCenterRef.current = freshCoords;
            lastFetchedKeyRef.current = `${freshCoords.latitude.toFixed(4)},${freshCoords.longitude.toFixed(4)},16`;
            await syncPotholesForBounds(getDefaultBoundsForCoords(freshCoords), {
              anchorCoords: freshCoords,
            });
          }
          await recordDiagnosticEvent('GPS', 'Localização GPS confirmada com sucesso');
          return;
        }
      } catch {
        // Se já centralizou via lastKnown, mantém o mapa funcionando normalmente
      }

      if (!hasCenteredInitial) {
        updateGpsStatus('error');
        await recordDiagnosticEvent('GPS', 'Não foi possível obter coordenadas GPS atuais');
      }
    } catch {
      updateGpsStatus('error');
    }
  }, [syncPotholesForBounds, updateGpsStatus]);

  // Inicializa o GPS estritamente uma única vez na montagem da tela
  useEffect(() => {
    if (hasInitializedGpsRef.current) return;
    hasInitializedGpsRef.current = true;
    acquireLocationOnce();

    return () => {
      if (regionDebounceRef.current) {
        clearTimeout(regionDebounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ao voltar das Configurações do Android apenas quando a permissão estava negada
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && gpsStatusRef.current === 'denied') {
        acquireLocationOnce();
      }
    });
    return () => sub.remove();
  }, [acquireLocationOnce]);

  const handleCenterMyLocation = useCallback(async () => {
    if (isCenteringGps) return;
    setIsCenteringGps(true);

    if (userCoordsRef.current) {
      leafletMapRef.current?.centerOn(
        userCoordsRef.current.latitude,
        userCoordsRef.current.longitude,
        16
      );
    }

    try {
      const freshPos =
        Platform.OS === 'web'
          ? await getWebPositionWithTimeout(GPS_TIMEOUT_MS)
          : await getCurrentPositionWithTimeout(GPS_TIMEOUT_MS);
      if (freshPos?.coords) {
        const freshCoords = {
          latitude: freshPos.coords.latitude,
          longitude: freshPos.coords.longitude,
        };
        userCoordsRef.current = freshCoords;
        setUserCoords(freshCoords);
        leafletMapRef.current?.centerOn(freshCoords.latitude, freshCoords.longitude, 16);
      }
    } catch {
      // Mantém centralizado na última posição conhecida sem recarregar a tela
    } finally {
      setIsCenteringGps(false);
    }
  }, [isCenteringGps]);

  const filterCounts = useMemo(() => {
    let open = 0;
    let fixed = 0;
    for (const item of potholes) {
      if (item.status === 'fixed') fixed += 1;
      else open += 1;
    }
    return { all: potholes.length, open, fixed };
  }, [potholes]);

  const filteredPotholes = useMemo(() => {
    if (statusFilter === 'open') {
      return potholes.filter((item) => item.status !== 'fixed');
    }
    if (statusFilter === 'fixed') {
      return potholes.filter((item) => item.status === 'fixed');
    }
    return potholes;
  }, [potholes, statusFilter]);

  const handleRegionChange = useCallback(
    (payload) => {
      if (!payload?.bounds || !payload?.center) return;
      currentBoundsRef.current = payload.bounds;

      if (regionDebounceRef.current) {
        clearTimeout(regionDebounceRef.current);
      }

      regionDebounceRef.current = setTimeout(() => {
        const { center, zoom, bounds } = payload;
        const roundedKey = `${Number(center.lat).toFixed(4)},${Number(center.lng).toFixed(4)},${zoom}`;
        if (roundedKey === lastFetchedKeyRef.current) return;

        if (!isDemoRef.current && isSupabaseConfigured() && lastFetchedCenterRef.current) {
          const dLat = Math.abs(center.lat - lastFetchedCenterRef.current.latitude);
          const dLng = Math.abs(center.lng - lastFetchedCenterRef.current.longitude);
          if (dLat > VIEWPORT_REFETCH_THRESHOLD || dLng > VIEWPORT_REFETCH_THRESHOLD) {
            lastFetchedKeyRef.current = roundedKey;
            lastFetchedCenterRef.current = {
              latitude: center.lat,
              longitude: center.lng,
            };
            syncPotholesForBounds(bounds);
          }
        }
      }, REGION_DEBOUNCE_MS);
    },
    [syncPotholesForBounds]
  );

  const handleManualRefresh = useCallback(() => {
    if (isRefreshing) return;
    syncPotholesForBounds(currentBoundsRef.current, {
      showSpinner: true,
      anchorCoords: userCoordsRef.current,
    });
    refreshNotifications();
  }, [isRefreshing, syncPotholesForBounds, refreshNotifications]);

  const handleOpenNotification = useCallback(
    async (item) => {
      if (!item?.pothole_id || openingNotificationId) return;
      setOpeningNotificationId(item.id);
      try {
        await markNotificationRead(item.id);
        setUnreadNotifications((prev) => prev.filter((n) => n.id !== item.id));

        let target = potholes.find((p) => p.id === item.pothole_id) || null;
        if (!target) {
          target = await potholeRepository.getReportById(item.pothole_id);
          if (target) {
            setPotholes((prev) =>
              prev.some((p) => p.id === target.id) ? prev : [target, ...prev]
            );
          }
        }

        setNotificationsVisible(false);

        if (target) {
          leafletMapRef.current?.centerOn(target.latitude, target.longitude, 17);
          setSelectedPothole(target);
          setPendingVerificationDraft(null);
          setTimeout(() => {
            setDetailModalVisible(true);
          }, Platform.OS === 'web' ? 40 : 160);
        }
      } finally {
        setOpeningNotificationId(null);
      }
    },
    [openingNotificationId, potholes]
  );

  const handleMarkerPressById = useCallback(
    (markerId) => {
      const found = potholes.find((item) => item.id === markerId);
      if (!found) return;
      setSelectedPothole(found);
      setPendingVerificationDraft(null);
      setDetailModalVisible(true);
    },
    [potholes]
  );

  const handleOpenReportCamera = useCallback(() => {
    if (isDemoRef.current) return;
    if (!canCapturePotholePhotos()) {
      setDetailModalVisible(false);
      setWebOnlyModalVisible(true);
      return;
    }
    if (!userCoordsRef.current) return;
    setDetailModalVisible(false);
    setCameraContext({ mode: 'new_report' });
    setCameraModalVisible(true);
  }, []);

  const handleStartVerification = useCallback((pothole, nextStatus) => {
    if (isDemoRef.current) return;
    if (!canCapturePotholePhotos()) {
      setDetailModalVisible(false);
      setWebOnlyModalVisible(true);
      return;
    }
    setDetailModalVisible(false);
    setCameraContext({
      mode: 'verification',
      pothole,
      nextStatus,
    });
    setCameraModalVisible(true);
  }, []);

  const handleCameraClose = useCallback(() => {
    setCameraModalVisible(false);
    if (cameraContext.mode === 'verification' && selectedPothole) {
      setDetailModalVisible(true);
    }
  }, [cameraContext, selectedPothole]);

  const handlePhotoConfirmed = useCallback(
    (media) => {
      setCameraModalVisible(false);
      if (cameraContext.mode === 'verification') {
        setPendingVerificationDraft({
          nextStatus: cameraContext.nextStatus,
          media,
        });
        setDetailModalVisible(true);
      } else {
        setDraftMedia(media);
        setNewReportModalVisible(true);
      }
    },
    [cameraContext]
  );

  const handleRetakeFromReport = useCallback(async () => {
    if (draftMedia) {
      await deletePotholePhotos(draftMedia.thumbUri, draftMedia.fullUri);
    }
    setDraftMedia(null);
    setNewReportModalVisible(false);
    setCameraContext({ mode: 'new_report' });
    setCameraModalVisible(true);
  }, [draftMedia]);

  const handleReportPublished = useCallback((newReport) => {
    setNewReportModalVisible(false);
    setDraftMedia(null);
    setPotholes((prev) => [newReport, ...prev]);
    setSelectedPothole(newReport);
    setPendingVerificationDraft(null);
    setDetailModalVisible(true);
    leafletMapRef.current?.centerOn(newReport.latitude, newReport.longitude, 17);
  }, []);

  const handleVerificationSaved = useCallback(
    (updatedPothole) => {
      setPendingVerificationDraft(null);
      setSelectedPothole(updatedPothole);
      setPotholes((prev) =>
        prev.map((item) => (item.id === updatedPothole.id ? updatedPothole : item))
      );
      refreshNotifications();
    },
    [refreshNotifications]
  );

  const handleAdminPotholeDeleted = useCallback((deletedId) => {
    setDetailModalVisible(false);
    setSelectedPothole(null);
    setPendingVerificationDraft(null);
    setPotholes((prev) => prev.filter((item) => item.id !== deletedId));
  }, []);

  const handleAdminUpdateDeleted = useCallback((potholeId, deletedUpdateId) => {
    const stripUpdate = (item) => {
      if (item.id !== potholeId) return item;
      const nextVerifs = Array.isArray(item.verifications)
        ? item.verifications.filter((v) => v.id !== deletedUpdateId)
        : [];
      return { ...item, verifications: nextVerifs };
    };
    setPotholes((prev) => prev.map(stripUpdate));
    setSelectedPothole((prev) => (prev ? stripUpdate(prev) : null));
  }, []);

  const renderFloatingTopBar = () => (
    <View
      pointerEvents="box-none"
      style={[
        styles.topBarWrapper,
        {
          top: topSafeOffset,
        },
      ]}
    >
      <View
        style={[
          SharedStyles.contentContainer,
          styles.topBar,
          cardShadow,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth,
            borderRadius: radiusCard,
          },
        ]}
      >
        <Pressable
          onPress={session?.isDemo ? undefined : onToggleAnonymousMode}
          disabled={Boolean(session?.isDemo)}
          android_ripple={session?.isDemo ? undefined : { color: colors.accentSoft }}
          style={[
            styles.identityPill,
            {
              backgroundColor: session?.isDemo
                ? colors.surfaceMuted
                : isAnonymousActive
                  ? colors.surfaceMuted
                  : colors.accentSoft,
              borderRadius: radiusButton,
            },
          ]}
        >
          <FontAwesome6
            name={
              session?.isDemo ? 'eye' : isAnonymousActive ? 'user-secret' : 'user-check'
            }
            size={14}
            color={
              session?.isDemo
                ? colors.textSecondary
                : isAnonymousActive
                  ? colors.textSecondary
                  : colors.primary
            }
          />
          <Text
            numberOfLines={1}
            style={[
              styles.identityText,
              {
                color: session?.isDemo
                  ? colors.text
                  : isAnonymousActive
                    ? colors.text
                    : colors.primary,
              },
            ]}
          >
            {activeAuthorLabel}
          </Text>
          {session?.isDemo ? (
            <View style={[styles.demoBadge, { backgroundColor: colors.warningSoft }]}>
              <Text style={[styles.demoBadgeText, { color: colors.warningText }]}>DEMO</Text>
            </View>
          ) : null}
        </Pressable>

        <View style={styles.topActions}>
          {gpsStatus === 'granted' ? (
            <Pressable
              onPress={handleManualRefresh}
              disabled={isRefreshing}
              accessibilityLabel="Atualizar mapa"
              style={[
                styles.iconActionBtn,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderRadius: radiusButton,
                },
              ]}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <FontAwesome6 name="rotate" size={15} color={colors.primary} />
              )}
            </Pressable>
          ) : null}

          {session && !session.isDemo ? (
            <Pressable
              onPress={() => {
                refreshNotifications();
                setNotificationsVisible(true);
              }}
              accessibilityLabel="Abrir Notificações"
              style={[
                styles.iconActionBtn,
                {
                  backgroundColor:
                    unreadNotifications.length > 0 ? colors.accentSoft : colors.surfaceMuted,
                  borderRadius: radiusButton,
                },
              ]}
            >
              <FontAwesome6
                name="bell"
                size={15}
                color={unreadNotifications.length > 0 ? colors.primary : colors.text}
              />
              {unreadNotifications.length > 0 ? (
                <View style={[styles.notifBadge, { backgroundColor: colors.danger }]}>
                  <Text style={styles.notifBadgeText}>
                    {unreadNotifications.length > 9 ? '9+' : unreadNotifications.length}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => setSettingsVisible(true)}
            accessibilityLabel="Abrir Configurações"
            style={[
              styles.iconActionBtn,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: radiusButton,
              },
            ]}
          >
            <FontAwesome6 name="gear" size={16} color={colors.text} />
          </Pressable>

          <Pressable
            onPress={() => setLogoutModalVisible(true)}
            accessibilityLabel="Sair da conta"
            style={[
              styles.iconActionBtn,
              {
                backgroundColor: colors.dangerSoft,
                borderRadius: radiusButton,
              },
            ]}
          >
            <FontAwesome6 name="right-from-bracket" size={16} color={colors.danger} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderFilterBar = () => {
    const filterOptions = [
      { id: 'all', label: `Todos (${filterCounts.all})`, icon: 'layer-group' },
      { id: 'open', label: `Abertos (${filterCounts.open})`, icon: 'triangle-exclamation' },
      { id: 'fixed', label: `Tampados (${filterCounts.fixed})`, icon: 'circle-check' },
    ];

    return (
      <View
        pointerEvents="box-none"
        style={[
          styles.filterBarWrapper,
          {
            top: topSafeOffset + 64,
          },
        ]}
      >
        <View style={[SharedStyles.contentContainer, styles.filterRow]}>
          {filterOptions.map((opt) => {
            const active = statusFilter === opt.id;
            const activeBg =
              opt.id === 'open'
                ? colors.danger
                : opt.id === 'fixed'
                  ? colors.success
                  : colors.primary;
            const inactiveIconColor =
              opt.id === 'open'
                ? colors.danger
                : opt.id === 'fixed'
                  ? colors.success
                  : colors.primary;

            return (
              <Pressable
                key={opt.id}
                onPress={() => setStatusFilter(opt.id)}
                style={[
                  styles.filterPill,
                  cardShadow,
                  {
                    backgroundColor: active ? activeBg : colors.card,
                    borderColor: active ? activeBg : colors.border,
                    borderWidth,
                    borderRadius: radiusButton,
                  },
                ]}
              >
                <FontAwesome6
                  name={opt.icon}
                  size={12}
                  color={active ? '#FFFFFF' : inactiveIconColor}
                />
                <Text
                  style={[
                    styles.filterPillText,
                    {
                      color: active ? '#FFFFFF' : colors.text,
                      fontVariant: typography.fontVariant,
                    },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  if (gpsStatus === 'loading') {
    return (
      <View style={[styles.gateRoot, { backgroundColor: colors.background }]}>
        {renderFloatingTopBar()}
        <View
          style={[
            SharedStyles.contentContainer,
            styles.gateCard,
            cardShadow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth,
              borderRadius: radiusCard,
            },
          ]}
        >
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.gateTitle, { color: colors.text }]}>
            Obtendo sua localização...
          </Text>
          <Text style={[styles.gateBody, { color: colors.textSecondary }]}>
            Estamos centralizando o mapa gratuito na sua cidade e carregando as ocorrências
            próximas.
          </Text>
        </View>
        <SettingsModal
        visible={settingsVisible}
        session={session}
        onModerationChange={handleManualRefresh}
        onClose={() => setSettingsVisible(false)}
      />
        <ConfirmModal
          visible={logoutModalVisible}
          title="Sair da conta?"
          message="Você retornará para a tela de entrada do Olho na Via."
          icon="right-from-bracket"
          confirmLabel="Sair"
          danger
          onConfirm={() => {
            setLogoutModalVisible(false);
            onLogout();
          }}
          onCancel={() => setLogoutModalVisible(false)}
        />
      </View>
    );
  }

  if (gpsStatus === 'denied' || gpsStatus === 'error' || !userCoords) {
    const isDenied = gpsStatus === 'denied';
    return (
      <View style={[styles.gateRoot, { backgroundColor: colors.background }]}>
        {renderFloatingTopBar()}
        <View
          style={[
            SharedStyles.contentContainer,
            styles.gateCard,
            cardShadow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth,
              borderRadius: radiusCard,
            },
          ]}
        >
          <View style={[styles.gateIconCircle, { backgroundColor: colors.warningSoft }]}>
            <FontAwesome6 name="location-crosshairs" size={26} color={colors.warning} />
          </View>
          <Text style={[styles.gateTitle, { color: colors.text }]}>
            {isDenied
              ? 'Permissão de localização necessária'
              : 'Não foi possível localizar o GPS'}
          </Text>
          <Text style={[styles.gateBody, { color: colors.textSecondary }]}>
            {isDenied
              ? 'O Olho na Via precisa acessar sua localização em primeiro plano para exibir os buracos da sua cidade e posicionar novos relatos com precisão.'
              : 'Verifique se o GPS do aparelho está ativado e tente novamente para carregar o mapa da sua região.'}
          </Text>

          <View style={styles.gateButtons}>
            <PrimaryButton
              label="Tentar novamente"
              icon="rotate"
              onPress={acquireLocationOnce}
            />
            {Platform.OS !== 'web' ? (
              <SecondaryButton
                label="Abrir Configurações do Android"
                icon="sliders"
                onPress={() => Linking.openSettings()}
              />
            ) : null}
          </View>
        </View>

        <SettingsModal
        visible={settingsVisible}
        session={session}
        onModerationChange={handleManualRefresh}
        onClose={() => setSettingsVisible(false)}
      />
        <ConfirmModal
          visible={logoutModalVisible}
          title="Sair da conta?"
          message="Você retornará para a tela de entrada do Olho na Via."
          icon="right-from-bracket"
          confirmLabel="Sair"
          danger
          onConfirm={() => {
            setLogoutModalVisible(false);
            onLogout();
          }}
          onCancel={() => setLogoutModalVisible(false)}
        />
      </View>
    );
  }

  const cameraGuideText =
    cameraContext.mode === 'verification'
      ? cameraContext.nextStatus === 'fixed'
        ? 'Fotografe o trecho tampado'
        : 'Confirme que o buraco segue aberto'
      : 'Enquadre o buraco na via';

  const cameraPreviewTitle =
    cameraContext.mode === 'verification'
      ? 'Confirmar Foto da Verificação'
      : 'Confirmar Foto do Buraco';

  return (
    <View style={[styles.mapRoot, { backgroundColor: colors.background }]}>
      <LeafletMapView
        ref={leafletMapRef}
        initialCenter={userCoords}
        userLocation={userCoords}
        markers={filteredPotholes}
        selectedId={detailModalVisible ? selectedPothole?.id : null}
        onMarkerPress={handleMarkerPressById}
        onRegionChange={handleRegionChange}
      />

      {renderFloatingTopBar()}
      {renderFilterBar()}

      {/* Botão flutuante manual "Minha Localização" */}
      <Pressable
        onPress={handleCenterMyLocation}
        disabled={isCenteringGps}
        accessibilityLabel="Minha Localização"
        android_ripple={{ color: colors.accentSoft }}
        style={[
          styles.myLocationFab,
          cardShadow,
          {
            bottom: Math.max(20, insets.bottom + 16) + (session?.isDemo ? 74 : 62),
            right: 16,
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth,
            borderRadius: radiusButton,
          },
        ]}
      >
        {isCenteringGps ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <FontAwesome6 name="location-crosshairs" size={18} color={colors.primary} />
        )}
      </Pressable>

      {/* Rodapé principal: Modo Demo somente leitura ou FAB Reportar Buraco */}
      {session?.isDemo ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.demoReadOnlyWrapper,
            {
              bottom: Math.max(16, insets.bottom + 12),
            },
          ]}
        >
          <View
            style={[
              SharedStyles.contentContainer,
              styles.demoReadOnlyBar,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <FontAwesome6 name="lock" size={15} color={colors.primary} />
            <View style={styles.demoReadOnlyTextWrap}>
              <Text numberOfLines={2} style={[styles.demoReadOnlyText, { color: colors.text }]}>
                Modo Demonstração (Somente Leitura) — Crie uma conta para registrar
              </Text>
            </View>
            <PrimaryButton
              compact
              label="Criar Conta"
              icon="user-plus"
              onPress={() => onRequestCreateAccount?.()}
            />
          </View>
        </View>
      ) : (
        <Pressable
          onPress={handleOpenReportCamera}
          android_ripple={{ color: colors.accentSoft }}
          style={({ pressed }) => [
            styles.fab,
            cardShadow,
            {
              bottom: Math.max(20, insets.bottom + 16),
              right: 16,
              backgroundColor: colors.primary,
              borderRadius: radiusButton,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <FontAwesome6 name="plus" size={16} color={colors.primaryText} />
          <Text
            style={[
              styles.fabLabel,
              { color: colors.primaryText, fontWeight: typography.labelWeight },
            ]}
          >
            Reportar Buraco
          </Text>
        </Pressable>
      )}

      <SettingsModal
        visible={settingsVisible}
        session={session}
        onModerationChange={handleManualRefresh}
        onClose={() => setSettingsVisible(false)}
      />

      <ConfirmModal
        visible={logoutModalVisible}
        title="Sair da conta?"
        message="Você deseja encerrar sua sessão atual no Olho na Via?"
        icon="right-from-bracket"
        confirmLabel="Sair"
        danger
        onConfirm={() => {
          setLogoutModalVisible(false);
          onLogout();
        }}
        onCancel={() => setLogoutModalVisible(false)}
      />

      <PotholeCameraModal
        visible={cameraModalVisible}
        fallbackCoords={userCoords}
        guideText={cameraGuideText}
        previewTitle={cameraPreviewTitle}
        onClose={handleCameraClose}
        onPhotoConfirmed={handlePhotoConfirmed}
      />

      <NewReportModal
        visible={newReportModalVisible}
        capturedMedia={draftMedia}
        session={session}
        initialAnonymous={isAnonymousActive}
        fallbackCoords={userCoords}
        onClose={() => {
          setNewReportModalVisible(false);
          setDraftMedia(null);
        }}
        onRetakePhoto={handleRetakeFromReport}
        onReportPublished={handleReportPublished}
      />

      <PotholeDetailModal
        visible={detailModalVisible}
        pothole={selectedPothole}
        session={session}
        initialAnonymous={isAnonymousActive}
        pendingVerificationDraft={pendingVerificationDraft}
        pendingReviewNotification={
          pendingReviewNotifications.find((n) => n.pothole_id === selectedPothole?.id) || null
        }
        onClose={() => {
          setDetailModalVisible(false);
          setPendingVerificationDraft(null);
        }}
        onStartVerification={handleStartVerification}
        onCancelVerificationDraft={() => setPendingVerificationDraft(null)}
        onVerificationSaved={handleVerificationSaved}
        onAuthorReviewCompleted={refreshNotifications}
        onAdminPotholeDeleted={handleAdminPotholeDeleted}
        onAdminUpdateDeleted={handleAdminUpdateDeleted}
      />

      <Modal
        visible={notificationsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNotificationsVisible(false)}
      >
        <View style={[styles.webNoticeOverlay, { backgroundColor: colors.overlay }]}>
          <View
            style={[
              SharedStyles.contentContainer,
              styles.notifSheetCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
                maxHeight: Platform.OS === 'web' ? '88dvh' : '82%',
              },
            ]}
          >
            <View style={styles.notifHeader}>
              <View style={styles.notifHeaderLeft}>
                <FontAwesome6 name="bell" size={16} color={colors.primary} />
                <Text style={[styles.notifTitle, { color: colors.text }]}>
                  Notificações ({unreadNotifications.length})
                </Text>
              </View>
              <Pressable
                onPress={() => setNotificationsVisible(false)}
                hitSlop={10}
                accessibilityLabel="Fechar notificações"
                style={[styles.notifCloseBtn, { backgroundColor: colors.surfaceMuted }]}
              >
                <FontAwesome6 name="xmark" size={15} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.notifListContent}
            >
              {unreadNotifications.length === 0 ? (
                <View
                  style={[
                    styles.notifEmptyBox,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: radiusCard,
                    },
                  ]}
                >
                  <FontAwesome6 name="circle-check" size={20} color={colors.success} />
                  <Text style={[styles.notifEmptyText, { color: colors.textSecondary }]}>
                    Nenhuma notificação pendente.
                  </Text>
                </View>
              ) : (
                unreadNotifications.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => handleOpenNotification(item)}
                    disabled={openingNotificationId === item.id}
                    style={({ pressed }) => [
                      styles.notifItemCard,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.primary,
                        borderWidth: 1,
                        borderRadius: radiusCard,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <View style={styles.notifItemTop}>
                      <View style={[styles.notifTypePill, { backgroundColor: colors.accentSoft }]}>
                        <FontAwesome6 name="circle-check" size={11} color={colors.primary} />
                        <Text style={[styles.notifTypeText, { color: colors.primary }]}>
                          Revisão solicitada
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.notifDate,
                          { color: colors.textMuted, fontVariant: typography.fontVariant },
                        ]}
                      >
                        {item.createdAtFormatted}
                      </Text>
                    </View>
                    <Text style={[styles.notifItemTitle, { color: colors.text }]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.notifItemBody, { color: colors.textSecondary }]}>
                      {item.body}
                    </Text>
                    <Text style={[styles.notifItemAction, { color: colors.primary }]}>
                      {openingNotificationId === item.id
                        ? 'Abrindo relato...'
                        : 'Toque para abrir e avaliar'}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={webOnlyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWebOnlyModalVisible(false)}
      >
        <View style={[styles.webNoticeOverlay, { backgroundColor: colors.overlay }]}>
          <View
            style={[
              SharedStyles.contentContainer,
              styles.webNoticeCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <View style={[styles.webNoticeIcon, { backgroundColor: colors.accentSoft }]}>
              <FontAwesome6 name="mobile-screen-button" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.webNoticeTitle, { color: colors.text }]}>
              Registro exclusivo pelo celular
            </Text>
            <Text style={[styles.webNoticeBody, { color: colors.textSecondary }]}>
              Relatos e fotos de buracos não podem ser enviados a partir de um computador ou
              notebook. Para registrar com a câmera traseira no local, acesse o Olho na Via pelo
              navegador do seu smartphone.
            </Text>
            <Text style={[styles.webNoticeHighlight, { color: colors.primary }]}>
              O link oficial para baixar o aplicativo Android será disponibilizado em breve.
            </Text>
            <PrimaryButton
              label="Entendi"
              icon="check"
              onPress={() => setWebOnlyModalVisible(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  mapRoot: {
    flex: 1,
  },
  gateRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  gateCard: {
    padding: 24,
    alignItems: 'center',
    gap: 14,
  },
  gateIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateTitle: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  gateBody: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  gateButtons: {
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
  topBarWrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
  },
  identityPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  identityText: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  demoBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  demoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconActionBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  notifSheetCard: {
    padding: 18,
    gap: 12,
    width: '100%',
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notifHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notifTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  notifCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifListContent: {
    gap: 10,
    paddingBottom: 6,
  },
  notifEmptyBox: {
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  notifEmptyText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  notifItemCard: {
    padding: 13,
    gap: 6,
  },
  notifItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  notifTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 5,
  },
  notifTypeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  notifDate: {
    fontSize: 11,
  },
  notifItemTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  notifItemBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  notifItemAction: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  filterBarWrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 18,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 5,
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  myLocationFab: {
    position: 'absolute',
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  fab: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 9,
    zIndex: 15,
  },
  fabLabel: {
    fontSize: 15,
  },
  demoReadOnlyWrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 15,
  },
  demoReadOnlyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  demoReadOnlyTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  demoReadOnlyText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  webNoticeOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  webNoticeCard: {
    padding: 22,
    alignItems: 'center',
    gap: 12,
  },
  webNoticeIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webNoticeTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  webNoticeBody: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  webNoticeHighlight: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default MapHomeScreen;
