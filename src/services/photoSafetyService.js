import { NativeModules, Platform } from 'react-native';
import { recordDiagnosticEvent } from './diagnosticLogService';

/**
 * Executa verificação local de presença de rostos quando houver detector nativo vinculado
 * (ex.: @react-native-ml-kit/face-detection ou ExpoFaceDetector em build dev/APK).
 * Em Expo Go ou builds sem módulo nativo de detecção facial, degrada com segurança sem travar.
 */
export async function verifyCapturedPhotoSafety(photoUri) {
  if (Platform.OS === 'web' || !photoUri) {
    return { blocked: false, facesCount: 0, detectorAvailable: false };
  }

  let detectorAvailable = false;
  let detectedFaces = [];

  try {
    const mlKitModule = NativeModules?.RNMLKitFaceDetection;
    if (mlKitModule && typeof mlKitModule.detect === 'function') {
      detectorAvailable = true;
      const result = await mlKitModule.detect(photoUri, {
        performanceMode: 'fast',
        landmarkMode: 'none',
        contourMode: 'none',
        classificationMode: 'none',
      });
      if (Array.isArray(result)) {
        detectedFaces = result;
      }
    } else {
      const expoDetector = NativeModules?.ExpoFaceDetector;
      if (expoDetector && typeof expoDetector.detectFaces === 'function') {
        detectorAvailable = true;
        const result = await expoDetector.detectFaces({
          uri: photoUri,
          mode: 1,
        });
        if (Array.isArray(result?.faces)) {
          detectedFaces = result.faces;
        }
      }
    }
  } catch {
    detectorAvailable = false;
    detectedFaces = [];
  }

  if (detectedFaces.length > 0) {
    await recordDiagnosticEvent('PRIVACIDADE', 'Foto bloqueada por detecção automática de rosto', {
      facesCount: detectedFaces.length,
    });
    return {
      blocked: true,
      facesCount: detectedFaces.length,
      detectorAvailable,
      reason:
        'Rosto detectado na imagem. Por privacidade (LGPD), tire uma nova foto focando apenas no buraco da via, sem pessoas.',
    };
  }

  await recordDiagnosticEvent('PRIVACIDADE', 'Verificação automática de foto concluída', {
    detectorAvailable,
    facesCount: 0,
  });

  return {
    blocked: false,
    facesCount: 0,
    detectorAvailable,
  };
}
