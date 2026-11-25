import { FontAwesome6 } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SharedStyles } from '../../components/StyleSheet/Styles';
import {
  CancelButton,
  DangerButton,
  PrimaryButton,
  SaveButton,
} from '../../components/common/Buttons';
import { useAppSettings } from '../context/AppSettingsContext';
import {
  adminDeletePothole,
  adminDeletePotholeUpdate,
  fetchAdminUserIdentitiesMap,
  formatAdminRealAuthorLabel,
} from '../services/adminService';
import { reverseGeocodeCoordinate } from '../services/geocodingService';
import { deletePotholePhotos } from '../services/potholeMediaService';
import { potholeRepository } from '../services/potholeRepository';

function notifyUser(title, message) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function confirmActionDouble(title1, msg1, title2, msg2, confirmLabel, onConfirmed) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (window.confirm(`${title1}\n\n${msg1}`)) {
      if (window.confirm(`${title2}\n\n${msg2}`)) {
        onConfirmed();
      }
    }
    return;
  }

  Alert.alert(title1, msg1, [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Continuar',
      style: 'destructive',
      onPress: () => {
        Alert.alert(title2, msg2, [
          { text: 'Voltar', style: 'cancel' },
          {
            text: confirmLabel,
            style: 'destructive',
            onPress: onConfirmed,
          },
        ]);
      },
    },
  ]);
}

function getPinchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

