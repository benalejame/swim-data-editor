import { Decoder, Encoder, Stream } from '@garmin/fitsdk';

/**
 * Lee un archivo .FIT de natación y normaliza las propiedades.
 */
export async function parseFitFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const byteArray = new Uint8Array(arrayBuffer);
  const stream = Stream.fromByteArray(byteArray);

  if (!Decoder.isFIT(stream)) {
    throw new Error("El archivo seleccionado no es un binario .FIT válido.");
  }

  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true
  });

  if (errors && errors.length > 0) {
    console.warn("Avisos del Decoder FIT:", errors);
  }

  // Inspección en consola para comprobar qué campos vienen en tu reloj
  console.log("Mensajes decodificados del archivo FIT:", messages);

  // El SDK puede nombrar las colecciones como lengthMesgs / lengths / length
  const lengthMesgs = messages.lengthMesgs || messages.lengths || messages.length || [];
  const lapMesgs = messages.lapMesgs || messages.laps || messages.lap || [];
  const sessionMesg = (messages.sessionMesgs && messages.sessionMesgs[0]) || 
                      (messages.sessions && messages.sessions[0]) || 
                      messages.session || null;
  const fileIdMesgs = messages.fileIdMesgs || messages.fileIds || messages.file_id || [];
  const activityMesgs = messages.activityMesgs || messages.activities || messages.activity || [];

  if (lengthMesgs.length === 0) {
    throw new Error(
      "El archivo se leyó correctamente pero no contiene largos de piscina individuales (mensajes 'length'). " +
      "Asegúrate de que la actividad se registró con el perfil de 'Natación en piscina' (Pool Swim) y no 'Aguas abiertas'."
    );
  }

  return {
    rawMessages: messages,
    fileIdMesgs: Array.isArray(fileIdMesgs) ? fileIdMesgs : [fileIdMesgs],
    sessionMesg,
    lapMesgs: Array.isArray(lapMesgs) ? lapMesgs : [lapMesgs],
    lengthMesgs: [...lengthMesgs],
    activityMesgs: Array.isArray(activityMesgs) ? activityMesgs : [activityMesgs]
  };
}

/**
 * Ajusta la duración de un largo individual y convierte el tiempo sobrante en descanso.
 */
export function trimLengthAndConvertToRest(workoutData, targetIndex, newDurationSec) {
  const target = workoutData.lengthMesgs[targetIndex];
  if (!target) throw new Error("Largo no encontrado.");

  const strokeStr = String(target.swimStroke || '').toLowerCase();
  if (strokeStr === 'rest' || target.lengthType === 'idle') {
    throw new Error("El elemento seleccionado ya es un descanso.");
  }

  const currentDuration = Math.round(target.totalTimerTime || target.totalElapsedTime || 0);
  const diffSec = currentDuration - newDurationSec;

  if (diffSec <= 0) {
    throw new Error(`El nuevo tiempo (${newDurationSec}s) debe ser menor que el actual (${currentDuration}s).`);
  }

  const poolLength = workoutData.sessionMesg?.poolLength || 25;

  // 1. Modificar el largo seleccionado
  target.totalTimerTime = newDurationSec;
  target.totalElapsedTime = newDurationSec;
  target.avgSpeed = Number((poolLength / newDurationSec).toFixed(3));

  // 2. Generar el descanso siguiente
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

  // 3. Actualizar la sesión
  if (workoutData.sessionMesg) {
    workoutData.sessionMesg.totalTimerTime = Math.max(0, (workoutData.sessionMesg.totalTimerTime || 0) - diffSec);
    if (workoutData.sessionMesg.totalDistance && workoutData.sessionMesg.totalTimerTime > 0) {
      workoutData.sessionMesg.avgSpeed = workoutData.sessionMesg.totalDistance / workoutData.sessionMesg.totalTimerTime;
    }
  }

  // 4. Actualizar el Lap
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
 * Codifica los mensajes en un nuevo .FIT binario.
 */
export function exportAndDownloadFit(workoutData, originalFilename = 'workout_editado.fit') {
  const encoder = new Encoder();

  if (workoutData.fileIdMesgs?.length) {
    workoutData.fileIdMesgs.forEach(m => encoder.writeMesg('file_id', m));
  }

  workoutData.lengthMesgs.forEach(m => encoder.writeMesg('length', m));
  workoutData.lapMesgs.forEach(m => encoder.writeMesg('lap', m));

  if (workoutData.sessionMesg) {
    encoder.writeMesg('session', workoutData.sessionMesg);
  }

  workoutData.activityMesgs.forEach(m => encoder.writeMesg('activity', m));

  const bytes = encoder.close();
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = originalFilename.endsWith('.fit') ? originalFilename.replace('.fit', '_corregido.fit') : `${originalFilename}_corregido.fit`;
  a.click();
  URL.revokeObjectURL(url);
}
