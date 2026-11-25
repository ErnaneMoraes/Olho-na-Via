import { FontAwesome6 } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SharedStyles } from '../../components/StyleSheet/Styles';
import { CancelButton, SaveButton, SecondaryButton } from '../../components/common/Buttons';
import { useAppSettings } from '../context/AppSettingsContext';
import { reverseGeocodeCoordinate } from '../services/geocodingService';
import { deletePotholePhotos } from '../services/potholeMediaService';
import { potholeRepository } from '../services/potholeRepository';

export function NewReportModal({
  visible,
  capturedMedia,
  session,
  initialAnonymous,
  fallbackCoords,
  onClose,
  onRetakePhoto,
  onReportPublished,
}) {
  const insets = useSafeAreaInsets();
  const {
    colors,
    radiusCard,
    radiusInput,
    borderWidth,
    cardShadow,
    typography,
    notifyDataRestored,
  } = useAppSettings();

  const [coords, setCoords] = useState(fallbackCoords || null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [streetAddress, setStreetAddress] = useState('');
  const [comment, setComment] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(Boolean(initialAnonymous));
  const [privacyConfirmed, setPrivacyConfirmed] = useState(Boolean(capturedMedia?.privacyConfirmed));
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const topSafePadding =
    Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 12) + 8;

  useEffect(() => {
    if (!visible) return;

    let active = true;
    setComment('');
    setErrorMsg('');
    setIsAnonymous(Boolean(initialAnonymous));
    setPrivacyConfirmed(Boolean(capturedMedia?.privacyConfirmed));
    setCoords(fallbackCoords || null);
    setStreetAddress('');

    async function capturePreciseGpsAndStreet() {
      setGpsLoading(true);
      let resolvedCoords = fallbackCoords || null;

      try {
        const highPos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (highPos?.coords) {
          resolvedCoords = {
            latitude: highPos.coords.latitude,
            longitude: highPos.coords.longitude,
          };
        }
      } catch {
        try {
          const balancedPos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (balancedPos?.coords) {
            resolvedCoords = {
              latitude: balancedPos.coords.latitude,
              longitude: balancedPos.coords.longitude,
            };
          }
        } catch {
          // Mantém fallbackCoords
        }
      }

      if (!active) return;
      setCoords(resolvedCoords);

      if (resolvedCoords) {
        const addr = await reverseGeocodeCoordinate(
          resolvedCoords.latitude,
          resolvedCoords.longitude
        );
        if (active) {
          setStreetAddress(addr.formattedAddress || '');
        }
      }

      if (active) {
        setGpsLoading(false);
      }
    }

    capturePreciseGpsAndStreet();
    return () => {
      active = false;
    };
  }, [visible, initialAnonymous, fallbackCoords]);

  const handleDismiss = async () => {
    if (saving) return;
    if (capturedMedia) {
      await deletePotholePhotos(capturedMedia.thumbUri, capturedMedia.fullUri);
    }
    onClose();
  };

  const handlePublish = async () => {
    if (saving) return;
    setErrorMsg('');

    const trimmedComment = comment.trim();
    if (trimmedComment.length < 5) {
      setErrorMsg('Descreva o buraco com pelo menos 5 caracteres para ajudar outros motoristas.');
      return;
    }

    if (!coords) {
      setErrorMsg('Aguarde a confirmação do GPS ou tente novamente.');
      return;
    }

    if (!privacyConfirmed) {
      setErrorMsg('Confirme que a foto respeita as diretrizes de privacidade antes de publicar.');
      return;
    }

    setSaving(true);
    try {
      const created = await potholeRepository.createReport({
        latitude: coords.latitude,
        longitude: coords.longitude,
        streetAddress: streetAddress.trim() || 'Via localizada por GPS',
        comment: trimmedComment,
        isAnonymous,
        authorNickname: session?.nickname || 'Cidadão',
        authorUserId: session?.userId || null,
        isDemoSession: Boolean(session?.isDemo),
        thumbUri: capturedMedia?.thumbUri,
        fullUri: capturedMedia?.fullUri,
        thumbBase64: capturedMedia?.thumbBase64,
        fullBase64: capturedMedia?.fullBase64,
      });

      notifyDataRestored();
      onReportPublished(created);
    } catch (err) {
      setErrorMsg(err?.message || 'Não foi possível publicar o relato.');
    } finally {
      setSaving(false);
    }
  };

  const previewUri = capturedMedia?.fullUri || capturedMedia?.thumbUri;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleDismiss}>
      <KeyboardAvoidingView
        style={[
          styles.root,
          {
            backgroundColor: colors.background,
            paddingTop: topSafePadding,
            paddingBottom: Math.max(12, insets.bottom),
          },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[SharedStyles.contentContainer, styles.header]}>
          <View style={styles.headerLeft}>
            <FontAwesome6 name="road-circle-exclamation" size={18} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.text }]}>Novo Relato de Buraco</Text>
          </View>
          <Pressable
            onPress={handleDismiss}
            disabled={saving}
            hitSlop={10}
            style={[styles.closeBtn, { backgroundColor: colors.surfaceMuted }]}
          >
            <FontAwesome6 name="xmark" size={16} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[SharedStyles.contentContainer, styles.scrollBody]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Prévia da foto capturada */}
          {previewUri ? (
            <View
              style={[
                styles.photoCard,
                cardShadow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusCard,
                },
              ]}
            >
              <Image source={{ uri: previewUri }} style={styles.photoPreview} resizeMode="cover" />
              <View style={styles.photoFooter}>
                <View style={[styles.badgePill, { backgroundColor: colors.successSoft }]}>
                  <FontAwesome6 name="circle-check" size={12} color={colors.success} />
                  <Text style={[styles.badgeText, { color: colors.success }]}>
                    Foto pronta (miniatura + HD)
                  </Text>
                </View>

                <SecondaryButton
                  compact
                  label="Tirar Outra Foto"
                  icon="camera"
                  onPress={onRetakePhoto}
                  disabled={saving}
                />
              </View>
            </View>
          ) : null}

          {/* Localização GPS e Rua editável */}
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
            <View style={styles.gpsStatusRow}>
              {gpsLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <FontAwesome6 name="location-crosshairs" size={14} color={colors.success} />
              )}
              <Text style={[styles.gpsStatusText, { color: colors.text }]}>
                {gpsLoading ? 'Capturando GPS exato...' : 'Localização GPS confirmada'}
              </Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Rua ou Ponto de Referência
              </Text>
              <View
                style={[
                  styles.inputBox,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                    borderWidth,
                    borderRadius: radiusInput,
                  },
                ]}
              >
                <FontAwesome6 name="location-dot" size={14} color={colors.textMuted} />
                <TextInput
                  value={streetAddress}
                  onChangeText={setStreetAddress}
                  placeholder="Ex.: Av. Paulista, próximo ao nº 1000"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.singleLineInput, { color: colors.text }]}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  Comentário sobre o buraco *
                </Text>
                <Text
                  style={[
                    styles.charCount,
                    { color: colors.textMuted, fontVariant: typography.fontVariant },
                  ]}
                >
                  {comment.length}/280
                </Text>
              </View>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Ex.: Buraco fundo na faixa da direita próximo ao meio-fio"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={280}
                textAlignVertical="top"
                style={[
                  styles.multiLineInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                    borderWidth,
                    borderRadius: radiusInput,
                    color: colors.text,
                  },
                ]}
              />
            </View>
          </View>

          {/* Switch de publicação anônima (LGPD) */}
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
            <View style={styles.switchRow}>
              <View style={[styles.switchIconWrap, { backgroundColor: colors.accentSoft }]}>
                <FontAwesome6 name="user-secret" size={16} color={colors.primary} />
              </View>
              <View style={styles.switchInfo}>
                <Text style={[styles.switchTitle, { color: colors.text }]}>
                  Publicar de forma anônima
                </Text>
                <Text style={[styles.switchSubtitle, { color: colors.textSecondary }]}>
                  Seu apelido ficará oculto para outros usuários e o relato exibirá "Usuário
                  Anônimo".
                </Text>
              </View>
              <Switch
                value={isAnonymous}
                onValueChange={setIsAnonymous}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>

          {/* Confirmação obrigatória de privacidade da imagem */}
          <Pressable
            onPress={() => setPrivacyConfirmed((v) => !v)}
            style={[
              styles.privacyCheckCard,
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
            <Text style={[styles.privacyCheckText, { color: colors.text }]}>
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

          <View style={styles.footerButtons}>
            <CancelButton
              label="Cancelar"
              onPress={handleDismiss}
              disabled={saving}
              style={styles.footerBtn}
            />
            <SaveButton
              label={saving ? 'Publicando...' : 'Publicar Relato'}
              icon="check"
              onPress={handlePublish}
              loading={saving}
              disabled={!privacyConfirmed || saving}
              style={styles.footerBtn}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 19,
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
    gap: 14,
    paddingBottom: 24,
  },
  photoCard: {
    overflow: 'hidden',
  },
  photoPreview: {
    width: '100%',
    height: 190,
  },
  photoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    gap: 10,
    flexWrap: 'wrap',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  privacyCheckCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    gap: 10,
  },
  privacyCheckText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  sectionCard: {
    padding: 14,
    gap: 12,
  },
  gpsStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gpsStatusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  fieldGroup: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  charCount: {
    fontSize: 11,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    minHeight: 46,
    gap: 9,
  },
  singleLineInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  multiLineInput: {
    minHeight: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switchIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchInfo: {
    flex: 1,
    gap: 2,
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  switchSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 9,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  footerBtn: {
    flex: 1,
  },
});

export default NewReportModal;