export function PotholeDetailModal({
  visible,
  pothole,
  session,
  initialAnonymous,
  pendingVerificationDraft,
  onClose,
  onStartVerification,
  onCancelVerificationDraft,
  onVerificationSaved,
  onAdminPotholeDeleted,
  onAdminUpdateDeleted,
}) {
  const insets = useSafeAreaInsets();
  const {
    colors,
    radiusCard,
    radiusButton,
    radiusInput,
    borderWidth,
    cardShadow,
    typography,
    notifyDataRestored,
  } = useAppSettings();

  const windowHeight = Dimensions.get('window').height;
  const sheetTranslateY = useRef(new Animated.Value(windowHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);

  const [resolvedAddress, setResolvedAddress] = useState('');
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [fullImageLoaded, setFullImageLoaded] = useState(false);

  // Estado do visualizador zoom inline (sem empilhar dois Modals no Android)
  const [zoomViewerUri, setZoomViewerUri] = useState(null);
  const [zoomScaleDisplay, setZoomScaleDisplay] = useState(1);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const currentScaleRef = useRef(1);
  const pinchBaseDistanceRef = useRef(0);
  const pinchBaseScaleRef = useRef(1);
  const lastTapRef = useRef(0);

  // Estado do formulário de confirmação de verificação comunitária
  const [note, setNote] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(Boolean(initialAnonymous));
  const [savingVerification, setSavingVerification] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminIdentities, setAdminIdentities] = useState({});
  const savingRef = useRef(false);

  useEffect(() => {
    savingRef.current = savingVerification || adminBusy;
  }, [savingVerification, adminBusy]);

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      sheetTranslateY.setValue(windowHeight);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(sheetTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 3,
          speed: 14,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, windowHeight, sheetTranslateY, backdropOpacity]);

  useEffect(() => {
    if (!visible || !pothole) {
      setFullImageLoaded(false);
      setZoomViewerUri(null);
      return;
    }

    let active = true;
    setFullImageLoaded(false);

    if (pothole.streetAddress) {
      setResolvedAddress(pothole.streetAddress);
      setLoadingAddress(false);
      return () => {
        active = false;
      };
    }

    setResolvedAddress('');
    setLoadingAddress(true);
    reverseGeocodeCoordinate(pothole.latitude, pothole.longitude)
      .then((addr) => {
        if (active) {
          setResolvedAddress(addr.formattedAddress || pothole.streetHint || '');
        }
      })
      .finally(() => {
        if (active) setLoadingAddress(false);
      });

    return () => {
      active = false;
    };
  }, [visible, pothole]);

  useEffect(() => {
    if (pendingVerificationDraft) {
      setNote('');
      setIsAnonymous(Boolean(initialAnonymous));
      setVerificationError('');
    }
  }, [pendingVerificationDraft, initialAnonymous]);

  useEffect(() => {
    if (!visible || !session?.isAdmin || session?.isDemo || !pothole) {
      setAdminIdentities({});
      return;
    }

    let active = true;
    fetchAdminUserIdentitiesMap()
      .then((map) => {
        if (active && map) {
          setAdminIdentities(map);
        }
      })
      .catch(() => {
        if (active) setAdminIdentities({});
      });

    return () => {
      active = false;
    };
  }, [visible, session?.isAdmin, session?.isDemo, pothole]);

  const animateDismiss = useCallback(() => {
    if (savingRef.current || isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.parallel([
      Animated.timing(sheetTranslateY, {
        toValue: windowHeight,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(async () => {
      if (pendingVerificationDraft?.media) {
        await deletePotholePhotos(
          pendingVerificationDraft.media.thumbUri,
          pendingVerificationDraft.media.fullUri
        );
        onCancelVerificationDraft();
      }
      isClosingRef.current = false;
      onClose();
    });
  }, [
    sheetTranslateY,
    backdropOpacity,
    windowHeight,
    pendingVerificationDraft,
    onCancelVerificationDraft,
    onClose,
  ]);

  const handleRequestClose = useCallback(() => {
    if (savingRef.current) return;
    if (zoomViewerUri) {
      setZoomViewerUri(null);
      return;
    }
    animateDismiss();
  }, [zoomViewerUri, animateDismiss]);

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !savingRef.current,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          !savingRef.current && gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy >= 0) {
            sheetTranslateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 100 || gestureState.vy > 0.5) {
            animateDismiss();
          } else {
            Animated.spring(sheetTranslateY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 5,
            }).start();
          }
        },
      }),
    [sheetTranslateY, animateDismiss]
  );

  const applyZoomScale = (nextScale) => {
    const clamped = Math.min(3.5, Math.max(1, Number(nextScale.toFixed(2))));
    currentScaleRef.current = clamped;
    setZoomScaleDisplay(clamped);
    Animated.spring(scaleAnim, {
      toValue: clamped,
      useNativeDriver: true,
      bounciness: 4,
    }).start();
  };

  const openZoomViewer = (uri) => {
    if (!uri) return;
    currentScaleRef.current = 1;
    setZoomScaleDisplay(1);
    scaleAnim.setValue(1);
    setZoomViewerUri(uri);
  };

  const handleViewerTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      applyZoomScale(currentScaleRef.current > 1.2 ? 1 : 2.2);
    }
    lastTapRef.current = now;
  };

  const pinchPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
        onPanResponderGrant: (evt) => {
          if (evt.nativeEvent.touches.length >= 2) {
            pinchBaseDistanceRef.current = getPinchDistance(evt.nativeEvent.touches);
            pinchBaseScaleRef.current = currentScaleRef.current;
          }
        },
        onPanResponderMove: (evt) => {
          if (evt.nativeEvent.touches.length >= 2 && pinchBaseDistanceRef.current > 0) {
            const dist = getPinchDistance(evt.nativeEvent.touches);
            const ratio = dist / pinchBaseDistanceRef.current;
            const nextScale = Math.min(3.5, Math.max(1, pinchBaseScaleRef.current * ratio));
            currentScaleRef.current = nextScale;
            scaleAnim.setValue(nextScale);
            setZoomScaleDisplay(Number(nextScale.toFixed(1)));
          }
        },
        onPanResponderRelease: () => {
          pinchBaseDistanceRef.current = 0;
        },
      }),
    [scaleAnim]
  );

  const handleCancelDraft = async () => {
    if (savingVerification) return;
    if (pendingVerificationDraft?.media) {
      await deletePotholePhotos(
        pendingVerificationDraft.media.thumbUri,
        pendingVerificationDraft.media.fullUri
      );
    }
    onCancelVerificationDraft();
  };

  const handleConfirmVerification = async () => {
    if (!pothole || !pendingVerificationDraft || savingVerification) return;
    setVerificationError('');
    setSavingVerification(true);
    try {
      const updated = await potholeRepository.addVerification(pothole.id, {
        nextStatus: pendingVerificationDraft.nextStatus,
        note,
        isAnonymous,
        authorNickname: session?.nickname || 'Cidadão',
        authorUserId: session?.userId || null,
        isDemoSession: Boolean(session?.isDemo),
        thumbUri: pendingVerificationDraft.media.thumbUri,
        fullUri: pendingVerificationDraft.media.fullUri,
        thumbBase64: pendingVerificationDraft.media.thumbBase64,
        fullBase64: pendingVerificationDraft.media.fullBase64,
        currentPothole: pothole,
      });
      notifyDataRestored();
      onVerificationSaved(updated);
    } catch (err) {
      setVerificationError(err?.message || 'Não foi possível salvar a verificação.');
    } finally {
      setSavingVerification(false);
    }
  };

  const handleAdminDeletePotholePress = () => {
    if (!pothole?.id || adminBusy) return;
    confirmActionDouble(
      'Moderação: Excluir Registro?',
      'Esta ação removerá o relato do mapa, todas as fotos (miniatura e original) e os comentários vinculados.',
      'Confirmar Exclusão Permanente',
      'Tem certeza absoluta? Os arquivos serão apagados permanentemente do Storage.',
      'Excluir Agora',
      async () => {
        setAdminBusy(true);
        try {
          await adminDeletePothole(pothole.id);
          notifyDataRestored();
          onAdminPotholeDeleted?.(pothole.id);
        } catch (err) {
          notifyUser('Erro de Moderação', err?.message || 'Não foi possível excluir o registro.');
        } finally {
          setAdminBusy(false);
        }
      }
    );
  };

  const handleAdminDeleteUpdatePress = (entry) => {
    if (!entry?.id || adminBusy) return;
    confirmActionDouble(
      'Apagar Comentário/Atualização?',
      'A foto e o texto desta atualização comunitária serão removidos.',
      'Confirmar Remoção',
      'Deseja realmente apagar esta atualização permanentemente?',
      'Apagar Agora',
      async () => {
        setAdminBusy(true);
        try {
          await adminDeletePotholeUpdate(entry.id);
          notifyDataRestored();
          onAdminUpdateDeleted?.(pothole.id, entry.id);
        } catch (err) {
          notifyUser('Erro de Moderação', err?.message || 'Não foi possível apagar o comentário.');
        } finally {
          setAdminBusy(false);
        }
      }
    );
  };

  if (!pothole) {
    return null;
  }

  const canModerateCloud = Boolean(session?.isAdmin && pothole?.isCloudReport);

  const isFixed = pothole.status === 'fixed';
  const statusColor = isFixed ? colors.success : colors.danger;
  const statusSoft = isFixed ? colors.successSoft : colors.dangerSoft;
  const statusBadgeText = isFixed ? 'Já foi Tampado' : 'Buraco Aberto';
  const verifications = Array.isArray(pothole.verifications) ? pothole.verifications : [];
  const hasAnyPhoto = Boolean(pothole.thumbUri || pothole.fullUri);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleRequestClose}
    >
      <View style={styles.overlayRoot}>
        {/* Backdrop escuro semitransparente */}
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleRequestClose} />
        </Animated.View>

        {/* Bottom Sheet 85% Material You */}
        <Animated.View
          style={[
            styles.sheetContainer,
            cardShadow,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}
        >
          <KeyboardAvoidingView
            style={styles.flexOne}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {/* Zona exclusiva de arraste no topo (alça + cabeçalho) */}
            <View
              {...sheetPanResponder.panHandlers}
              style={[
                styles.dragZone,
                {
                  backgroundColor: colors.card,
                  borderBottomColor: colors.dividerColor,
                },
              ]}
            >
              <View style={[styles.dragHandlePill, { backgroundColor: colors.border }]} />

              <View style={[SharedStyles.contentContainer, styles.header]}>
                <View style={[styles.statusBadge, { backgroundColor: statusSoft }]}>
                  <FontAwesome6
                    name={isFixed ? 'circle-check' : 'triangle-exclamation'}
                    size={13}
                    color={statusColor}
                  />
                  <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                    {statusBadgeText}
                  </Text>
                </View>

                <Pressable
                  onPress={handleRequestClose}
                  disabled={savingVerification}
                  hitSlop={10}
                  accessibilityLabel="Fechar detalhes"
                  style={[styles.closeBtn, { backgroundColor: colors.surfaceMuted }]}
                >
                  <FontAwesome6 name="xmark" size={16} color={colors.text} />
                </Pressable>
              </View>
            </View>

            <ScrollView
              contentContainerStyle={[
                SharedStyles.contentContainer,
                styles.scrollBody,
                { paddingBottom: Math.max(28, insets.bottom + 18) },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Carregamento progressivo da foto: miniatura imediata + original sob demanda */}
              {hasAnyPhoto ? (
                <Pressable
                  onPress={() => openZoomViewer(pothole.fullUri || pothole.thumbUri)}
                  style={[
                    styles.heroPhotoCard,
                    cardShadow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderWidth,
                      borderRadius: radiusCard,
                    },
                  ]}
                >
                  <View style={[styles.heroImageContainer, { backgroundColor: colors.surfaceMuted }]}>
                    {pothole.thumbUri ? (
                      <Image
                        source={{ uri: pothole.thumbUri }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                      />
                    ) : null}

                    {visible && pothole.fullUri ? (
                      <Image
                        source={{ uri: pothole.fullUri }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                        onLoadEnd={() => setFullImageLoaded(true)}
                      />
                    ) : null}

                    {visible && pothole.fullUri && !fullImageLoaded ? (
                      <View style={[styles.loadingPhotoPill, { backgroundColor: colors.overlay }]}>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                        <Text style={styles.loadingPhotoText}>Carregando foto original...</Text>
                      </View>
                    ) : (
                      <View style={[styles.zoomHintPill, { backgroundColor: colors.overlay }]}>
                        <FontAwesome6 name="expand" size={11} color="#FFFFFF" />
                        <Text style={styles.loadingPhotoText}>Toque para ampliar</Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              ) : (
                <View
                  style={[
                    styles.noPhotoCard,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderWidth,
                      borderRadius: radiusCard,
                    },
                  ]}
                >
                  <FontAwesome6 name="camera" size={20} color={colors.textMuted} />
                  <Text style={[styles.noPhotoText, { color: colors.textSecondary }]}>
                    Ocorrência de exemplo sem foto anexada. Envie uma verificação com foto abaixo!
                  </Text>
                </View>
              )}

              {/* Metadados principais */}
              <View
                style={[
                  styles.sectionCard,
                  cardShadow,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderWidth,
                    borderRadius: radiusCard,
                  },
                ]}
              >
                <View style={styles.authorRow}>
                  <View
                    style={[
                      styles.authorBadge,
                      {
                        backgroundColor: pothole.isAnonymous
                          ? colors.surfaceMuted
                          : colors.accentSoft,
                        borderRadius: radiusButton,
                      },
                    ]}
                  >
                    <FontAwesome6
                      name={pothole.isAnonymous ? 'user-secret' : 'user'}
                      size={13}
                      color={pothole.isAnonymous ? colors.textSecondary : colors.primary}
                    />
                    <Text
                      style={[
                        styles.authorName,
                        { color: pothole.isAnonymous ? colors.text : colors.primary },
                      ]}
                    >
                      {pothole.isAnonymous ? 'Usuário Anônimo' : pothole.authorNickname}
                    </Text>
                    {pothole.isAnonymous ? (
                      <FontAwesome6 name="shield-halved" size={12} color={colors.textMuted} />
                    ) : null}
                  </View>

                  <Text
                    style={[
                      styles.dateText,
                      { color: colors.textSecondary, fontVariant: typography.fontVariant },
                    ]}
                  >
                    {pothole.createdAt}
                  </Text>
                </View>

                {session?.isAdmin && !session?.isDemo && pothole.isAnonymous ? (
                  <View style={styles.adminAuthorBadge}>
                    <FontAwesome6 name="user-shield" size={12} color="#B3261E" />
                    <Text style={styles.adminAuthorBadgeText}>
                      {formatAdminRealAuthorLabel(
                        adminIdentities[pothole.authorUserId],
                        pothole.authorUserId
                      )}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.addressRow}>
                  <FontAwesome6 name="location-dot" size={14} color={colors.primary} />
                  {loadingAddress ? (
                    <Text style={[styles.addressText, { color: colors.textMuted }]}>
                      Buscando rua próxima...
                    </Text>
                  ) : (
                    <Text style={[styles.addressText, { color: colors.text }]}>
                      {resolvedAddress || pothole.streetHint || 'Localização detectada por GPS'}
                    </Text>
                  )}
                </View>

                <Text style={[styles.commentText, { color: colors.textSecondary }]}>
                  {pothole.comment}
                </Text>

                <View style={[styles.metaFooter, { borderTopColor: colors.dividerColor }]}>
                  <FontAwesome6 name="users" size={13} color={colors.primary} />
                  <Text
                    style={[
                      styles.confirmationsText,
                      { color: colors.textSecondary, fontVariant: typography.fontVariant },
                    ]}
                  >
                    {pothole.confirmations || 1} confirmações da comunidade
                  </Text>
                </View>
              </View>

              {/* Fluxo de Verificação Comunitária */}
              {session?.isDemo ? (
                <View
                  style={[
                    styles.sectionCard,
                    cardShadow,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderWidth,
                      borderRadius: radiusCard,
                    },
                  ]}
                >
                  <View style={styles.anonSwitchRow}>
                    <FontAwesome6 name="lock" size={16} color={colors.primary} />
                    <View style={styles.flexOne}>
                      <Text style={[styles.sectionTitle, { color: colors.text }]}>
                        Modo Demonstração (Somente Leitura)
                      </Text>
                      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                        Faça login ou crie uma conta gratuita para confirmar status ou enviar fotos.
                      </Text>
                    </View>
                  </View>
                </View>
              ) : pendingVerificationDraft ? (
                <View
                  style={[
                    styles.sectionCard,
                    cardShadow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.primary,
                      borderWidth: 1.5,
                      borderRadius: radiusCard,
                    },
                  ]}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Confirmar Atualização da Via
                  </Text>

                  <View style={styles.draftRow}>
                    <Image
                      source={{ uri: pendingVerificationDraft.media.thumbUri }}
                      style={[
                        styles.draftThumb,
                        { borderColor: colors.border, borderRadius: radiusInput },
                      ]}
                      resizeMode="cover"
                    />
                    <View style={styles.draftInfo}>
                      <View
                        style={[
                          styles.statusBadge,
                          {
                            alignSelf: 'flex-start',
                            backgroundColor:
                              pendingVerificationDraft.nextStatus === 'fixed'
                                ? colors.successSoft
                                : colors.dangerSoft,
                          },
                        ]}
                      >
                        <FontAwesome6
                          name={
                            pendingVerificationDraft.nextStatus === 'fixed'
                              ? 'circle-check'
                              : 'triangle-exclamation'
                          }
                          size={12}
                          color={
                            pendingVerificationDraft.nextStatus === 'fixed'
                              ? colors.success
                              : colors.danger
                          }
                        />
                        <Text
                          style={[
                            styles.statusBadgeText,
                            {
                              color:
                                pendingVerificationDraft.nextStatus === 'fixed'
                                  ? colors.success
                                  : colors.danger,
                            },
                          ]}
                        >
                          {pendingVerificationDraft.nextStatus === 'fixed'
                            ? 'Já foi Tampado'
                            : 'Continua Aberto'}
                        </Text>
                      </View>
                      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                        Nova foto comprobatória pronta (miniatura + HD).
                      </Text>
                    </View>
                  </View>

                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Observação opcional (ex.: asfalto cedendo mais / tapa-buraco concluído)"
                    placeholderTextColor={colors.textMuted}
                    multiline
                    maxLength={200}
                    textAlignVertical="top"
                    style={[
                      styles.noteInput,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        borderWidth,
                        borderRadius: radiusInput,
                        color: colors.text,
                      },
                    ]}
                  />

                  <View style={styles.anonSwitchRow}>
                    <FontAwesome6 name="user-secret" size={15} color={colors.primary} />
                    <View style={styles.flexOne}>
                      <Text style={[styles.switchLabel, { color: colors.text }]}>
                        Publicar atualização de forma anônima
                      </Text>
                      <Text style={[styles.switchHint, { color: colors.textSecondary }]}>
                        Exibirá "Usuário Anônimo" no histórico.
                      </Text>
                    </View>
                    <Switch
                      value={isAnonymous}
                      onValueChange={setIsAnonymous}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#FFFFFF"
                    />
                  </View>

                  {verificationError ? (
                    <Text style={[styles.errorText, { color: colors.danger }]}>
                      {verificationError}
                    </Text>
                  ) : null}

                  <View style={styles.actionRow}>
                    <CancelButton
                      label="Cancelar"
                      onPress={handleCancelDraft}
                      disabled={savingVerification}
                      style={styles.flexOne}
                    />
                    <SaveButton
                      label={savingVerification ? 'Salvando...' : 'Confirmar Atualização'}
                      icon="check"
                      onPress={handleConfirmVerification}
                      loading={savingVerification}
                      style={styles.flexOne}
                    />
                  </View>
                </View>
              ) : (
                <View
                  style={[
                    styles.sectionCard,
                    cardShadow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderWidth,
                      borderRadius: radiusCard,
                    },
                  ]}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Atualizar Situação da Via
                  </Text>
                  <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                    Passou por este local agora? Tire uma foto rápida para confirmar se o buraco
                    continua aberto ou já foi tampado.
                  </Text>

                  <View style={styles.actionRow}>
                    <DangerButton
                      compact
                      label="Continua Aberto"
                      icon="triangle-exclamation"
                      onPress={() => onStartVerification(pothole, 'open')}
                      style={styles.flexOne}
                    />
                    <SaveButton
                      compact
                      label="Já foi Tampado"
                      icon="circle-check"
                      onPress={() => onStartVerification(pothole, 'fixed')}
                      style={styles.flexOne}
                    />
                  </View>
                </View>
              )}

              {/* Barra administrativa restrita (visível apenas quando isAdmin === true) */}
              {canModerateCloud ? (
                <View
                  style={[
                    styles.adminBar,
                    {
                      backgroundColor: colors.dangerSoft,
                      borderColor: colors.danger,
                      borderWidth: 1,
                      borderRadius: radiusCard,
                    },
                  ]}
                >
                  <View style={styles.adminBarHeader}>
                    <FontAwesome6 name="gavel" size={14} color={colors.danger} />
                    <Text style={[styles.adminBarTitle, { color: colors.dangerText }]}>
                      Moderação Administrativa
                    </Text>
                  </View>
                  <DangerButton
                    compact
                    label={adminBusy ? 'Excluindo...' : 'Excluir Registro e Fotos (Admin)'}
                    icon="trash-can"
                    onPress={handleAdminDeletePotholePress}
                    loading={adminBusy}
                  />
                </View>
              ) : null}

              {/* Linha do tempo cronológica de verificações */}
              <View
                style={[
                  styles.sectionCard,
                  cardShadow,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderWidth,
                    borderRadius: radiusCard,
                  },
                ]}
              >
                <View style={styles.timelineHeaderRow}>
                  <FontAwesome6 name="clock-rotate-left" size={14} color={colors.primary} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Histórico de Verificações ({verifications.length})
                  </Text>
                </View>

                {verifications.length === 0 ? (
                  <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                    Nenhuma verificação comunitária ainda. Seja o primeiro a atualizar!
                  </Text>
                ) : (
                  <View style={styles.timelineList}>
                    {verifications.map((entry, idx) => {
                      const entryFixed = entry.status === 'fixed';
                      const entryColor = entryFixed ? colors.success : colors.danger;
                      const entrySoft = entryFixed ? colors.successSoft : colors.dangerSoft;
                      const entryThumb = entry.thumbUri || entry.fullUri;

                      return (
                        <View
                          key={entry.id || idx}
                          style={[styles.timelineItem, { borderLeftColor: entryColor }]}
                        >
                          <View style={styles.timelineItemTop}>
                            <View style={[styles.miniBadge, { backgroundColor: entrySoft }]}>
                              <FontAwesome6
                                name={entryFixed ? 'circle-check' : 'triangle-exclamation'}
                                size={10}
                                color={entryColor}
                              />
                              <Text style={[styles.miniBadgeText, { color: entryColor }]}>
                                {entry.statusLabel}
                              </Text>
                            </View>
                            <Text
                              style={[
                                styles.timelineDate,
                                { color: colors.textMuted, fontVariant: typography.fontVariant },
                              ]}
                            >
                              {entry.createdAt}
                            </Text>
                          </View>

                          <View style={styles.timelineContentRow}>
                            <View style={styles.flexOne}>
                              <View style={styles.timelineAuthorRow}>
                                <FontAwesome6
                                  name={entry.isAnonymous ? 'user-secret' : 'user'}
                                  size={11}
                                  color={colors.textSecondary}
                                />
                                <Text style={[styles.timelineAuthor, { color: colors.text }]}>
                                  {entry.isAnonymous ? 'Usuário Anônimo' : entry.authorNickname}
                                </Text>
                              </View>
                              {session?.isAdmin && !session?.isDemo && entry.isAnonymous ? (
                                <View style={styles.adminAuthorBadge}>
                                  <FontAwesome6 name="user-shield" size={11} color="#B3261E" />
                                  <Text style={styles.adminAuthorBadgeText}>
                                    {formatAdminRealAuthorLabel(
                                      adminIdentities[entry.authorUserId],
                                      entry.authorUserId
                                    )}
                                  </Text>
                                </View>
                              ) : null}
                              {entry.note ? (
                                <Text style={[styles.timelineNote, { color: colors.textSecondary }]}>
                                  {entry.note}
                                </Text>
                              ) : null}
                            </View>

                            {entryThumb ? (
                              <Pressable
                                onPress={() => openZoomViewer(entry.fullUri || entry.thumbUri)}
                                style={[
                                  styles.timelineThumbWrap,
                                  { borderColor: colors.border, borderRadius: radiusInput },
                                ]}
                              >
                                <Image
                                  source={{ uri: entryThumb }}
                                  style={styles.timelineThumbImg}
                                  resizeMode="cover"
                                />
                              </Pressable>
                            ) : null}

                            {canModerateCloud && entry.id ? (
                              <Pressable
                                onPress={() => handleAdminDeleteUpdatePress(entry)}
                                disabled={adminBusy}
                                hitSlop={8}
                                accessibilityLabel="Apagar comentário/atualização"
                                style={[
                                  styles.adminDeleteEntryBtn,
                                  { backgroundColor: colors.dangerSoft },
                                ]}
                              >
                                <FontAwesome6 name="trash-can" size={13} color={colors.danger} />
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Animated.View>

        {/* Visualizador inline em tela cheia com pinça/toque */}
        {zoomViewerUri ? (
          <View
            style={[
              styles.zoomOverlay,
              {
                backgroundColor: colors.overlay,
                paddingTop: Math.max(insets.top, 24) + 8,
                paddingBottom: Math.max(20, insets.bottom + 12),
              },
            ]}
          >
            <View style={styles.zoomHeader}>
              <View
                style={[
                  styles.zoomPill,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderWidth,
                    borderRadius: radiusButton,
                  },
                ]}
              >
                <FontAwesome6 name="magnifying-glass" size={12} color={colors.primary} />
                <Text
                  style={[
                    styles.zoomPillText,
                    { color: colors.text, fontVariant: typography.fontVariant },
                  ]}
                >
                  Foto Original ({zoomScaleDisplay}x)
                </Text>
              </View>

              <Pressable
                onPress={() => setZoomViewerUri(null)}
                accessibilityLabel="Fechar visualização"
                style={[
                  styles.zoomCloseBtn,
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
            </View>

            <View style={styles.zoomStage} {...pinchPanResponder.panHandlers}>
              <Pressable onPress={handleViewerTap} style={styles.zoomTapArea}>
                <Animated.Image
                  source={{ uri: zoomViewerUri }}
                  style={[styles.zoomImage, { transform: [{ scale: scaleAnim }] }]}
                  resizeMode="contain"
                />
              </Pressable>
            </View>

            <View style={styles.zoomControlsBar}>
              <PrimaryButton
                compact
                label="- Zoom"
                icon="minus"
                onPress={() => applyZoomScale(currentScaleRef.current - 0.5)}
              />
              <PrimaryButton
                compact
                label="1x"
                icon="rotate"
                onPress={() => applyZoomScale(1)}
              />
              <PrimaryButton
                compact
                label="+ Zoom"
                icon="plus"
                onPress={() => applyZoomScale(currentScaleRef.current + 0.5)}
              />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    position: 'relative',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheetContainer: {
    height: '85%',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  flexOne: {
    flex: 1,
  },
  dragZone: {
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    alignItems: 'center',
    gap: 10,
  },
  dragHandlePill: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 14,
  },
  heroPhotoCard: {
    overflow: 'hidden',
  },
  heroImageContainer: {
    width: '100%',
    height: 210,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingPhotoPill: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 7,
  },
  zoomHintPill: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
  },
  loadingPhotoText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  noPhotoCard: {
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  noPhotoText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  sectionCard: {
    padding: 15,
    gap: 11,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  authorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  },
  authorName: {
    fontSize: 13,
    fontWeight: '700',
  },
  adminAuthorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#FCE8E6',
    borderWidth: 1,
    borderColor: '#F5C2C0',
  },
  adminAuthorBadgeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    color: '#8C1D18',
  },
  dateText: {
    fontSize: 12,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  addressText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  commentText: {
    fontSize: 14,
    lineHeight: 21,
  },
  metaFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 9,
    gap: 7,
  },
  confirmationsText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 19,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  draftRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  draftThumb: {
    width: 68,
    height: 68,
    borderWidth: 1,
  },
  draftInfo: {
    flex: 1,
    gap: 6,
  },
  noteInput: {
    minHeight: 74,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 19,
  },
  anonSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  switchHint: {
    fontSize: 11,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '700',
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timelineList: {
    gap: 12,
  },
  timelineItem: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    gap: 6,
  },
  timelineItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  miniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 5,
  },
  miniBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timelineDate: {
    fontSize: 11,
  },
  timelineContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timelineAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timelineAuthor: {
    fontSize: 13,
    fontWeight: '600',
  },
  timelineNote: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  timelineThumbWrap: {
    width: 52,
    height: 52,
    borderWidth: 1,
    overflow: 'hidden',
  },
  timelineThumbImg: {
    width: '100%',
    height: '100%',
  },
  adminBar: {
    padding: 13,
    gap: 10,
  },
  adminBarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adminBarTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  adminDeleteEntryBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  zoomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  zoomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 8,
  },
  zoomPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  zoomCloseBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginVertical: 12,
  },
  zoomTapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomImage: {
    width: '100%',
    height: '100%',
  },
  zoomControlsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
});

export default PotholeDetailModal;
