import { FontAwesome6 } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
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
  SaveButton,
  SecondaryButton,
} from '../../components/common/Buttons';
import { useAppSettings } from '../context/AppSettingsContext';
import { recordAppErrorLog } from '../services/diagnosticLogService';
import { deleteTempPhoto, processPotholePhoto } from '../services/potholeMediaService';

function pickWebImageFile() {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.onchange = () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () =>
        resolve({ uri: objectUrl, width: img.naturalWidth || 1080, height: img.naturalHeight || 720 });
      img.onerror = () => resolve({ uri: objectUrl, width: 1080, height: 720 });
      img.src = objectUrl;
    };

    input.oncancel = () => {
      cleanup();
      resolve(null);
    };

    document.body.appendChild(input);
    input.click();
  });
}

export function PotholeCameraModal({
  visible,
  onClose,
  onPhotoConfirmed,
  guideText = 'Enquadre o buraco na via',
  previewTitle = 'Confirmar Foto do Buraco',
}) {
  const insets = useSafeAreaInsets();
  const { colors, radiusCard, radiusButton, borderWidth, cardShadow } = useAppSettings();

  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const isWeb = Platform.OS === 'web';
  const topSafeOffset =
    Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 12) + 8;

  useEffect(() => {
    if (!visible) {
      setCapturedPhoto(null);
      setIsCapturing(false);
      setIsProcessing(false);
      setErrorMsg('');
      return;
    }

    if (!isWeb && permission && !permission.granted && permission.canAskAgain) {
      requestPermission().catch(() => {});
    }
  }, [visible, isWeb, permission, requestPermission]);

  const handleCancel = async () => {
    if (isProcessing) return;
    if (capturedPhoto?.uri) {
      await deleteTempPhoto(capturedPhoto.uri);
    }
    setCapturedPhoto(null);
    setErrorMsg('');
    onClose();
  };

  const handleCapture = async () => {
    if (!cameraRef.current || isCapturing || isProcessing) return;
    setErrorMsg('');
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
      });
      if (photo?.uri) {
        setCapturedPhoto(photo);
      } else {
        setErrorMsg('Não foi possível capturar a foto. Tente novamente.');
      }
    } catch (err) {
      await recordAppErrorLog('PotholeCameraModal.capture', err);
      setErrorMsg('Erro ao acionar a câmera. Tente novamente.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handlePickWebFile = async () => {
    if (isProcessing) return;
    setErrorMsg('');
    const picked = await pickWebImageFile();
    if (picked?.uri) {
      setCapturedPhoto(picked);
    }
  };

  const handleRetake = async () => {
    if (isProcessing) return;
    if (capturedPhoto?.uri) {
      await deleteTempPhoto(capturedPhoto.uri);
    }
    setCapturedPhoto(null);
    setErrorMsg('');
  };

  const handleConfirmPhoto = async () => {
    if (!capturedPhoto?.uri || isProcessing) return;
    setErrorMsg('');
    setIsProcessing(true);
    try {
      const processedMedia = await processPotholePhoto(capturedPhoto.uri, {
        width: capturedPhoto.width,
        height: capturedPhoto.height,
      });
      setCapturedPhoto(null);
      onPhotoConfirmed(processedMedia);
    } catch (err) {
      await recordAppErrorLog('PotholeCameraModal.process', err);
      setErrorMsg('Falha ao otimizar a imagem. Tente capturar ou escolher outra foto.');
    } finally {
      setIsProcessing(false);
    }
  };

  const renderPermissionState = () => {
    if (!permission && !isWeb) {
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
            <FontAwesome6 name={isWeb ? 'image' : 'camera'} size={26} color={colors.primary} />
          </View>
          <Text style={[styles.gateTitle, { color: colors.text }]}>
            {isWeb ? 'Enviar foto do buraco' : 'Acesso à câmera necessário'}
          </Text>
          <Text style={[styles.gateBody, { color: colors.textSecondary }]}>
            {isWeb
              ? 'Selecione uma imagem do seu computador ou ative sua webcam para registrar a ocorrência no mapa.'
              : 'Para registrar um buraco no Olho na Via, precisamos usar a câmera do seu celular e anexar uma foto atual da via.'}
          </Text>

          <View style={styles.gateActions}>
            {isWeb ? (
              <>
                <PrimaryButton
                  label="Escolher Foto do Computador"
                  icon="image"
                  onPress={handlePickWebFile}
                />
                {permission?.canAskAgain !== false ? (
                  <SecondaryButton
                    label="Usar Webcam"
                    icon="camera"
                    onPress={requestPermission}
                  />
                ) : null}
              </>
            ) : permission?.canAskAgain ? (
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

  const renderPreviewMode = () => (
    <View style={[styles.cameraContainer, { backgroundColor: colors.background }]}>
      <Image source={{ uri: capturedPhoto.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />

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
        <View style={styles.topOverlayBar}>
          <Pressable
            onPress={handleCancel}
            disabled={isProcessing}
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
            <FontAwesome6 name="image" size={13} color={colors.primary} />
            <Text style={[styles.guideText, { color: colors.text }]}>{previewTitle}</Text>
          </View>

          <View style={styles.hudSpacer} />
        </View>

        <View style={styles.previewBottomWrap}>
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

          <View
            style={[
              SharedStyles.contentContainer,
              styles.previewActionCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <SecondaryButton
              label={isWeb ? 'Trocar Foto' : 'Tirar Outra'}
              icon="rotate"
              onPress={handleRetake}
              disabled={isProcessing}
              style={styles.previewBtn}
            />
            <SaveButton
              label={isProcessing ? 'Otimizando...' : 'Usar Foto'}
              icon="check"
              onPress={handleConfirmPhoto}
              loading={isProcessing}
              style={styles.previewBtn}
            />
          </View>
        </View>
      </View>
    </View>
  );

  const renderLiveCamera = () => (
    <View style={styles.cameraContainer}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash={flashEnabled ? 'on' : 'off'}
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
            <Text style={[styles.guideText, { color: colors.text }]}>{guideText}</Text>
          </View>

          {!isWeb ? (
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
            {isWeb ? (
              <SecondaryButton
                compact
                label="Arquivo"
                icon="image"
                onPress={handlePickWebFile}
              />
            ) : null}

            <Pressable
              onPress={handleCapture}
              disabled={isCapturing}
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
                {isCapturing ? (
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
      {capturedPhoto
        ? renderPreviewMode()
        : permission?.granted
          ? renderLiveCamera()
          : renderPermissionState()}
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
  topOverlayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
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
