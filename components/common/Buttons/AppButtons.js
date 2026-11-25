import { FontAwesome6 } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppSettings } from '../../../src/context/AppSettingsContext';

function BaseAppButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  loading = false,
  compact = false,
  style,
  textStyle,
}) {
  const { colors, radiusButton, borderWidth, typography } = useAppSettings();

  const variantMap = {
    primary: {
      bg: colors.primary,
      fg: colors.primaryText,
      border: colors.primary,
    },
    save: {
      bg: colors.success,
      fg: '#FFFFFF',
      border: colors.success,
    },
    secondary: {
      bg: colors.surfaceMuted,
      fg: colors.text,
      border: colors.border,
    },
    cancel: {
      bg: colors.surface,
      fg: colors.textSecondary,
      border: colors.border,
    },
    danger: {
      bg: colors.danger,
      fg: '#FFFFFF',
      border: colors.danger,
    },
    ghost: {
      bg: 'transparent',
      fg: colors.primary,
      border: 'transparent',
    },
  };

  const scheme = variantMap[variant] || variantMap.primary;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      android_ripple={{ color: colors.accentSoft }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compactButton,
        {
          backgroundColor: isDisabled ? colors.disabledBackground : scheme.bg,
          borderColor: isDisabled ? colors.border : scheme.border,
          borderWidth: variant === 'ghost' ? 0 : borderWidth,
          borderRadius: radiusButton,
          opacity: pressed && !isDisabled ? 0.86 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={scheme.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <FontAwesome6 name={icon} size={compact ? 14 : 15} color={scheme.fg} /> : null}
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              compact && styles.compactLabel,
              {
                color: isDisabled ? colors.textMuted : scheme.fg,
                fontWeight: typography.labelWeight,
                letterSpacing: typography.letterSpacing,
              },
              textStyle,
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function PrimaryButton(props) {
  return <BaseAppButton {...props} variant="primary" />;
}

export function SaveButton(props) {
  return <BaseAppButton {...props} variant="save" />;
}

export function SecondaryButton(props) {
  return <BaseAppButton {...props} variant="secondary" />;
}

export function CancelButton(props) {
  return <BaseAppButton {...props} variant="cancel" />;
}

export function DangerButton(props) {
  return <BaseAppButton {...props} variant="danger" />;
}

export function GhostButton(props) {
  return <BaseAppButton {...props} variant="ghost" />;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    fontSize: 15,
  },
  compactLabel: {
    fontSize: 13,
  },
});
