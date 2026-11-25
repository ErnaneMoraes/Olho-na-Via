import { FontAwesome6 } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
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
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_BUILD_TAG, APP_CHANGELOG, APP_NAME, APP_VERSION } from '../../src/constants/appVersion';
import { useAppSettings } from '../../src/context/AppSettingsContext';
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

if (
  Platform.OS === 'android' &&
  !global?.nativeFabricUIManager &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function AccordionSection({ title, icon, isOpen, onToggle, children }) {
  const { colors, radiusCard, borderWidth, cardShadow } = useAppSettings();

  return (
    <View
      style={[
        styles.accordionCard,
        cardShadow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth,
          borderRadius: radiusCard,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        android_ripple={{ color: colors.accentSoft }}
        style={styles.accordionHeader}
      >
        <View style={styles.accordionHeaderLeft}>
          <View style={[styles.accordionIcon, { backgroundColor: colors.accentSoft }]}>
            <FontAwesome6 name={icon} size={15} color={colors.primary} />
          </View>
          <Text style={[styles.accordionTitle, { color: colors.text }]}>{title}</Text>
        </View>
        <FontAwesome6
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.textSecondary}
        />
      </Pressable>
      {isOpen ? (
        <View style={[styles.accordionBody, { borderTopColor: colors.dividerColor }]}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

export function SettingsModal({ visible, session, onModerationChange, onClose }) {
  const insets = useSafeAreaInsets();
  const {
    colors,
    defaultAnonymous,
    setDefaultAnonymous,
    cameraShutterSound,
    setCameraShutterSound,
    radiusCard,
    radiusInput,
    borderWidth,
    cardShadow,
    typography,
  } = useAppSettings();

  const [openSection, setOpenSection] = useState('privacy');
  const [logs, setLogs] = useState([]);
  const [diagFeedback, setDiagFeedback] = useState('');
  const [showQuickGuide, setShowQuickGuide] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  const isAdmin = Boolean(session?.isAdmin && !session?.isDemo);

  const topSafePadding =
    Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 12) + 8;

  const loadLogs = useCallback(async () => {
    const items = await getDiagnosticLogs();
    setLogs(items);
  }, []);

  useEffect(() => {
    if (visible) {
      if (isAdmin) {
        loadLogs();
      }
      setDiagFeedback('');
      setShowQuickGuide(false);
      setShowAdminPanel(false);
    }
  }, [visible, isAdmin, loadLogs]);

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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => {
        if (showAdminPanel) {
          setShowAdminPanel(false);
        } else if (showQuickGuide) {
          setShowQuickGuide(false);
        } else {
          onClose();
        }
      }}
    >
      {showAdminPanel && session?.isAdmin ? (
        <AdminPanelModal
          inline
          session={session}
          onClose={() => setShowAdminPanel(false)}
          onModerationChange={onModerationChange}
        />
      ) : showQuickGuide ? (
        <OnboardingScreen isReplay onComplete={() => setShowQuickGuide(false)} />
      ) : (
      <View
        style={[
          styles.screen,
          {
            backgroundColor: colors.background,
            paddingTop: topSafePadding,
            paddingBottom: Math.max(12, insets.bottom),
          },
        ]}
      >
        <View style={[SharedStyles.contentContainer, styles.header]}>
          <View style={styles.headerTitleWrap}>
            <FontAwesome6 name="gear" size={18} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.text }]}>Configurações</Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={10}
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

        <ScrollView
          contentContainerStyle={[SharedStyles.contentContainer, styles.scrollContent]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.accordionsContainer}>
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
                  <View style={styles.switchRow}>
                    <View style={styles.switchInfo}>
                      <Text style={[styles.switchTitle, { color: colors.text }]}>
                        Postar como Anônimo por padrão
                      </Text>
                      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                        Quando ativado, seus relatos exibem "Usuário Anônimo" em vez do seu Apelido
                        no mapa.
                      </Text>
                    </View>
                    <Switch
                      value={defaultAnonymous}
                      onValueChange={setDefaultAnonymous}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
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

            {/* 3. Diagnóstico Anônimo (somente administradores) */}
            {isAdmin ? (
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
                    • Registre buracos apenas quando estiver parado e em local seguro, longe do
                    fluxo de veículos.{'\n'}
                    • Confirme no mapa quando uma via continuar aberta ou já tiver sido tampada com
                    uma foto atualizada.{'\n'}
                    • Se preferir, ative o modo anônimo para ocultar seu apelido do público geral.
                  </Text>
                </View>
                <PrimaryButton
                  compact
                  label="Ver Tutorial Inicial (Onboarding)"
                  icon="book-open"
                  onPress={() => setShowQuickGuide(true)}
                />

                {isAdmin ? (
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
          </View>

          {isAdmin ? (
            <View style={styles.adminEntryCard}>
              <View style={styles.adminEntryHeader}>
                <FontAwesome6 name="gavel" size={16} color="#B3261E" />
                <Text style={styles.adminEntryTitle}>
                  Área Restrita — Moderação Administrativa
                </Text>
              </View>
              <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                Gerencie registros, fotos no Storage, comentários, perfis, contas e auditoria.
              </Text>
              <DangerButton
                compact
                label="Abrir Painel Administrativo"
                icon="gavel"
                onPress={() => setShowAdminPanel(true)}
              />
            </View>
          ) : null}

          <View style={styles.footerCta}>
            <PrimaryButton label="Concluir" icon="check" onPress={onClose} />
          </View>
        </ScrollView>
      </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
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
});

export default SettingsModal;
