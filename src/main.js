import { Decoder, Encoder, Stream } from '@garmin/fitsdk';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.2';

// UI Elements
const statusLog = document.getElementById('status-log');
const fitInput = document.getElementById('fit-input');
const statsPanel = document.getElementById('stats-panel');
const editorPanel = document.getElementById('editor-panel');
const btnOpenAdjust = document.getElementById('btn-open-adjust');
const btnExportFit = document.getElementById('btn-export-fit');
const selectionInfo = document.getElementById('selection-info');
const chartContainer = document.getElementById('svg-chart-container');

// Modal Elements
const modalAdjust = document.getElementById('modal-adjust-time');
const formAdjust = document.getElementById('form-adjust-time');
const lblCurrentTime = document.getElementById('lbl-current-time');
const inputNewTime = document.getElementById('input-new-time');
const btnCancelModal = document.getElementById('btn-cancel-modal');

let workoutData = null;
let currentFileName = '';
let selectedLengthIndex = null;

function log(msg, type = 'info') {
  if (!statusLog) return;
  statusLog.textContent = msg;
  statusLog.className = `status-box ${type}`;
}

// 1. Detección inmediata al elegir archivo
fitInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) {
    log('No se seleccionó ningún archivo.', 'info');
    return;
  }

  currentFileName = file.name;
  log(`1/4: Archivo detectado: ${file.name} (${Math.round(file.size / 1024)} KB). Leyendo...`, 'info');

  try {
    const arrayBuffer = await file.arrayBuffer();
    log('2/4: Bytes leídos en memoria. Creando stream...', 'info');

    const uint8 = new Uint8Array(arrayBuffer);
    const stream = Stream.fromByteArray(uint8);

    log('3/4: Decodificando estructura FIT...', 'info');
    const decoder = new Decoder(stream);
    const result = decoder.read({
      applyScaleAndOffset: true,
      expandSubFields: true,
      convertTypesToStrings: true,
      convertDateTimesToDates: true
    });

    const messages = result.messages || result;
    const lengthMesgs = messages.lengthMesgs || messages.lengths || messages.length || [];
    const lapMesgs = messages.lapMesgs || messages.laps || messages.lap || [];
    const sessionMesg = (messages.sessionMesgs && messages.sessionMesgs[0]) || 
                        (messages.sessions && messages.sessions[0]) || 
                        messages.session || null;
    const fileIdMesgs = messages.fileIdMesgs || messages.fileIds || messages.file_id || [];
    const activityMesgs = messages.activityMesgs || messages.activities || messages.activity || [];

    if (!lengthMesgs || lengthMesgs.length === 0) {
      throw new Error(`El archivo se leyó pero tiene 0 largos. (Mensajes detectados: ${Object.keys(messages).join(', ')})`);
    }

    workoutData = {
      rawMessages: messages,
      fileIdMesgs: Array.isArray(fileIdMesgs) ? fileIdMesgs : [fileIdMesgs],
      sessionMesg,
      lapMesgs: Array.isArray(lapMesgs) ? lapMesgs : [lapMesgs],
      lengthMesgs: [...lengthMesgs],
      activityMesgs: Array.isArray(activityMesgs) ? activityMesgs : [activityMesgs]
    };

    log(`✅ ¡Éxito! ${lengthMesgs.length} largos cargados de ${file.name}`, 'success');

    statsPanel.classList.remove('hidden');
    editorPanel.classList.remove('hidden');

    updateStats();
    renderSvgChart();
    selectedLengthIndex = null;
    btnOpenAdjust.disabled = true;
    selectionInfo.textContent = 'Toca una barra para seleccionarla';

  } catch (err) {
    console.error(err);
    log(`❌ Error: ${err.message}`, 'error');
  }
});

// 2. Renderizado SVG simple y ultra-ligero para móvil
function getStrokeColor(stroke) {
  const s = String(stroke).toLowerCase();
  if (s.includes('freestyle') || s.includes('libre')) return '#38bdf8';
  if (s.includes('back') || s.includes('espalda')) return '#818cf8';
  if (s.includes('breast') || s.includes('braza')) return '#fbbf24';
  if (s.includes('butter') || s.includes('mariposa')) return '#f87171';
  if (s.includes('drill') || s.includes('tecnica')) return '#a78bfa';
  if (s.includes('rest') || s.includes('descanso')) return '#64748b';
  return '#38bdf8';
}

function renderSvgChart() {
  if (!workoutData) return;
  const lengths = workoutData.lengthMesgs;
  const count = lengths.length;

  const barWidth = 14;
  const barGap = 6;
  const chartHeight = 220;
  const totalWidth = Math.max(chartContainer.clientWidth, count * (barWidth + barGap) + 40);

  const maxDuration = Math.max(...lengths.map(l => Number(l.totalElapsedTime || l.totalTimerTime || 1)), 60);

  let barsHtml = '';
  lengths.forEach((len, idx) => {
    const dur = Math.round(Number(len.totalElapsedTime || len.totalTimerTime || 0));
    const h = Math.max(4, Math.round((dur / maxDuration) * (chartHeight - 40)));
    const x = 20 + idx * (barWidth + barGap);
    const y = chartHeight - h - 20;
    const color = getStrokeColor(len.swimStroke);
    const isSelected = selectedLengthIndex === idx;

    barsHtml += `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="3"
            fill="${color}" class="bar-rect ${isSelected ? 'selected' : ''}"
            data-index="${idx}">
        <title>#${idx + 1}: ${dur}s (${len.swimStroke})</title>
      </rect>
    `;
  });

  chartContainer.innerHTML = `
    <svg width="${totalWidth}" height="${chartHeight}" style="display:block;">
      ${barsHtml}
      <line x1="10" y1="${chartHeight - 19}" x2="${totalWidth - 10}" y2="${chartHeight - 19}" stroke="#334155" stroke-width="1"/>
    </svg>
  `;

  // Delegación de clics
  chartContainer.querySelectorAll('.bar-rect').forEach(rect => {
    rect.addEventListener('click', (e) => {
      const idx = Number(e.target.getAttribute('data-index'));
      selectLength(idx);
    });
  });
}

