import { FontAwesome6 } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {
  CancelButton,
  PrimaryButton,
} from '../../components/common/Buttons';
import { useAppSettings } from '../context/AppSettingsContext';
import { recordAppErrorLog } from '../services/diagnosticLogService';
import { verifyCapturedPhotoSafety } from '../services/photoSafetyService';
import { deleteTempPhoto } from '../services/potholeMediaService';
import { canCapturePotholePhotos } from '../utils/devicePlatform';
import { PhotoReviewModal } from './PhotoReviewModal';

const SHUTTER_GPS_TIMEOUT_MS = 8000;

function normalizeFallbackCoords(fallbackCoords) {
  if (
    fallbackCoords &&
    Number.isFinite(fallbackCoords.latitude) &&
    Number.isFinite(fallbackCoords.longitude)
  ) {
    return {
      latitude: fallbackCoords.latitude,
      longitude: fallbackCoords.longitude,
      accuracy: Number.isFinite(fallbackCoords.accuracy) ? fallbackCoords.accuracy : null,
      capturedAt: new Date().toISOString(),
      isFallback: true,
    };
  }
  return null;
}

async function captureFreshShutterCoords(fallbackCoords) {
  const capturedAt = new Date().toISOString();

  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (res) => resolve(res),
            (err) => reject(err),
            {
              enableHighAccuracy: true,
              maximumAge: 0,
              timeout: SHUTTER_GPS_TIMEOUT_MS,
            }
          );
        });
        if (
          pos?.coords &&
          Number.isFinite(pos.coords.latitude) &&
          Number.isFinite(pos.coords.longitude)
        ) {
          return {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
            capturedAt,
            isFallback: false,
          };
        }
      } catch {
        // Retorna fallback se Web Geolocation falhar ou exceder tempo limite
      }
    }
    return normalizeFallbackCoords(fallbackCoords);
  }

  try {
    let permissionStatus = (await Location.getForegroundPermissionsAsync())?.status;
    if (permissionStatus !== 'granted') {
      permissionStatus = (await Location.requestForegroundPermissionsAsync())?.status;
    }
    if (permissionStatus === 'granted') {
      const freshPos = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SHUTTER_GPS_TIMEOUT')), SHUTTER_GPS_TIMEOUT_MS)
        ),
      ]);

      if (
        freshPos?.coords &&
        Number.isFinite(freshPos.coords.latitude) &&
        Number.isFinite(freshPos.coords.longitude)
      ) {
        return {
          latitude: freshPos.coords.latitude,
          longitude: freshPos.coords.longitude,
          accuracy: Number.isFinite(freshPos.coords.accuracy) ? freshPos.coords.accuracy : null,
          capturedAt,
          isFallback: false,
        };
      }
    }
  } catch {
    // Usa última coordenada conhecida como fallback caso o GPS demore no clique
  }

  return normalizeFallbackCoords(fallbackCoords);
}

