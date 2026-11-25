import { FontAwesome6 } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppSettings } from '../../src/context/AppSettingsContext';
import { CancelButton, DangerButton, PrimaryButton, SecondaryButton } from './Buttons';

export function ConfirmModal({
  visible,
  inline = false,
  title,
  message,
  icon = 'circle-info',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  secondaryLabel,
  onConfirm,
  onSecondaryPress,
  onCancel,
  danger = false,
  hideCancel = false,
}) {
  const insets = useSafeAreaInsets();
  const { colors, radiusCard, borderWidth, cardShadow } = useAppSettings();

  if (inline && !visible) {
    return null;
  }

  const content = (
    <View
      style={[
        styles.backdrop,
        inline ? styles.inlineOverlay : null,
        {
          backgroundColor: colors.overlay,
          paddingTop: Math.max(20, insets.top),
          paddingBottom: Math.max(20, insets.bottom),
        },
      ]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
      <View
        style={[
          styles.card,
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
          style={[
            styles.iconWrap,
            { backgroundColor: danger ? colors.dangerSoft : colors.accentSoft },
          ]}
        >
          <FontAwesome6
            name={icon}
            size={22}
            color={danger ? colors.danger : colors.primary}
          />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {message ? (
          <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
        ) : null}

        <View style={styles.actions}>
          {secondaryLabel && onSecondaryPress ? (
            <SecondaryButton label={secondaryLabel} onPress={onSecondaryPress} />
          ) : null}

          <View style={styles.rowActions}>
            {!hideCancel ? (
              <CancelButton label={cancelLabel} onPress={onCancel} style={styles.flexButton} />
            ) : null}
            {danger ? (
              <DangerButton
                label={confirmLabel}
                onPress={onConfirm}
                style={styles.flexButton}
              />
            ) : (
              <PrimaryButton
                label={confirmLabel}
                onPress={onConfirm}
                style={styles.flexButton}
              />
            )}
          </View>
        </View>
      </View>
    </View>
  );

  if (inline) {
    return content;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  inlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    padding: 22,
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: 10,
    marginTop: 6,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 10,
  },
  flexButton: {
    flex: 1,
  },
});

export default ConfirmModal;
