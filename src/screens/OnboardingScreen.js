import { FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../components/common/Buttons';
import { APP_NAME } from '../constants/appVersion';
import { useAppSettings } from '../context/AppSettingsContext';

export const ONBOARDING_STORAGE_KEY = '@olhonavia:onboarding_completed';

const ONBOARDING_SLIDES = [
  {
    id: 'slide-map',
    icon: 'map-location-dot',
    badge: '1 de 3 • Mapa Colaborativo',
    title: 'Mapeie os buracos da sua cidade',
    description:
      'Veja no mapa os buracos reportados por motoristas e cidadãos em tempo real. Ao aproximar o zoom, os pinos mostram miniaturas das fotos para identificar o risco na via.',
    tip: 'Dica: toque em qualquer marcador para abrir a foto completa e o histórico da via.',
  },
  {
    id: 'slide-safety',
    icon: 'camera',
    badge: '2 de 3 • Segurança e Captura no Celular',
    title: 'Fotografe apenas o buraco pelo celular',
    description:
      'Nunca tire fotos enquanto dirige — estacione em local seguro antes de registrar. Os relatos funcionam pela câmera traseira no aplicativo Android ou no navegador do celular (bloqueado em computadores) e passam por revisão antes do envio.',
    tip: 'Proibido fotografar rostos, crianças, selfies, placas de veículos, números de casas ou conteúdo impróprio.',
  },
  {
    id: 'slide-lgpd',
    icon: 'shield-halved',
    badge: '3 de 3 • Privacidade e LGPD',
    title: 'Privacidade e proteção de dados (LGPD)',
    description:
      'Você pode publicar de forma anônima (exibindo "Usuário Anônimo" ao público) sempre que quiser. Também contamos com checagem automática de rostos e ferramenta de tarja escura com o dedo antes do envio.',
    tip: 'Use a ferramenta de tarja na revisão caso apareça alguma placa ou endereço ao fundo.',
  },
];

export function OnboardingScreen({ onComplete, isReplay = false }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors, radiusCard, borderWidth, cardShadow, typography } = useAppSettings();

  const listRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const isLastSlide = activeIndex === ONBOARDING_SLIDES.length - 1;

  const finishOnboarding = async () => {
    if (!isReplay) {
      try {
        await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
      } catch {
        // Ignora erro pontual de escrita
      }
    }
    onComplete?.();
  };

  const handleNext = () => {
    if (isLastSlide) {
      finishOnboarding();
      return;
    }
    const nextIdx = activeIndex + 1;
    setActiveIndex(nextIdx);
    listRef.current?.scrollToIndex({ index: nextIdx, animated: true });
  };

  const handleMomentumEnd = (event) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / Math.max(1, width));
    if (index >= 0 && index < ONBOARDING_SLIDES.length) {
      setActiveIndex(index);
    }
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: Math.max(20, insets.top + 12),
          paddingBottom: Math.max(24, insets.bottom + 16),
        },
      ]}
    >
      {/* Topo com nome do app e botão Pular */}
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <View style={[styles.brandDot, { backgroundColor: colors.primary }]}>
            <FontAwesome6 name="road" size={13} color={colors.primaryText} />
          </View>
          <Text
            style={[
              styles.brandName,
              {
                color: colors.text,
                fontWeight: typography.headingWeight,
                letterSpacing: typography.letterSpacing,
              },
            ]}
          >
            {APP_NAME}
          </Text>
        </View>

        {!isLastSlide || isReplay ? (
          <Pressable
            onPress={finishOnboarding}
            hitSlop={10}
            style={[styles.skipPill, { backgroundColor: colors.surfaceMuted }]}
          >
            <Text style={[styles.skipText, { color: colors.textSecondary }]}>
              {isReplay ? 'Fechar' : 'Pular'}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.skipPlaceholder} />
        )}
      </View>

      {/* Carrossel horizontal de 3 slides */}
      <FlatList
        ref={listRef}
        data={ONBOARDING_SLIDES}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        renderItem={({ item }) => (
          <View style={[styles.slidePage, { width }]}>
            <View
              style={[
                styles.slideCard,
                cardShadow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusCard,
                },
              ]}
            >
              <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}>
                <FontAwesome6 name={item.icon} size={36} color={colors.primary} />
              </View>

              <View style={[styles.stepPill, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.stepPillText, { color: colors.primary }]}>{item.badge}</Text>
              </View>

              <Text
                style={[
                  styles.slideTitle,
                  {
                    color: colors.text,
                    fontWeight: typography.headingWeight,
                    letterSpacing: typography.letterSpacing,
                  },
                ]}
              >
                {item.title}
              </Text>

              <Text style={[styles.slideDescription, { color: colors.textSecondary }]}>
                {item.description}
              </Text>

              <View
                style={[
                  styles.tipBox,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.dividerColor,
                    borderWidth: 1,
                    borderRadius: 14,
                  },
                ]}
              >
                <FontAwesome6 name="circle-info" size={14} color={colors.primary} />
                <Text style={[styles.tipText, { color: colors.textSecondary }]}>{item.tip}</Text>
              </View>
            </View>
          </View>
        )}
      />

      {/* Indicadores de página e botão principal */}
      <View style={styles.footer}>
        <View style={styles.dotsRow}>
          {ONBOARDING_SLIDES.map((s, idx) => {
            const active = idx === activeIndex;
            return (
              <View
                key={s.id}
                style={[
                  styles.dot,
                  {
                    width: active ? 24 : 8,
                    backgroundColor: active ? colors.primary : colors.border,
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.ctaWrap}>
          <PrimaryButton
            label={isLastSlide ? (isReplay ? 'Concluir Guia' : 'Começar') : 'Próximo'}
            icon={isLastSlide ? 'check' : 'arrow-right'}
            onPress={handleNext}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandDot: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 17,
  },
  skipPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  skipPlaceholder: {
    width: 60,
    height: 30,
  },
  slidePage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  slideCard: {
    width: '100%',
    maxWidth: 460,
    padding: 24,
    alignItems: 'center',
    gap: 14,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stepPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  stepPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  slideTitle: {
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'center',
  },
  slideDescription: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  tipBox: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    gap: 9,
    marginTop: 4,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 20,
    gap: 16,
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  ctaWrap: {
    width: '100%',
    maxWidth: 460,
  },
});

export default OnboardingScreen;
