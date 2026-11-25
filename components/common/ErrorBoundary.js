import { FontAwesome6 } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { recordAppErrorLog } from '../../src/services/diagnosticLogService';
import { DEFAULT_THEME_ID, getThemeById } from '../../src/theme/themes';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Ocorreu uma falha inesperada na interface.',
    };
  }

  componentDidCatch(error, errorInfo) {
    recordAppErrorLog('ErrorBoundary', error, {
      componentStackPresent: Boolean(errorInfo?.componentStack),
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const fallbackTheme = getThemeById(DEFAULT_THEME_ID);
    const { colors, shape, cardShadow } = fallbackTheme;

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.card,
            cardShadow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: shape.borderWidth,
              borderRadius: shape.radiusCard,
            },
          ]}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.dangerSoft }]}>
            <FontAwesome6 name="triangle-exclamation" size={26} color={colors.danger} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Ops! Algo deu errado</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            O aplicativo encontrou um erro inesperado. Um registro anônimo foi salvo localmente
            para ajudar no diagnóstico.
          </Text>
          <View
            style={[
              styles.errorBox,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: shape.radiusInput,
                borderColor: colors.border,
                borderWidth: 1,
              },
            ]}
          >
            <Text style={[styles.errorText, { color: colors.textSecondary }]} numberOfLines={4}>
              {this.state.errorMessage}
            </Text>
          </View>
          <Pressable
            onPress={this.handleReset}
            style={[
              styles.button,
              { backgroundColor: colors.primary, borderRadius: shape.radiusButton },
            ]}
          >
            <FontAwesome6 name="rotate" size={15} color={colors.primaryText} />
            <Text style={[styles.buttonText, { color: colors.primaryText }]}>Tentar Novamente</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    padding: 24,
    alignItems: 'center',
    gap: 14,
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorBox: {
    width: '100%',
    padding: 12,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
  },
  button: {
    width: '100%',
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default ErrorBoundary;