export function PotholeCameraModal({
  visible,
  onClose,
  onPhotoConfirmed,
  fallbackCoords = null,
  guideText = 'Enquadre o buraco na via',
  previewTitle = 'Revisar Foto do Buraco',
}) {
  const insets = useSafeAreaInsets();
  const { colors, radiusCard, radiusButton, radiusInput, borderWidth, cardShadow, settings } =
    useAppSettings();

  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing] = useState('back');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [checkingSafety, setCheckingSafety] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const isWeb = Platform.OS === 'web';
  const isDesktopBlocked = !canCapturePotholePhotos();
  const topSafeOffset =
    Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 12) + 8;

  useEffect(() => {
    if (!visible) {
      setCapturedPhoto(null);
      setIsCameraReady(false);
      setNoticeAccepted(false);
      setFlashEnabled(false);
      setIsCapturing(false);
      setCheckingSafety(false);
      setErrorMsg('');
      return;
    }

    if (!isDesktopBlocked && permission && !permission.granted && permission.canAskAgain) {
      requestPermission().catch(() => {});
    }
  }, [visible, isDesktopBlocked, permission, requestPermission]);

  const handleCancel = async () => {
    if (isCapturing || checkingSafety) return;
    if (capturedPhoto?.uri) {
      await deleteTempPhoto(capturedPhoto.uri);
    }
    setCapturedPhoto(null);
    setIsCameraReady(false);
    setNoticeAccepted(false);
    setFlashEnabled(false);
    setErrorMsg('');
    onClose();
  };

  const handleCapture = async () => {
    if (isDesktopBlocked || !cameraRef.current || isCapturing || checkingSafety) return;
    setErrorMsg('');
    setIsCapturing(true);
    try {
      const [photo, freshCoords] = await Promise.all([
        cameraRef.current.takePictureAsync({
          quality: 0.85,
          ...(isWeb ? {} : { shutterSound: Boolean(settings?.cameraShutterSound) }),
        }),
        captureFreshShutterCoords(fallbackCoords),
      ]);
      if (!photo?.uri) {
        setErrorMsg('Não foi possível capturar a foto. Tente novamente.');
        return;
      }

      setCheckingSafety(true);
      const safety = await verifyCapturedPhotoSafety(photo.uri);
      if (safety?.blocked) {
        await deleteTempPhoto(photo.uri);
        const reason =
          safety.reason ||
          'Rosto detectado na imagem. Tire uma nova foto focando apenas no buraco na via.';
        setErrorMsg(reason);
        Alert.alert('Foto bloqueada por privacidade', reason);
        return;
      }

      setIsCameraReady(false);
      setCapturedPhoto({
        ...photo,
        capturedCoords: freshCoords || normalizeFallbackCoords(fallbackCoords),
      });
    } catch (err) {
      await recordAppErrorLog('PotholeCameraModal.capture', err);
      setErrorMsg('Erro ao acionar a câmera. Tente novamente.');
    } finally {
      setCheckingSafety(false);
      setIsCapturing(false);
    }
  };

  const handleRetake = async () => {
    if (checkingSafety) return;
    if (capturedPhoto?.uri) {
      await deleteTempPhoto(capturedPhoto.uri);
    }
    setIsCameraReady(false);
    setCapturedPhoto(null);
    setErrorMsg('');
  };

  const renderDesktopBlockedState = () => (
    <View
      style={[
        styles.gateRoot,
        {
          backgroundColor: colors.background,
          paddingTop: topSafeOffset,
          paddingBottom: Math.max(20, insets.bottom + 12),
        },
      ]}
    >
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
        <View style={[styles.gateIconCircle, { backgroundColor: colors.accentSoft }]}>
          <FontAwesome6 name="mobile-screen-button" size={26} color={colors.primary} />
        </View>
        <Text style={[styles.gateTitle, { color: colors.text }]}>
          Registro exclusivo pelo celular
        </Text>
        <Text style={[styles.gateBody, { color: colors.textSecondary }]}>
          Relatos e fotos de buracos não podem ser enviados a partir de um computador ou notebook.
          Para registrar com a câmera traseira no local, acesse o Olho na Via pelo navegador do seu
          smartphone. O link oficial para baixar o aplicativo Android será disponibilizado em breve.
        </Text>
        <View style={styles.gateActions}>
          <PrimaryButton label="Entendi" icon="check" onPress={handleCancel} />
        </View>
      </View>
    </View>
  );

  const renderPermissionState = () => {
    if (!permission) {
      return (
        <View style={[styles.gateRoot, { backgroundColor: colors.background }]}>
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
              Verificando permissão da câmera...
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View
        style={[
          styles.gateRoot,
          {
            backgroundColor: colors.background,
            paddingTop: topSafeOffset,
            paddingBottom: Math.max(20, insets.bottom + 12),
          },
        ]}
      >
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
          <View style={[styles.gateIconCircle, { backgroundColor: colors.accentSoft }]}>
            <FontAwesome6 name="camera" size={26} color={colors.primary} />
          </View>
          <Text style={[styles.gateTitle, { color: colors.text }]}>
            Acesso à câmera necessário
          </Text>
          <Text style={[styles.gateBody, { color: colors.textSecondary }]}>
            Para registrar um buraco no Olho na Via, precisamos usar a câmera traseira do seu
            celular e anexar uma foto atual da via.
          </Text>

          <View style={styles.gateActions}>
            {permission?.canAskAgain ? (
              <PrimaryButton label="Permitir Câmera" icon="camera" onPress={requestPermission} />
            ) : (
              <PrimaryButton
                label="Abrir Configurações"
                icon="sliders"
                onPress={() => Linking.openSettings()}
              />
            )}
            <CancelButton label="Cancelar" onPress={handleCancel} />
          </View>
        </View>
      </View>
    );
  };

  const renderPreCaptureNotice = () => (
    <View
      style={[
        styles.gateRoot,
        {
          backgroundColor: colors.background,
          paddingTop: topSafeOffset,
          paddingBottom: Math.max(20, insets.bottom + 12),
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={[SharedStyles.contentContainer, styles.noticeScroll]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
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
            <FontAwesome6 name="shield-halved" size={26} color={colors.warning} />
          </View>
          <Text style={[styles.gateTitle, { color: colors.text }]}>
            Aviso de Responsabilidade e Privacidade
          </Text>
          <Text style={[styles.gateBody, { color: colors.textSecondary }]}>
            Fotografe apenas com o veículo parado e em local seguro. Para proteger a privacidade de
            todos, é estritamente proibido publicar:
          </Text>

          <View
            style={[
              styles.rulesBox,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: radiusInput,
              },
            ]}
          >
            <Text style={[styles.ruleItem, { color: colors.text }]}>
              • Rostos, crianças, pedestres ou selfies;
            </Text>
            <Text style={[styles.ruleItem, { color: colors.text }]}>
              • Placas de veículos visíveis;
            </Text>
            <Text style={[styles.ruleItem, { color: colors.text }]}>
              • Números de casas, fachadas ou bens identificáveis;
            </Text>
            <Text style={[styles.ruleItem, { color: colors.text }]}>
              • Conteúdo impróprio, ofensivo ou obsceno.
            </Text>
          </View>

          <View style={styles.gateActions}>
            <PrimaryButton
              label="Li e concordo — Fotografar apenas o buraco"
              icon="check"
              onPress={() => setNoticeAccepted(true)}
            />
            <CancelButton label="Cancelar" onPress={handleCancel} />
          </View>
        </View>
      </ScrollView>
    </View>
  );

  const renderLiveCamera = () => (
    <View style={styles.cameraContainer}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash={isWeb ? 'off' : flashEnabled ? 'on' : 'off'}
        enableTorch={!isWeb && isCameraReady && flashEnabled && facing === 'back'}
        onCameraReady={() => setIsCameraReady(true)}
      />

      <View
        pointerEvents="box-none"
        style={[
          StyleSheet.absoluteFill,
          styles.overlayRoot,
          {
            paddingTop: topSafeOffset,
            paddingBottom: Math.max(24, insets.bottom + 16),
          },
        ]}
      >
        <View style={styles.topHudStack}>
          <View style={styles.topOverlayBar}>
            <Pressable
              onPress={handleCancel}
              accessibilityLabel="Fechar câmera"
              style={[
                styles.hudIconBtn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusButton,
                },
              ]}
            >
              <FontAwesome6 name="xmark" size={18} color={colors.text} />
            </Pressable>

            <View
              style={[
                styles.guidePill,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusButton,
                },
              ]}
            >
              <FontAwesome6 name="road-circle-exclamation" size={13} color={colors.primary} />
              <Text numberOfLines={1} style={[styles.guideText, { color: colors.text }]}>
                {guideText}
              </Text>
            </View>

            {!isWeb && facing === 'back' ? (
              <Pressable
                onPress={() => setFlashEnabled((v) => !v)}
                accessibilityLabel="Alternar flash"
                style={[
                  styles.flashBtn,
                  {
                    backgroundColor: flashEnabled ? colors.warningSoft : colors.card,
                    borderColor: flashEnabled ? colors.warning : colors.border,
                    borderWidth,
                    borderRadius: radiusButton,
                  },
                ]}
              >
                <FontAwesome6
                  name="bolt"
                  size={14}
                  color={flashEnabled ? colors.warning : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.flashText,
                    { color: flashEnabled ? colors.warningText : colors.text },
                  ]}
                >
                  Flash
                </Text>
              </Pressable>
            ) : (
              <View style={styles.hudSpacer} />
            )}
          </View>

          <View style={[styles.privacyReminderPill, { backgroundColor: colors.overlay }]}>
            <FontAwesome6 name="shield-halved" size={11} color="#FFFFFF" />
            <Text numberOfLines={1} style={styles.privacyReminderText}>
              Fotografe apenas o buraco • Sem rostos, placas ou números
            </Text>
          </View>
        </View>

        {/* Guia de enquadramento central */}
        <View pointerEvents="none" style={styles.reticleArea}>
          <View style={styles.reticleBox}>
            <View style={[styles.corner, styles.cornerTL, { borderColor: colors.card }]} />
            <View style={[styles.corner, styles.cornerTR, { borderColor: colors.card }]} />
            <View style={[styles.corner, styles.cornerBL, { borderColor: colors.card }]} />
            <View style={[styles.corner, styles.cornerBR, { borderColor: colors.card }]} />
          </View>
          <View style={[styles.reticleHintPill, { backgroundColor: colors.overlay }]}>
            <Text style={[styles.reticleHintText, { color: '#FFFFFF' }]}>
              Centralize o buraco para melhor identificação
            </Text>
          </View>
        </View>

        <View style={styles.captureFooter}>
          {errorMsg ? (
            <View
              style={[
                styles.errorBanner,
                {
                  backgroundColor: colors.dangerSoft,
                  borderColor: colors.danger,
                  borderWidth: 1,
                  borderRadius: radiusCard,
                },
              ]}
            >
              <FontAwesome6 name="circle-exclamation" size={14} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.dangerText }]}>{errorMsg}</Text>
            </View>
          ) : null}

          <View style={styles.captureButtonsRow}>
            <Pressable
              onPress={handleCapture}
              disabled={isCapturing || checkingSafety}
              accessibilityLabel="Capturar foto do buraco"
              style={({ pressed }) => [
                styles.shutterOuter,
                {
                  borderColor: colors.card,
                  backgroundColor: colors.overlay,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View style={[styles.shutterInner, { backgroundColor: colors.primary }]}>
                {isCapturing || checkingSafety ? (
                  <ActivityIndicator size="small" color={colors.primaryText} />
                ) : (
                  <FontAwesome6 name="camera" size={24} color={colors.primaryText} />
                )}
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleCancel}>
      {isDesktopBlocked ? (
        renderDesktopBlockedState()
      ) : capturedPhoto ? (
        <PhotoReviewModal
          inline
          photo={capturedPhoto}
          title={previewTitle}
          onRetake={handleRetake}
          onCancel={handleCancel}
          onPhotoApproved={(approvedMedia) => {
            setCapturedPhoto(null);
            setNoticeAccepted(false);
            onPhotoConfirmed?.(approvedMedia);
          }}
        />
      ) : !permission?.granted ? (
        renderPermissionState()
      ) : !noticeAccepted ? (
        renderPreCaptureNotice()
      ) : (
        renderLiveCamera()
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  overlayRoot: {
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topHudStack: {
    gap: 8,
    alignItems: 'center',
  },
  topOverlayBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  privacyReminderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 6,
  },
  privacyReminderText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  noticeScroll: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  rulesBox: {
    width: '100%',
    padding: 12,
    gap: 6,
  },
  ruleItem: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  hudIconBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudSpacer: {
    width: 42,
    height: 42,
  },
  guidePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 7,
    flexShrink: 1,
  },
  guideText: {
    fontSize: 13,
    fontWeight: '700',
  },
  flashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 42,
    gap: 6,
  },
  flashText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reticleArea: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  reticleBox: {
    width: 240,
    height: 240,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 14,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 14,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 14,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 14,
  },
  reticleHintPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  reticleHintText: {
    fontSize: 12,
    fontWeight: '600',
  },
  captureFooter: {
    alignItems: 'center',
    gap: 12,
  },
  captureButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBottomWrap: {
    gap: 10,
  },
  previewActionCard: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
  },
  previewBtn: {
    flex: 1,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 11,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
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
    lineHeight: 20,
    textAlign: 'center',
  },
  gateActions: {
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
});

export default PotholeCameraModal;
