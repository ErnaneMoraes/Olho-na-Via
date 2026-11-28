import { FontAwesome6 } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_BUILD_TAG, APP_CHANGELOG, APP_NAME, APP_VERSION } from '../../src/constants/appVersion';
import {
  getAnonymousModeConfirmationCopy,
  useAppSettings,
} from '../../src/context/AppSettingsContext';
import { authService } from '../../src/services/authService';
import {
  clearDiagnosticLogs,
  formatDiagnosticReportText,
  getAnonymousDeviceContext,
  getDiagnosticLogs,
  recordDiagnosticEvent,
} from '../../src/services/diagnosticLogService';
import { AdminPanelModal } from '../../src/components/AdminPanelModal';
import { OnboardingScreen } from '../../src/screens/OnboardingScreen';
import { SharedStyles } from '../StyleSheet/Styles';
import { DangerButton, PrimaryButton, SecondaryButton } from '../common/Buttons';
import { ConfirmModal } from '../common/ConfirmModal';

if (
  Platform.OS === 'android' &&
  !global?.nativeFabricUIManager &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function AccordionSection({
  title,
  icon,
  isOpen,
  onToggle,
  variant = 'default',
  children,
}) {
  const { colors, radiusCard, borderWidth, cardShadow } = useAppSettings();
  const isDanger = variant === 'danger';

  return (
    <View
      style={[
        styles.accordionCard,
        !isDanger ? cardShadow : styles.noShadowCard,
        {
          backgroundColor: isDanger ? colors.adminCardBg : colors.card,
          borderColor: isDanger ? colors.adminCardBorder : colors.border,
          borderWidth,
          borderRadius: isDanger ? 20 : radiusCard,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        android_ripple={{ color: isDanger ? colors.dangerSoft : colors.accentSoft }}
        style={styles.accordionHeader}
      >
        <View style={styles.accordionHeaderLeft}>
          <View
            style={[
              styles.accordionIcon,
              { backgroundColor: isDanger ? colors.dangerSoft : colors.accentSoft },
            ]}
          >
            <FontAwesome6
              name={icon}
              size={15}
              color={isDanger ? colors.adminCardTitle : colors.primary}
            />
          </View>
          <Text
            style={[
              styles.accordionTitle,
              { color: isDanger ? colors.adminCardTitle : colors.text },
            ]}
          >
            {title}
          </Text>
        </View>
        <View style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}>
          <FontAwesome6
            name="chevron-down"
            size={14}
            color={isDanger ? colors.adminCardTitle : colors.textSecondary}
          />
        </View>
      </Pressable>
      {isOpen ? (
        <View
          style={[
            styles.accordionBody,
            { borderTopColor: isDanger ? colors.adminCardBorder : colors.dividerColor },
          ]}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

export function SettingsModal({
  visible,
  session,
  onSetAnonymousMode,
  onModerationChange,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const {
    colors,
    darkMode,
    toggleDarkMode,
    defaultAnonymous,
    setDefaultAnonymous,
    cameraShutterSound,
    setCameraShutterSound,
    adminModeEnabled,
    setAdminModeEnabled,
    radiusCard,
    radiusInput,
    borderWidth,
    cardShadow,
    typography,
  } = useAppSettings();

  const [openSection, setOpenSection] = useState(null);
  const [anonToastMsg, setAnonToastMsg] = useState('');
  const [pendingAnonymousTarget, setPendingAnonymousTarget] = useState(null);
  const anonToastTimerRef = useRef(null);
  const [logs, setLogs] = useState([]);
  const [diagFeedback, setDiagFeedback] = useState('');
  const [showQuickGuide, setShowQuickGuide] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const { width: windowWidth } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isCompactWidth = windowWidth < 600;
  const isRealAdmin = Boolean(session?.isAdmin && !session?.isDemo);
  const effectiveIsAdmin = Boolean(isRealAdmin && adminModeEnabled);
  const currentAnonymousValue =
    typeof session?.isAnonymousMode === 'boolean' ? session.isAnonymousMode : defaultAnonymous;

  useEffect(() => {
    if (!effectiveIsAdmin && showAdminPanel) {
      setShowAdminPanel(false);
    }
  }, [effectiveIsAdmin, showAdminPanel]);

  const topSafePadding = isWeb
    ? 16
    : Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 12) + 8;

  const triggerAnonToast = () => {
    if (anonToastTimerRef.current) {
      clearTimeout(anonToastTimerRef.current);
    }
    setAnonToastMsg(
      'Modo anônimo ativado: sua identidade continua visível apenas para administradores.'
    );
    anonToastTimerRef.current = setTimeout(() => {
      setAnonToastMsg('');
    }, 4000);
  };

  useEffect(() => {
    return () => {
      if (anonToastTimerRef.current) {
        clearTimeout(anonToastTimerRef.current);
      }
    };
  }, []);

  const loadLogs = useCallback(async () => {
    const items = await getDiagnosticLogs();
    setLogs(items);
  }, []);

  useEffect(() => {
    if (visible) {
      setOpenSection(null);
      setAnonToastMsg('');
      setPendingAnonymousTarget(null);
      if (effectiveIsAdmin) {
        loadLogs();
      } else {
        setLogs([]);
      }
      setDiagFeedback('');
      setShowQuickGuide(false);
      setShowAdminPanel(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setShowCurrentPwd(false);
      setShowNewPwd(false);
      setPasswordError('');
      setPasswordSuccess('');
    }
  }, [visible, effectiveIsAdmin, loadLogs]);

  const handleChangePassword = async () => {
    if (changingPassword) return;
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) {
      setPasswordError('Informe sua senha atual.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('A confirmação não confere com a nova senha.');
      return;
    }

    setChangingPassword(true);
    try {
      const result = await authService.changeOwnPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordSuccess(result?.message || 'Senha alterada com sucesso!');
    } catch (err) {
      setPasswordError(err?.message || 'Não foi possível alterar a senha agora.');
    } finally {
      setChangingPassword(false);
    }
  };

  const toggleSection = (key) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSection((prev) => (prev === key ? null : key));
  };

  const handleExportLogs = async () => {
    const items = await getDiagnosticLogs();
    const report = formatDiagnosticReportText(items);

    if (Platform.OS === 'web') {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(report);
          setDiagFeedback('Relatório anônimo copiado para a área de transferência.');
          return;
        }
        if (typeof document !== 'undefined') {
          const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'diagnostico-olho-na-via.txt';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setDiagFeedback('Relatório anônimo baixado em arquivo .txt.');
          return;
        }
      } catch {
        setDiagFeedback('Não foi possível exportar o relatório no navegador.');
        return;
      }
    }

    try {
      await Share.share({
        title: `Diagnóstico ${APP_NAME}`,
        message: report,
      });
      setDiagFeedback('Relatório anônimo preparado para compartilhamento.');
    } catch {
      setDiagFeedback('Não foi possível abrir o compartilhamento.');
    }
  };

  const handleRecordSampleEvent = async () => {
    await recordDiagnosticEvent('DIAGNOSTICO', 'Teste manual de telemetria anônima LGPD');
    await loadLogs();
    setDiagFeedback('Evento anônimo registrado localmente.');
  };

  const handleClearLogs = async () => {
    await clearDiagnosticLogs();
    setLogs([]);
    setDiagFeedback('Histórico de diagnóstico limpo.');
  };

  const deviceCtx = getAnonymousDeviceContext();

  const settingsBody = (
    <View
      style={[
        isWeb ? styles.screenCardWeb : styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: topSafePadding,
          paddingBottom: isWeb ? 16 : Math.max(12, insets.bottom),
        },
        isWeb ? [cardShadow, { borderColor: colors.border, borderWidth }] : null,
      ]}
    >
      <View style={[SharedStyles.contentContainer, styles.header]}>
        <View style={styles.headerTitleWrap}>
          <FontAwesome6 name="gear" size={18} color={colors.primary} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Configurações</Text>
        </View>
        <View style={styles.headerActionsRow}>
          <Pressable
            onPress={toggleDarkMode}
            hitSlop={8}
            accessibilityLabel={
              darkMode ? 'Alternar para modo claro' : 'Alternar para modo escuro'
            }
            style={[
              styles.closeIconBtn,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: 20,
              },
            ]}
          >
            <FontAwesome6
              name={darkMode ? 'sun' : 'moon'}
              size={16}
              color={darkMode ? colors.warning : colors.primary}
            />
          </Pressable>

          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityLabel="Fechar configurações"
            style={[
              styles.closeIconBtn,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: 20,
              },
            ]}
          >
            <FontAwesome6 name="xmark" size={16} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={isWeb ? styles.webScroll : undefined}
        contentContainerStyle={[SharedStyles.contentContainer, styles.scrollContent]}
        showsVerticalScrollIndicator={false}
      >
          <View style={styles.accordionsContainer}>
            {/* Toggle exclusivo de Modo Administrador para admins reais */}
            {isRealAdmin ? (
              <View
                style={[
                  styles.accordionCard,
                  cardShadow,
                  {
                    backgroundColor: colors.card,
                    borderColor: adminModeEnabled ? colors.adminCardBorder : colors.border,
                    borderWidth,
                    borderRadius: radiusCard,
                    padding: 14,
                  },
                ]}
              >
                <View style={styles.switchRow}>
                  <View style={styles.switchInfo}>
                    <Text style={[styles.switchTitle, { color: colors.text }]}>
                      Ativar Modo Administrador
                    </Text>
                    <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                      Desative para testar e usar o aplicativo exatamente como um cidadão comum.
                    </Text>
                  </View>
                  <Switch
                    value={adminModeEnabled}
                    onValueChange={(nextVal) => {
                      setAdminModeEnabled(nextVal);
                      if (!nextVal && (openSection === 'diagnostics' || openSection === 'admin')) {
                        setOpenSection(null);
                      }
                    }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>
            ) : null}

            {/* 0. Perfil & Apelido */}
            <AccordionSection
              title="Perfil & Apelido"
              icon="user"
              isOpen={openSection === 'profile'}
              onToggle={() => toggleSection('profile')}
            >
              <View style={styles.subsectionList}>
                <View
                  style={[
                    styles.subCard,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: radiusInput,
                    },
                  ]}
                >
                  <Text style={[styles.subCardTitle, { color: colors.text }]}>
                    Apelido: {session?.nickname || 'Visitante'}
                  </Text>
                  <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                    Tipo de conta:{' '}
                    {session?.isDemo
                      ? 'Modo Demonstração (Somente Leitura)'
                      : effectiveIsAdmin
                        ? 'Administrador Autorizado'
                        : 'Cidadão Autenticado'}
                  </Text>
                </View>
              </View>
            </AccordionSection>

            {/* 1. Privacidade e LGPD */}
            <AccordionSection
              title="Privacidade e Postagem (LGPD)"
              icon="user-shield"
              isOpen={openSection === 'privacy'}
              onToggle={() => toggleSection('privacy')}
            >
              <View style={styles.subsectionList}>
                {session?.isDemo ? (
                  <View
                    style={[
                      styles.subCard,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                        borderWidth: 1,
                        borderRadius: radiusInput,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                      },
                    ]}
                  >
                    <FontAwesome6 name="lock" size={14} color={colors.primary} />
                    <Text style={[styles.helperText, { color: colors.textSecondary, flex: 1 }]}>
                      Modo Demonstração (Somente Leitura): a alteração de preferências de postagem
                      está desativada para visitantes. Crie uma conta gratuita para personalizar sua
                      privacidade.
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.switchRow}>
                      <View style={styles.switchInfo}>
                        <Text style={[styles.switchTitle, { color: colors.text }]}>
                          Postar como Anônimo por padrão
                        </Text>
                        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                          Seu apelido ficará oculto para o público ('Usuário Anônimo'), mas
                          administradores podem visualizar sua identidade para moderação.
                        </Text>
                      </View>
                      <Switch
                        value={currentAnonymousValue}
                        onValueChange={(nextVal) => {
                          setPendingAnonymousTarget(Boolean(nextVal));
                        }}
                        trackColor={{ false: colors.border, true: colors.primary }}
                        thumbColor="#FFFFFF"
                      />
                    </View>

                    {currentAnonymousValue ? (
                      <View
                        style={[
                          styles.infoCallout,
                          {
                            backgroundColor: colors.infoBannerBg,
                            borderColor: colors.infoBannerBorder,
                            borderRadius: radiusInput,
                          },
                        ]}
                      >
                        <FontAwesome6 name="circle-info" size={14} color={colors.primary} />
                        <Text style={[styles.infoCalloutText, { color: colors.infoBannerText }]}>
                          Aviso de transparência: sua identidade continua visível apenas para
                          administradores do sistema para prevenção de abusos e moderação.
                        </Text>
                      </View>
                    ) : null}

                    {anonToastMsg ? (
                      <View style={[styles.toastPill, { backgroundColor: colors.text }]}>
                        <FontAwesome6 name="circle-info" size={12} color={colors.background} />
                        <Text style={[styles.toastPillText, { color: colors.background }]}>
                          {anonToastMsg}
                        </Text>
                      </View>
                    ) : null}
                  </>
                )}

                <View
                  style={[
                    styles.subCard,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: radiusInput,
                    },
                  ]}
                >
                  <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                    Compromisso de Privacidade (LGPD): quando o modo anônimo está ativo, sua
                    identidade não é exibida publicamente no mapa, mantendo vínculo interno restrito
                    à moderação contra abusos.
                  </Text>
                </View>
              </View>
            </AccordionSection>

            {/* 2. Câmera e Captura */}
            <AccordionSection
              title="Câmera e Captura"
              icon="camera"
              isOpen={openSection === 'camera'}
              onToggle={() => toggleSection('camera')}
            >
              <View style={styles.subsectionList}>
                <View style={styles.switchRow}>
                  <View style={styles.switchInfo}>
                    <Text style={[styles.switchTitle, { color: colors.text }]}>
                      Som da câmera ao fotografar
                    </Text>
                    <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                      Reproduzir som do obturador ao registrar foto
                    </Text>
                  </View>
                  <Switch
                    value={cameraShutterSound}
                    onValueChange={setCameraShutterSound}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>
            </AccordionSection>

            {/* 3. Segurança da Conta (usuários autenticados fora do Modo Demo) */}
            {session && !session.isDemo ? (
              <AccordionSection
                title="Segurança da Conta"
                icon="lock"
                isOpen={openSection === 'security'}
                onToggle={() => toggleSection('security')}
              >
                <View style={styles.subsectionList}>
                  <Text style={[styles.subCardTitle, { color: colors.text }]}>
                    Alterar Minha Senha
                  </Text>
                  <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                    Confirme sua senha atual antes de definir uma nova senha de acesso.
                  </Text>

                  <View style={styles.pwdFieldGroup}>
                    <Text style={[styles.pwdLabel, { color: colors.text }]}>Senha Atual</Text>
                    <View
                      style={[
                        styles.pwdInputWrap,
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
                        value={currentPassword}
                        onChangeText={setCurrentPassword}
                        placeholder="Digite sua senha atual"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showCurrentPwd}
                        autoCapitalize="none"
                        style={[styles.pwdInput, { color: colors.text }]}
                      />
                      <Pressable onPress={() => setShowCurrentPwd((v) => !v)} hitSlop={8}>
                        <FontAwesome6
                          name={showCurrentPwd ? 'eye-slash' : 'eye'}
                          size={15}
                          color={colors.textMuted}
                        />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.pwdFieldGroup}>
                    <Text style={[styles.pwdLabel, { color: colors.text }]}>
                      Nova Senha (mín. 6 caracteres)
                    </Text>
                    <View
                      style={[
                        styles.pwdInputWrap,
                        {
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.border,
                          borderWidth,
                          borderRadius: radiusInput,
                        },
                      ]}
                    >
                      <FontAwesome6 name="key" size={14} color={colors.textMuted} />
                      <TextInput
                        value={newPassword}
                        onChangeText={setNewPassword}
                        placeholder="Mínimo de 6 caracteres"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showNewPwd}
                        autoCapitalize="none"
                        style={[styles.pwdInput, { color: colors.text }]}
                      />
                      <Pressable onPress={() => setShowNewPwd((v) => !v)} hitSlop={8}>
                        <FontAwesome6
                          name={showNewPwd ? 'eye-slash' : 'eye'}
                          size={15}
                          color={colors.textMuted}
                        />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.pwdFieldGroup}>
                    <Text style={[styles.pwdLabel, { color: colors.text }]}>
                      Confirmar Nova Senha
                    </Text>
                    <View
                      style={[
                        styles.pwdInputWrap,
                        {
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.border,
                          borderWidth,
                          borderRadius: radiusInput,
                        },
                      ]}
                    >
                      <FontAwesome6 name="check" size={14} color={colors.textMuted} />
                      <TextInput
                        value={confirmNewPassword}
                        onChangeText={setConfirmNewPassword}
                        placeholder="Repita a nova senha"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showNewPwd}
                        autoCapitalize="none"
                        style={[styles.pwdInput, { color: colors.text }]}
                      />
                    </View>
                  </View>

                  {passwordError ? (
                    <View
                      style={[
                        styles.pwdFeedbackBanner,
                        {
                          backgroundColor: colors.dangerSoft,
                          borderColor: colors.danger,
                          borderRadius: radiusInput,
                        },
                      ]}
                    >
                      <FontAwesome6 name="circle-exclamation" size={14} color={colors.danger} />
                      <Text style={[styles.pwdFeedbackText, { color: colors.dangerText }]}>
                        {passwordError}
                      </Text>
                    </View>
                  ) : null}

                  {passwordSuccess ? (
                    <View
                      style={[
                        styles.pwdFeedbackBanner,
                        {
                          backgroundColor: colors.successSoft,
                          borderColor: colors.success,
                          borderRadius: radiusInput,
                        },
                      ]}
                    >
                      <FontAwesome6 name="circle-check" size={14} color={colors.success} />
                      <Text style={[styles.pwdFeedbackText, { color: colors.success }]}>
                        {passwordSuccess}
                      </Text>
                    </View>
                  ) : null}

                  <PrimaryButton
                    compact
                    label={changingPassword ? 'Salvando...' : 'Salvar Nova Senha'}
                    icon="check"
                    loading={changingPassword}
                    disabled={changingPassword}
                    onPress={handleChangePassword}
                  />
                </View>
              </AccordionSection>
            ) : null}

            {/* 4. Diagnóstico Anônimo (somente administradores com Modo Admin ativo) */}
            {effectiveIsAdmin ? (
              <AccordionSection
                title="Diagnóstico Anônimo (LGPD)"
                icon="stethoscope"
                isOpen={openSection === 'diagnostics'}
                onToggle={() => toggleSection('diagnostics')}
              >
                <View style={styles.subsectionList}>
                  <View
                    style={[
                      styles.subCard,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                        borderWidth: 1,
                        borderRadius: radiusInput,
                      },
                    ]}
                  >
                    <Text style={[styles.subCardTitle, { color: colors.text }]}>
                      1. Ambiente e Versão (Sem PII)
                    </Text>
                    <Text
                      style={[
                        styles.monoText,
                        { color: colors.textSecondary, fontVariant: typography.fontVariant },
                      ]}
                    >
                      {`${deviceCtx.appName} v${deviceCtx.appVersion} (${deviceCtx.buildTag})\n`}
                      {`Sistema: ${deviceCtx.platform} ${deviceCtx.osVersion} • Tela: ${deviceCtx.screenWidth}x${deviceCtx.screenHeight}px`}
                    </Text>
                  </View>

                  <View style={styles.grid2x2}>
                    <View style={styles.gridRow}>
                      <SecondaryButton
                        compact
                        icon="rotate"
                        label="Atualizar Logs"
                        onPress={loadLogs}
                        style={styles.gridCell}
                      />
                      <SecondaryButton
                        compact
                        icon="file-lines"
                        label="Exportar Texto"
                        onPress={handleExportLogs}
                        style={styles.gridCell}
                      />
                    </View>
                    <View style={styles.gridRow}>
                      <SecondaryButton
                        compact
                        icon="wand-magic-sparkles"
                        label="Registrar Teste"
                        onPress={handleRecordSampleEvent}
                        style={styles.gridCell}
                      />
                      <SecondaryButton
                        compact
                        icon="trash-can"
                        label="Limpar Logs"
                        onPress={handleClearLogs}
                        style={styles.gridCell}
                      />
                    </View>
                  </View>

                  {diagFeedback ? (
                    <Text style={[styles.feedbackText, { color: colors.primary }]}>
                      {diagFeedback}
                    </Text>
                  ) : null}

                  <View
                    style={[
                      styles.subCard,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                        borderWidth: 1,
                        borderRadius: radiusInput,
                      },
                    ]}
                  >
                    <Text style={[styles.subCardTitle, { color: colors.text }]}>
                      2. Eventos Locais Recentes ({logs.length})
                    </Text>
                    {logs.length === 0 ? (
                      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                        Nenhum evento registrado até o momento.
                      </Text>
                    ) : (
                      logs.slice(0, 8).map((entry) => (
                        <View
                          key={entry.id}
                          style={[styles.logRow, { borderTopColor: colors.dividerColor }]}
                        >
                          <Text style={[styles.logCategory, { color: colors.primary }]}>
                            [{entry.category}]
                          </Text>
                          <Text style={[styles.logMessage, { color: colors.text }]}>
                            {entry.message}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                </View>
              </AccordionSection>
            ) : null}

            {/* 4. Sobre o Aplicativo */}
            <AccordionSection
              title="Sobre o Olho na Via"
              icon="circle-info"
              isOpen={openSection === 'about'}
              onToggle={() => toggleSection('about')}
            >
              <View style={styles.subsectionList}>
                <Text style={[styles.subCardTitle, { color: colors.text }]}>
                  {APP_NAME} — v{APP_VERSION}
                </Text>
                <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                  O Olho na Via é uma plataforma colaborativa gratuita para mapear buracos e
                  acompanhar reparos nas vias da sua cidade em tempo real.
                </Text>
                <View
                  style={[
                    styles.subCard,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: radiusInput,
                    },
                  ]}
                >
                  <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                    • Registros e confirmações funcionam ao vivo pela câmera traseira no aplicativo
                    Android ou no navegador do celular (bloqueado em computadores), apenas com o
                    veículo parado em segurança.{'\n'}
                    • É proibido enviar imagens com rostos, crianças, selfies, placas de veículos,
                    números de casas ou conteúdo impróprio.{'\n'}
                    • Antes do envio, você revisa a foto e pode desenhar tarjas escuras com o dedo
                    sobre qualquer placa ou endereço ao fundo.{'\n'}
                    • Se preferir, ative o modo anônimo para ocultar seu apelido do público geral.
                  </Text>
                </View>
                <PrimaryButton
                  compact
                  label="Ver Tutorial Inicial (Onboarding)"
                  icon="book-open"
                  onPress={() => setShowQuickGuide(true)}
                />

                {effectiveIsAdmin ? (
                  <>
                    <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                      Histórico de Alterações (Changelog) • Compilação: {APP_BUILD_TAG}
                    </Text>
                    {APP_CHANGELOG.map((rel) => (
                      <View
                        key={rel.version}
                        style={[
                          styles.subCard,
                          {
                            backgroundColor: colors.surfaceMuted,
                            borderColor: colors.border,
                            borderWidth: 1,
                            borderRadius: radiusInput,
                          },
                        ]}
                      >
                        <Text style={[styles.subCardTitle, { color: colors.text }]}>
                          v{rel.version} ({rel.date}) — {rel.title}
                        </Text>
                        {rel.highlights.map((hl, idx) => (
                          <Text
                            key={idx}
                            style={[styles.helperText, { color: colors.textSecondary }]}
                          >
                            • {hl}
                          </Text>
                        ))}
                      </View>
                    ))}
                  </>
                ) : null}
              </View>
            </AccordionSection>
            {effectiveIsAdmin ? (
              <AccordionSection
                title="Área Restrita — Moderação Administrativa"
                icon="gavel"
                variant="danger"
                isOpen={openSection === 'admin'}
                onToggle={() => toggleSection('admin')}
              >
                <View style={styles.subsectionList}>
                  <Text style={[styles.helperText, { color: colors.adminCardTitle }]}>
                    Gerencie usuários, registros e fotos no Storage e trilha de auditoria.
                  </Text>
                  <DangerButton
                    compact
                    label="Abrir Painel Administrativo"
                    icon="gavel"
                    onPress={() => setShowAdminPanel(true)}
                  />
                </View>
              </AccordionSection>
            ) : null}
          </View>

          <View style={styles.footerCta}>
            <PrimaryButton label="Concluir" icon="check" onPress={onClose} />
          </View>
        </ScrollView>
      </View>
  );

  const anonConfirmCopy = getAnonymousModeConfirmationCopy(Boolean(pendingAnonymousTarget));

  const handleConfirmAnonymousSwitch = async () => {
    if (pendingAnonymousTarget === null) return;
    const nextVal = Boolean(pendingAnonymousTarget);
    setPendingAnonymousTarget(null);
    if (nextVal) {
      triggerAnonToast();
    } else {
      setAnonToastMsg('');
    }
    if (typeof onSetAnonymousMode === 'function') {
      await onSetAnonymousMode(nextVal);
    } else {
      await setDefaultAnonymous(nextVal);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={isWeb}
      animationType={isWeb ? 'fade' : 'slide'}
      onRequestClose={() => {
        if (pendingAnonymousTarget !== null) {
          setPendingAnonymousTarget(null);
        } else if (showAdminPanel) {
          setShowAdminPanel(false);
        } else if (showQuickGuide) {
          setShowQuickGuide(false);
        } else {
          onClose();
        }
      }}
    >
      {showQuickGuide ? (
        <View style={[styles.fullScreenWrap, { backgroundColor: colors.background }]}>
          <OnboardingScreen isReplay onComplete={() => setShowQuickGuide(false)} />
        </View>
      ) : showAdminPanel && effectiveIsAdmin ? (
        isWeb ? (
          <View
            style={[
              styles.webBackdrop,
              { justifyContent: isCompactWidth ? 'flex-end' : 'center' },
            ]}
          >
            <AdminPanelModal
              inline
              session={session}
              onClose={() => setShowAdminPanel(false)}
              onModerationChange={onModerationChange}
            />
          </View>
        ) : (
          <AdminPanelModal
            inline
            session={session}
            onClose={() => setShowAdminPanel(false)}
            onModerationChange={onModerationChange}
          />
        )
      ) : isWeb ? (
        <View
          style={[
            styles.webBackdrop,
            { justifyContent: isCompactWidth ? 'flex-end' : 'center' },
          ]}
        >
          {settingsBody}
        </View>
      ) : (
        settingsBody
      )}
      <ConfirmModal
        inline
        visible={pendingAnonymousTarget !== null}
        title={anonConfirmCopy.title}
        message={anonConfirmCopy.message}
        icon={anonConfirmCopy.icon}
        confirmLabel={anonConfirmCopy.confirmLabel}
        cancelLabel={anonConfirmCopy.cancelLabel}
        onConfirm={handleConfirmAnonymousSwitch}
        onCancel={() => setPendingAnonymousTarget(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  fullScreenWrap: {
    flex: 1,
  },
  webBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  screenCardWeb: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '88dvh',
    borderRadius: 24,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  webScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  screen: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  closeIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noShadowCard: {
    elevation: 0,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  infoCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderWidth: 1,
    gap: 8,
  },
  infoCalloutText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  toastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 8,
  },
  toastPillText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  accordionsContainer: {
    gap: 14,
  },
  accordionCard: {
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  accordionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  accordionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accordionTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  accordionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  subsectionList: {
    gap: 12,
  },
  subCard: {
    padding: 12,
    gap: 8,
  },
  subCardTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 19,
  },
  monoText: {
    fontSize: 12,
    lineHeight: 18,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchInfo: {
    flex: 1,
    gap: 2,
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  grid2x2: {
    gap: 10,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  gridCell: {
    flex: 1,
    minHeight: 40,
  },
  feedbackText: {
    fontSize: 12,
    fontWeight: '600',
  },
  logRow: {
    borderTopWidth: 1,
    paddingTop: 6,
    gap: 2,
  },
  logCategory: {
    fontSize: 11,
    fontWeight: '700',
  },
  logMessage: {
    fontSize: 12,
    lineHeight: 17,
  },
  footerCta: {
    marginTop: 16,
  },
  adminEntryCard: {
    marginTop: 14,
    padding: 14,
    gap: 10,
    backgroundColor: '#FCE8E6',
    borderWidth: 1,
    borderColor: '#F5C2C0',
    borderRadius: 20,
    elevation: 0,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  adminEntryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adminEntryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#8C1D18',
  },
  pwdFieldGroup: {
    gap: 5,
  },
  pwdLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  pwdInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    minHeight: 46,
    gap: 9,
  },
  pwdInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 9,
  },
  pwdFeedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    gap: 8,
  },
  pwdFeedbackText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
});

export default SettingsModal;
