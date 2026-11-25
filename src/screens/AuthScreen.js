import { FontAwesome6 } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SharedStyles } from '../../components/StyleSheet/Styles';
import { PrimaryButton, SecondaryButton } from '../../components/common/Buttons';
import { APP_NAME, APP_VERSION } from '../constants/appVersion';
import { useAppSettings } from '../context/AppSettingsContext';
import { authService } from '../services/authService';
import { recordAppErrorLog } from '../services/diagnosticLogService';

export function AuthScreen({ onAuthenticated, initialMode = 'login' }) {
  const insets = useSafeAreaInsets();
  const { colors, isDark, toggleDarkMode, radiusCard, radiusInput, borderWidth, cardShadow, typography } =
    useAppSettings();

  const [mode, setMode] = useState(initialMode === 'register' ? 'register' : 'login'); // 'login' | 'register'
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMode(initialMode === 'register' ? 'register' : 'login');
    setErrorMsg('');
  }, [initialMode]);

  useEffect(() => {
    let active = true;
    authService.getRememberMePreferences().then((prefs) => {
      if (!active || !prefs) return;
      setRememberMe(Boolean(prefs.rememberMe));
      if (prefs.savedEmail) {
        setEmail((prev) => prev || prefs.savedEmail);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const isRegister = mode === 'register';

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setErrorMsg('');
  };

  const handleSubmit = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      const session = isRegister
        ? await authService.register({ nickname, email, password })
        : await authService.login({ email, password, rememberMe });
      if (typeof onAuthenticated === 'function') {
        onAuthenticated(session);
      }
    } catch (err) {
      if (err?.isAuthError) {
        console.warn(
          isRegister ? '[AUTH_REGISTER_WARN]' : '[AUTH_LOGIN_WARN]',
          err.message
        );
        if (err.code === 'EMAIL_ALREADY_REGISTERED') {
          setMode('login');
        }
      } else {
        console.error(
          isRegister ? '[AUTH_REGISTER_ERROR]' : '[AUTH_LOGIN_ERROR]',
          err?.message,
          err?.stack
        );
        await recordAppErrorLog(isRegister ? 'AuthScreen.register' : 'AuthScreen.login', err, {
          mode,
          stackHead: String(err?.stack || '').slice(0, 140),
        });
      }
      setErrorMsg(err?.message || 'Não foi possível concluir a operação.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      const session = await authService.loginDemo();
      if (typeof onAuthenticated === 'function') {
        onAuthenticated(session);
      }
    } catch (err) {
      if (err?.isAuthError) {
        console.warn('[AUTH_DEMO_WARN]', err.message);
      } else {
        console.error('[AUTH_DEMO_ERROR]', err?.message, err?.stack);
      }
      setErrorMsg(err?.message || 'Falha ao iniciar o modo demonstração.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable
        onPress={toggleDarkMode}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={isDark ? 'Ativar Modo Claro' : 'Ativar Modo Escuro'}
        style={({ pressed }) => [
          styles.themeToggleBtn,
          cardShadow,
          {
            top: Math.max(14, insets.top + 8),
            right: 16,
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <FontAwesome6
          name={isDark ? 'sun' : 'moon'}
          size={17}
          color={isDark ? colors.warning : colors.primary}
        />
      </Pressable>

      <ScrollView
        contentContainerStyle={[
          SharedStyles.contentContainer,
          styles.scrollContent,
          {
            paddingTop: Math.max(58, insets.top + 48),
            paddingBottom: Math.max(24, insets.bottom + 16),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandBlock}>
          <View style={[styles.logoBadge, { backgroundColor: colors.primary }]}>
            <FontAwesome6 name="road" size={26} color={colors.primaryText} />
          </View>
          <Text
            style={[
              styles.appTitle,
              {
                color: colors.text,
                fontWeight: typography.headingWeight,
                letterSpacing: typography.letterSpacing,
              },
            ]}
          >
            {APP_NAME}
          </Text>
          <Text style={[styles.appSubtitle, { color: colors.textSecondary }]}>
            Mapeamento colaborativo de buracos e manutenção viária na sua cidade.
          </Text>
        </View>

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
              styles.segmented,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: radiusInput,
              },
            ]}
          >
            <Pressable
              onPress={() => switchMode('login')}
              style={[
                styles.segmentBtn,
                {
                  backgroundColor: !isRegister ? colors.card : 'transparent',
                  borderRadius: Math.max(6, radiusInput - 4),
                },
                !isRegister ? cardShadow : null,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: !isRegister ? colors.primary : colors.textSecondary },
                ]}
              >
                Entrar
              </Text>
            </Pressable>

            <Pressable
              onPress={() => switchMode('register')}
              style={[
                styles.segmentBtn,
                {
                  backgroundColor: isRegister ? colors.card : 'transparent',
                  borderRadius: Math.max(6, radiusInput - 4),
                },
                isRegister ? cardShadow : null,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: isRegister ? colors.primary : colors.textSecondary },
                ]}
              >
                Criar Conta
              </Text>
            </Pressable>
          </View>

          {isRegister ? (
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Apelido</Text>
              <View
                style={[
                  styles.inputWrap,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                    borderWidth,
                    borderRadius: radiusInput,
                  },
                ]}
              >
                <FontAwesome6 name="user" size={14} color={colors.textMuted} />
                <TextInput
                  value={nickname}
                  onChangeText={setNickname}
                  placeholder="Como deseja aparecer nos relatos"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  style={[styles.input, { color: colors.text }]}
                />
              </View>
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.text }]}>E-mail</Text>
            <View
              style={[
                styles.inputWrap,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusInput,
                },
              ]}
            >
              <FontAwesome6 name="envelope" size={14} color={colors.textMuted} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="seuemail@exemplo.com.br"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: colors.text }]}
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Senha</Text>
            <View
              style={[
                styles.inputWrap,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusInput,
                },
              ]}
            >
              <FontAwesome6 name="lock" size={14} color={colors.textMuted} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={isRegister ? 'Mínimo de 6 caracteres' : 'Digite sua senha'}
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                style={[styles.input, { color: colors.text }]}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                <FontAwesome6
                  name={showPassword ? 'eye-slash' : 'eye'}
                  size={15}
                  color={colors.textMuted}
                />
              </Pressable>
            </View>
          </View>

          {isRegister ? (
            <View
              style={[
                styles.lgpdBox,
                {
                  backgroundColor: colors.accentSoft,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: radiusInput,
                },
              ]}
            >
              <FontAwesome6 name="shield-halved" size={16} color={colors.primary} />
              <Text style={[styles.lgpdText, { color: colors.textSecondary }]}>
                Aviso de Privacidade (LGPD): sua senha é protegida com hash criptográfico
                (SHA-256 + salt exclusivo) antes de ser armazenada — jamais salvamos senhas em
                texto puro. Você também pode publicar de forma anônima a qualquer momento.
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={() => setRememberMe((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: rememberMe }}
              accessibilityLabel="Lembrar-me"
              style={({ pressed }) => [
                styles.rememberRow,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: rememberMe ? '#1A73E8' : colors.border,
                  borderWidth: 1,
                  borderRadius: radiusInput,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <View style={styles.rememberTextWrap}>
                <Text style={[styles.rememberTitle, { color: colors.text }]}>Lembrar-me</Text>
                <Text style={[styles.rememberSubtitle, { color: colors.textSecondary }]}>
                  Manter e-mail e sessão salvos neste dispositivo
                </Text>
              </View>
              <View
                style={[
                  styles.customToggleTrack,
                  {
                    backgroundColor: rememberMe
                      ? '#1A73E8'
                      : isDark
                        ? '#475569'
                        : '#CBD5E1',
                    borderColor: rememberMe
                      ? '#1A73E8'
                      : isDark
                        ? '#64748B'
                        : '#94A3B8',
                  },
                ]}
              >
                <View
                  style={[
                    styles.customToggleThumb,
                    {
                      alignSelf: rememberMe ? 'flex-end' : 'flex-start',
                    },
                  ]}
                >
                  {rememberMe ? <FontAwesome6 name="check" size={11} color="#1A73E8" /> : null}
                </View>
              </View>
            </Pressable>
          )}

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

          <PrimaryButton
            label={isRegister ? 'Criar Conta' : 'Entrar'}
            icon={isRegister ? 'user-plus' : 'right-to-bracket'}
            onPress={handleSubmit}
            loading={loading}
          />

          {!isRegister ? (
            <>
              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: colors.dividerColor }]} />
                <Text style={[styles.dividerLabel, { color: colors.textMuted }]}>ou</Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.dividerColor }]} />
              </View>

              <SecondaryButton
                label="Entrar em Modo Demonstração"
                icon="compass"
                onPress={handleDemoLogin}
                disabled={loading}
              />
            </>
          ) : null}
        </View>

        <Text style={[styles.footerVersion, { color: colors.textMuted }]}>
          {APP_NAME} • v{APP_VERSION} • Compatível com LGPD
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  themeToggleBtn: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    gap: 18,
  },
  brandBlock: {
    alignItems: 'center',
    gap: 8,
  },
  logoBadge: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  appTitle: {
    fontSize: 26,
  },
  appSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 340,
  },
  card: {
    padding: 18,
    gap: 14,
  },
  segmented: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '700',
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    minHeight: 48,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  lgpdBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    gap: 10,
  },
  lgpdText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  rememberTextWrap: {
    flex: 1,
    gap: 2,
  },
  rememberTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  rememberSubtitle: {
    fontSize: 11,
    lineHeight: 15,
  },
  customToggleTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 2,
    justifyContent: 'center',
  },
  customToggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 11,
    gap: 9,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  footerVersion: {
    textAlign: 'center',
    fontSize: 12,
  },
});

export default AuthScreen;
