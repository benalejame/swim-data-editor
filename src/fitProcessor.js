import { Decoder, Encoder, Stream } from '@garmin/fitsdk';

export async function parseFitFile(file) {
  // 1. Lectura binaria del archivo
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // 2. Creación del Stream compatible con navegador
  let stream;
  if (typeof Stream.fromByteArray === 'function') {
    stream = Stream.fromByteArray(uint8);
  } else if (typeof Stream.fromArrayBuffer === 'function') {
    stream = Stream.fromArrayBuffer(arrayBuffer);
  } else {
    stream = new Stream(uint8);
  }

  // 3. Validación FIT
  if (typeof Decoder.isFIT === 'function') {
    if (!Decoder.isFIT(stream)) {
      throw new Error("El archivo no tiene cabecera FIT válida.");
    }
  }

  // 4. Decodificación
  const decoder = new Decoder(stream);
  const result = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true
  });

  const messages = result.messages || result;

  // Normalizar nombres de mensajes (el SDK varía entre versiones)
  const lengthMesgs = messages.lengthMesgs || messages.lengths || messages.length || [];
  const lapMesgs = messages.lapMesgs || messages.laps || messages.lap || [];
  const sessionMesg = (messages.sessionMesgs && messages.sessionMesgs[0]) || 
                      (messages.sessions && messages.sessions[0]) || 
                      messages.session || null;
  const fileIdMesgs = messages.fileIdMesgs || messages.fileIds || messages.file_id || [];
  const activityMesgs = messages.activityMesgs || messages.activities || messages.activity || [];

  if (!lengthMesgs || lengthMesgs.length === 0) {
    // Si no hay largos individuales, comprobar si hay laps
    if (lapMesgs.length > 0) {
      throw new Error(
        "El archivo contiene series ('lap') pero no largos individuales ('length'). " +
        "Verifica que el archivo provenga de un entrenamiento en piscina con detección de largos."
      );
    }
    throw new Error("No se encontraron registros de natación en este archivo .FIT.");
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

export function trimLengthAndConvertToRest(workoutData, targetIndex, newDurationSec) {
  const target = workoutData.lengthMesgs[targetIndex];
  if (!target) throw new Error("Largo no encontrado.");

  const strokeStr = String(target.swimStroke || '').toLowerCase();
  if (strokeStr === 'rest' || target.lengthType === 'idle') {
    throw new Error("El largo seleccionado ya es un descanso.");
  }

  const currentDuration = Math.round(target.totalTimerTime || target.totalElapsedTime || 0);
  const diffSec = currentDuration - newDurationSec;

  if (diffSec <= 0) {
    throw new Error(`El nuevo tiempo (${newDurationSec}s) debe ser menor que el registrado (${currentDuration}s).`);
  }

  const poolLength = workoutData.sessionMesg?.poolLength || 25;

  target.totalTimerTime = newDurationSec;
  target.totalElapsedTime = newDurationSec;
  target.avgSpeed = Number((poolLength / newDurationSec).toFixed(3));

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

  for (let i = targetIndex + 2; i < workoutData.lengthMesgs.length; i++) {
    if (workoutData.lengthMesgs[i].messageIndex !== undefined) {
      workoutData.lengthMesgs[i].messageIndex += 1;
    }
  }

  if (workoutData.sessionMesg) {
    workoutData.sessionMesg.totalTimerTime = Math.max(0, (workoutData.sessionMesg.totalTimerTime || 0) - diffSec);
    if (workoutData.sessionMesg.totalDistance && workoutData.sessionMesg.totalTimerTime > 0) {
      workoutData.sessionMesg.avgSpeed = workoutData.sessionMesg.totalDistance / workoutData.sessionMesg.totalTimerTime;
    }
  }

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