function selectLength(idx) {
  selectedLengthIndex = idx;
  const len = workoutData.lengthMesgs[idx];
  const dur = Math.round(len.totalTimerTime || len.totalElapsedTime || 0);

  selectionInfo.textContent = `Largo #${idx + 1}: ${len.swimStroke || 'Estilo'} (${dur}s)`;

  const strokeStr = String(len.swimStroke || '').toLowerCase();
  if (strokeStr === 'rest' || len.lengthType === 'idle') {
    btnOpenAdjust.disabled = true;
    btnOpenAdjust.textContent = '⏱️ Es un descanso (Rest)';
  } else {
    btnOpenAdjust.disabled = false;
    btnOpenAdjust.textContent = '⏱️ Ajustar tiempo';
  }

  renderSvgChart();
}

function updateStats() {
  const sess = workoutData.sessionMesg;
  const totalDist = sess?.totalDistance ?? (workoutData.lengthMesgs.length * (sess?.poolLength || 25));
  document.getElementById('stat-dist').textContent = `${Math.round(totalDist)} m`;

  const totalTimeSec = Math.round(sess?.totalTimerTime || sess?.totalElapsedTime || 0);
  const min = Math.floor(totalTimeSec / 60);
  const sec = totalTimeSec % 60;
  document.getElementById('stat-time').textContent = `${min}:${sec.toString().padStart(2, '0')}`;
  document.getElementById('stat-lengths').textContent = workoutData.lengthMesgs.length;
  document.getElementById('stat-pool').textContent = `${sess?.poolLength || 25} m`;
}

// Modal
btnOpenAdjust.addEventListener('click', () => {
  if (selectedLengthIndex === null) return;
  const len = workoutData.lengthMesgs[selectedLengthIndex];
  const dur = Math.round(len.totalTimerTime || len.totalElapsedTime || 0);
  lblCurrentTime.textContent = `Tiempo registrado: ${dur} segundos`;
  inputNewTime.value = '';
  modalAdjust.showModal();
});

btnCancelModal.addEventListener('click', () => modalAdjust.close());

formAdjust.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = inputNewTime.value.trim();
  let newSec = val.includes(':') 
    ? (Number(val.split(':')[0]) * 60 + Number(val.split(':')[1]))
    : Number(val);

  if (isNaN(newSec) || newSec <= 0) {
    alert("Introduce un tiempo válido en segundos");
    return;
  }

  const target = workoutData.lengthMesgs[selectedLengthIndex];
  const currentDuration = Math.round(target.totalTimerTime || target.totalElapsedTime || 0);
  const diffSec = currentDuration - newSec;

  if (diffSec <= 0) {
    alert(`El nuevo tiempo (${newSec}s) debe ser menor que el actual (${currentDuration}s)`);
    return;
  }

  // 1. Modificar largo
  target.totalTimerTime = newSec;
  target.totalElapsedTime = newSec;
  const poolLen = workoutData.sessionMesg?.poolLength || 25;
  target.avgSpeed = Number((poolLen / newSec).toFixed(3));

  // 2. Insertar descanso
  const origStart = new Date(target.startTime || target.timestamp).getTime();
  const restStart = new Date(origStart + (newSec * 1000));
  const restEnd = new Date(restStart.getTime() + (diffSec * 1000));

  const restMessage = {
    messageIndex: selectedLengthIndex + 1,
    timestamp: restEnd,
    startTime: restStart,
    totalElapsedTime: diffSec,
    totalTimerTime: 0,
    totalStrokes: 0,
    avgSpeed: 0,
    swimStroke: 'rest',
    lengthType: 'idle'
  };

  workoutData.lengthMesgs.splice(selectedLengthIndex + 1, 0, restMessage);

  // 3. Ajustar sesión
  if (workoutData.sessionMesg) {
    workoutData.sessionMesg.totalTimerTime = Math.max(0, (workoutData.sessionMesg.totalTimerTime || 0) - diffSec);
  }

  modalAdjust.close();
  updateStats();
  renderSvgChart();
  btnOpenAdjust.disabled = true;
  selectionInfo.textContent = 'Largo ajustado y descanso generado correctamente.';
  log('Largo corregido y descanso añadido.', 'success');
});

// Exportar FIT
btnExportFit.addEventListener('click', () => {
  if (!workoutData) return;
  try {
    const encoder = new Encoder();
    if (workoutData.fileIdMesgs?.length) {
      workoutData.fileIdMesgs.forEach(m => encoder.writeMesg('file_id', m));
    }
    workoutData.lengthMesgs.forEach(m => encoder.writeMesg('length', m));
    workoutData.lapMesgs.forEach(m => encoder.writeMesg('lap', m));
    if (workoutData.sessionMesg) encoder.writeMesg('session', workoutData.sessionMesg);
    workoutData.activityMesgs.forEach(m => encoder.writeMesg('activity', m));

    const bytes = encoder.close();
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFileName.replace(/\.fit$/i, '_corregido.fit');
    a.click();
    URL.revokeObjectURL(url);
    log('Archivo FIT corregido descargado con éxito.', 'success');
  } catch (err) {
    alert("Error al exportar FIT: " + err.message);
  }
});
