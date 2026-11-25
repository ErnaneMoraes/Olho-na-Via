import { FontAwesome6 } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
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
  SaveButton,
  SecondaryButton,
} from '../../components/common/Buttons';
import { useAppSettings } from '../context/AppSettingsContext';
import { recordAppErrorLog } from '../services/diagnosticLogService';
import {
  processPotholePhoto,
  saveProcessedPotholePhotoFromBase64,
} from '../services/potholeMediaService';

const NativeWebView =
  Platform.OS === 'web' ? null : require('react-native-webview').WebView;

function buildRedactionCanvasHtml(base64Jpeg, bars) {
  const safeBarsJson = JSON.stringify(bars || []);
  const safeSrcJson = JSON.stringify(`data:image/jpeg;base64,${base64Jpeg}`);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;">
<script>
(function() {
  function post(payload) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }
  try {
    var img = new Image();
    img.onload = function() {
      try {
        var w = img.naturalWidth || img.width || 1080;
        var h = img.naturalHeight || img.height || 720;
        var fullCanvas = document.createElement('canvas');
        fullCanvas.width = w;
        fullCanvas.height = h;
        var fCtx = fullCanvas.getContext('2d');
        fCtx.drawImage(img, 0, 0, w, h);

        var bars = ${safeBarsJson};
        fCtx.fillStyle = '#111827';
        for (var i = 0; i < bars.length; i++) {
          var b = bars[i];
          fCtx.fillRect(
            Math.round(b.x * w),
            Math.round(b.y * h),
            Math.max(4, Math.round(b.width * w)),
            Math.max(4, Math.round(b.height * h))
          );
        }

        var fullDataUrl = fullCanvas.toDataURL('image/jpeg', 0.85);
        var thumbW = Math.min(200, w);
        var thumbH = Math.max(1, Math.round((h * thumbW) / Math.max(1, w)));
        var thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = thumbW;
        thumbCanvas.height = thumbH;
        var tCtx = thumbCanvas.getContext('2d');
        tCtx.drawImage(fullCanvas, 0, 0, thumbW, thumbH);
        var thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.6);

        post({
          type: 'redacted_ready',
          fullBase64: fullDataUrl.split(',')[1] || '',
          thumbBase64: thumbDataUrl.split(',')[1] || '',
        });
      } catch (err) {
        post({ type: 'redaction_error', message: String(err && err.message || err) });
      }
    };
    img.onerror = function() {
      post({ type: 'redaction_error', message: 'Falha ao carregar imagem para aplicar tarjas.' });
    };
    img.src = ${safeSrcJson};
  } catch (e) {
    post({ type: 'redaction_error', message: String(e && e.message || e) });
  }
})();
</script>
</body>
</html>`;
}

export function PhotoReviewModal({
  visible = true,
  inline = false,
  photo,
  title = 'Revisar Foto do Buraco',
  onRetake,
  onCancel,
  onPhotoApproved,
}) {
  const insets = useSafeAreaInsets();
  const { colors, radiusCard, radiusButton, radiusInput, borderWidth, cardShadow } =
    useAppSettings();

  const [redactionBars, setRedactionBars] = useState([]);
  const [activeDraftBar, setActiveDraftBar] = useState(null);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [redactionTask, setRedactionTask] = useState(null);

  const frameSizeRef = useRef({ width: 0, height: 0 });
  const dragOriginRef = useRef(null);
  const processingRef = useRef(false);

  useEffect(() => {
    processingRef.current = processing;
  }, [processing]);

  useEffect(() => {
    setRedactionBars([]);
    setActiveDraftBar(null);
    setPrivacyConfirmed(false);
    setProcessing(false);
    setErrorMsg('');
    setRedactionTask(null);
  }, [photo?.uri, visible]);

  const topSafePadding =
    Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 12) + 8;

  const photoAspectRatio = useMemo(() => {
    const w = Number(photo?.width) || 4;
    const h = Number(photo?.height) || 3;
    return Math.min(1.8, Math.max(0.6, w / h));
  }, [photo?.width, photo?.height]);

  const toNormalizedRect = (x0, y0, x1, y1) => {
    const { width: fw, height: fh } = frameSizeRef.current;
    if (fw <= 0 || fh <= 0) return null;
    const clampedX0 = Math.max(0, Math.min(fw, x0));
    const clampedY0 = Math.max(0, Math.min(fh, y0));
    const clampedX1 = Math.max(0, Math.min(fw, x1));
    const clampedY1 = Math.max(0, Math.min(fh, y1));
    const left = Math.min(clampedX0, clampedX1) / fw;
    const top = Math.min(clampedY0, clampedY1) / fh;
    const rectW = Math.abs(clampedX1 - clampedX0) / fw;
    const rectH = Math.abs(clampedY1 - clampedY0) / fh;
    return {
      x: left,
      y: top,
      width: Math.max(0.025, Math.min(1 - left, rectW)),
      height: Math.max(0.025, Math.min(1 - top, rectH)),
    };
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !processingRef.current,
        onMoveShouldSetPanResponder: () => !processingRef.current,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          dragOriginRef.current = { x: locationX, y: locationY };
          setActiveDraftBar(toNormalizedRect(locationX, locationY, locationX + 8, locationY + 8));
        },
        onPanResponderMove: (evt) => {
          if (!dragOriginRef.current) return;
          const { locationX, locationY } = evt.nativeEvent;
          setActiveDraftBar(
            toNormalizedRect(
              dragOriginRef.current.x,
              dragOriginRef.current.y,
              locationX,
              locationY
            )
          );
        },
        onPanResponderRelease: (evt) => {
          if (!dragOriginRef.current) return;
          const { locationX, locationY } = evt.nativeEvent;
          const finalRect = toNormalizedRect(
            dragOriginRef.current.x,
            dragOriginRef.current.y,
            locationX,
            locationY
          );
          dragOriginRef.current = null;
          setActiveDraftBar(null);
          if (finalRect && finalRect.width >= 0.03 && finalRect.height >= 0.025) {
            setRedactionBars((prev) => [...prev, finalRect]);
          }
        },
        onPanResponderTerminate: () => {
          dragOriginRef.current = null;
          setActiveDraftBar(null);
        },
      }),
    []
  );

  const handleConfirm = async () => {
    if (!photo?.uri || !privacyConfirmed || processing) return;
    setErrorMsg('');
    setProcessing(true);

    try {
      if (redactionBars.length === 0 || !NativeWebView) {
        const processed = await processPotholePhoto(photo.uri, {
          width: photo.width,
          height: photo.height,
        });
        setProcessing(false);
        onPhotoApproved?.({
          ...processed,
          privacyConfirmed: true,
          redactionsCount: 0,
        });
        return;
      }

      const normalized = await ImageManipulator.manipulateAsync(
        photo.uri,
        photo.width > 1080 ? [{ resize: { width: 1080 } }] : [],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!normalized?.base64) {
        throw new Error('Não foi possível preparar a imagem para aplicar as tarjas.');
      }

      setRedactionTask({
        html: buildRedactionCanvasHtml(normalized.base64, redactionBars),
        rawUriToClean: photo.uri,
        barsCount: redactionBars.length,
      });
    } catch (err) {
      await recordAppErrorLog('PhotoReviewModal.confirm', err);
      setErrorMsg(err?.message || 'Falha ao processar a foto revisada.');
      setProcessing(false);
    }
  };

  const handleRedactionMessage = async (event) => {
    const taskSnapshot = redactionTask;
    setRedactionTask(null);
    if (!taskSnapshot) return;

    try {
      const payload = JSON.parse(event?.nativeEvent?.data || '{}');
      if (payload.type !== 'redacted_ready' || !payload.fullBase64 || !payload.thumbBase64) {
        throw new Error(payload.message || 'Erro ao aplicar tarjas de privacidade.');
      }

      const processed = await saveProcessedPotholePhotoFromBase64({
        thumbBase64: payload.thumbBase64,
        fullBase64: payload.fullBase64,
        rawUriToClean: taskSnapshot.rawUriToClean,
      });

      setProcessing(false);
      onPhotoApproved?.({
        ...processed,
        privacyConfirmed: true,
        redactionsCount: taskSnapshot.barsCount,
      });
    } catch (err) {
      await recordAppErrorLog('PhotoReviewModal.redactionMessage', err);
      setErrorMsg(err?.message || 'Não foi possível salvar a foto com tarjas.');
      setProcessing(false);
    }
  };

  const allBarsToRender = activeDraftBar ? [...redactionBars, activeDraftBar] : redactionBars;

  const content = (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: topSafePadding,
          paddingBottom: Math.max(14, insets.bottom + 8),
        },
      ]}
    >
      <View style={[SharedStyles.contentContainer, styles.header]}>
        <View style={styles.headerLeft}>
          <FontAwesome6 name="shield-halved" size={18} color={colors.primary} />
          <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.text }]}>
            {title}
          </Text>
        </View>
        <Pressable
          onPress={onCancel}
          disabled={processing}
          hitSlop={10}
          style={[styles.iconBtn, { backgroundColor: colors.surfaceMuted }]}
        >
          <FontAwesome6 name="xmark" size={16} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[SharedStyles.contentContainer, styles.scrollBody]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.hintCard,
            {
              backgroundColor: colors.accentSoft,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radiusInput,
            },
          ]}
        >
          <FontAwesome6 name="hand" size={14} color={colors.primary} />
          <Text style={[styles.hintText, { color: colors.text }]}>
            Se alguma placa de veículo ou número de casa apareceu no fundo, deslize o dedo sobre a
            foto abaixo para cobrir com uma tarja escura antes de enviar.
          </Text>
        </View>

        <View
          style={[
            styles.imageFrameOuter,
            cardShadow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth,
              borderRadius: radiusCard,
            },
          ]}
        >
          <View
            onLayout={(e) => {
              const { width: fw, height: fh } = e.nativeEvent.layout;
              frameSizeRef.current = { width: fw, height: fh };
            }}
            style={[styles.canvasTouchArea, { aspectRatio: photoAspectRatio }]}
            {...panResponder.panHandlers}
          >
            {photo?.uri ? (
              <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : null}

            {allBarsToRender.map((bar, index) => (
              <View
                key={index}
                pointerEvents="none"
                style={[
                  styles.redactionRect,
                  {
                    left: `${bar.x * 100}%`,
                    top: `${bar.y * 100}%`,
                    width: `${bar.width * 100}%`,
                    height: `${bar.height * 100}%`,
                  },
                ]}
              />
            ))}
          </View>

          <View style={styles.toolbarRow}>
            <Text style={[styles.barCountText, { color: colors.textSecondary }]}>
              Tarjas aplicadas: {redactionBars.length}
            </Text>
            <View style={styles.toolbarActions}>
              <SecondaryButton
                compact
                label="Desfazer"
                icon="rotate-left"
                disabled={redactionBars.length === 0 || processing}
                onPress={() => setRedactionBars((prev) => prev.slice(0, -1))}
              />
              <SecondaryButton
                compact
                label="Limpar"
                icon="eraser"
                disabled={redactionBars.length === 0 || processing}
                onPress={() => setRedactionBars([])}
              />
            </View>
          </View>
        </View>

        <Pressable
          onPress={() => !processing && setPrivacyConfirmed((v) => !v)}
          style={[
            styles.confirmCard,
            {
              backgroundColor: privacyConfirmed ? colors.successSoft : colors.surfaceMuted,
              borderColor: privacyConfirmed ? colors.success : colors.border,
              borderWidth: 1,
              borderRadius: radiusInput,
            },
          ]}
        >
          <FontAwesome6
            name={privacyConfirmed ? 'square-check' : 'square'}
            size={18}
            color={privacyConfirmed ? colors.success : colors.textSecondary}
          />
          <Text style={[styles.confirmText, { color: colors.text }]}>
            Confirmo que a foto mostra apenas o buraco e não contém rostos, crianças, placas de
            veículos, números de casas ou conteúdo impróprio.
          </Text>
        </Pressable>

        {errorMsg ? (
          <View
            style={[
              styles.errorBanner,
              {
                backgroundColor: colors.dangerSoft,
                borderColor: colors.danger,
                borderWidth: 1,
                borderRadius: radiusInput,
              },
            ]}
          >
            <FontAwesome6 name="circle-exclamation" size={15} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.dangerText }]}>{errorMsg}</Text>
          </View>
        ) : null}

        <View style={styles.footerRow}>
          <SecondaryButton
            label="Tirar Outra"
            icon="camera"
            onPress={onRetake}
            disabled={processing}
            style={styles.flexBtn}
          />
          <SaveButton
            label={processing ? 'Processando...' : 'Usar Foto'}
            icon="check"
            onPress={handleConfirm}
            loading={processing}
            disabled={!privacyConfirmed || processing}
            style={styles.flexBtn}
          />
        </View>

        <CancelButton label="Cancelar" onPress={onCancel} disabled={processing} />
      </ScrollView>

      {redactionTask && NativeWebView ? (
        <View style={styles.hiddenProcessor} pointerEvents="none">
          <NativeWebView
            originWhitelist={['*']}
            source={{ html: redactionTask.html }}
            javaScriptEnabled
            onMessage={handleRedactionMessage}
          />
        </View>
      ) : null}
    </View>
  );

  if (inline) {
    return content;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    gap: 10,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBody: {
    gap: 12,
    paddingBottom: 24,
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 11,
    gap: 9,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  imageFrameOuter: {
    overflow: 'hidden',
  },
  canvasTouchArea: {
    width: '100%',
    maxHeight: 380,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  redactionRect: {
    position: 'absolute',
    backgroundColor: '#111827',
    borderRadius: 4,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    flexWrap: 'wrap',
  },
  barCountText: {
    fontSize: 12,
    fontWeight: '600',
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    gap: 10,
  },
  confirmText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 11,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  flexBtn: {
    flex: 1,
  },
  hiddenProcessor: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -10,
    top: -10,
  },
});

export default PhotoReviewModal;
