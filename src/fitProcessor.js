import { Decoder, Encoder, Stream } from '@garmin/fitsdk';

/**
 * Lee un archivo .FIT y devuelve los mensajes indexados.
 */
export async function parseFitFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const stream = Stream.fromArrayBuffer(arrayBuffer);
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read();

  if (errors.length > 0) {
    console.warn("Avisos en decodificación FIT:", errors);
  }

  return {
    rawMessages: messages,
    fileIdMesgs: messages.fileIdMesgs || [],
    sessionMesg: messages.sessionMesgs?.[0] || null,
    lapMesgs: messages.lapMesgs || [],
    lengthMesgs: messages.lengthMesgs || [],
    activityMesgs: messages.activityMesgs || []
  };
}

/**
 * Ajusta la duración de un largo individual convirtiendo el sobrante en descanso.
 */
export function trimLengthAndConvertToRest(workoutData, targetIndex, newDurationSec) {
  const target = workoutData.lengthMesgs[targetIndex];
  if (!target) throw new Error("Largo no encontrado");

  if (target.swimStroke === 'rest' || target.lengthType === 'idle') {
    throw new Error("El elemento seleccionado ya es un descanso");
  }

  const currentDuration = Math.round(target.totalTimerTime || target.totalElapsedTime);
  const diffSec = currentDuration - newDurationSec;

  if (diffSec <= 0) {
    throw new Error(`El nuevo tiempo (${newDurationSec}s) debe ser menor que el actual (${currentDuration}s)`);
  }

  const poolLength = workoutData.sessionMesg?.poolLength || 25;

  // 1. Modificar largo activo
  target.totalTimerTime = newDurationSec;
  target.totalElapsedTime = newDurationSec;
  target.avgSpeed = Number((poolLength / newDurationSec).toFixed(3));

  // 2. Generar descanso
  const originalStartTime = new Date(target.startTime || target.timestamp).getTime();
  const restStartTime = new Date(originalStartTime + (newDurationSec * 1000));
  const restEndTime = new Date(restStartTime.getTime() + (diffSec * 1000));

  const restMessage = {
    messageIndex: targetIndex + 1,
    timestamp: restEndTime,
    startTime: restStartTime,
    totalElapsedTime: diffSec,
    totalTimerTime: 0,
    totalStrokes: 0,
    avgSpeed: 0,
    swimStroke: 'rest',
    lengthType: 'idle'
  };

  workoutData.lengthMesgs.splice(targetIndex + 1, 0, restMessage);

  // Reindexar messageIndex
  for (let i = targetIndex + 2; i < workoutData.lengthMesgs.length; i++) {
    if (workoutData.lengthMesgs[i].messageIndex !== undefined) {
      workoutData.lengthMesgs[i].messageIndex += 1;
    }
  }

  // 3. Actualizar totales de sesión
  if (workoutData.sessionMesg) {
    workoutData.sessionMesg.totalTimerTime = Math.max(0, (workoutData.sessionMesg.totalTimerTime || 0) - diffSec);
    if (workoutData.sessionMesg.totalDistance && workoutData.sessionMesg.totalTimerTime > 0) {
      workoutData.sessionMesg.avgSpeed = workoutData.sessionMesg.totalDistance / workoutData.sessionMesg.totalTimerTime;
    }
  }

  // 4. Actualizar Lap correspondiente si existe
  if (workoutData.lapMesgs?.length) {
    const parentLap = workoutData.lapMesgs.find(lap => {
      const s = new Date(lap.startTime).getTime();
      const e = new Date(lap.timestamp).getTime();
      return originalStartTime >= s && originalStartTime <= e;
    });

    if (parentLap) {
      parentLap.totalTimerTime = Math.max(0, (parentLap.totalTimerTime || 0) - diffSec);
      if (parentLap.totalDistance && parentLap.totalTimerTime > 0) {
        parentLap.avgSpeed = parentLap.totalDistance / parentLap.totalTimerTime;
      }
    }
  }

  return workoutData;
}

/**
 * Codifica los mensajes en un nuevo ArrayBuffer binario FIT y fuerza la descarga.
 */
export function exportAndDownloadFit(workoutData, originalFilename = 'workout_edited.fit') {
  const encoder = new Encoder();

  // Escribir cabecera
  if (workoutData.fileIdMesgs?.length) {
    workoutData.fileIdMesgs.forEach(m => encoder.writeMesg('file_id', m));
  }

  // Escribir largos
  workoutData.lengthMesgs.forEach(m => encoder.writeMesg('length', m));

  // Escribir series y sesión
  workoutData.lapMesgs.forEach(m => encoder.writeMesg('lap', m));
  if (workoutData.sessionMesg) encoder.writeMesg('session', workoutData.sessionMesg);
  workoutData.activityMesgs.forEach(m => encoder.writeMesg('activity', m));

  const bytes = encoder.close();
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = originalFilename.replace(/\.fit$/i, '_editado.fit');
  a.click();
  URL.revokeObjectURL(url);
}
