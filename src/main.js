import { parseFitFile, trimLengthAndConvertToRest, exportAndDownloadFit } from './fitProcessor.js';
import { renderLengthsChart } from './chartManager.js';

let workoutData = null;
let currentFileName = '';
let selectedLengthIndex = null;

// Elementos del DOM
const fitInput = document.getElementById('fit-input');
const fileNameLabel = document.getElementById('file-name-label');
const statsPanel = document.getElementById('stats-panel');
const editorPanel = document.getElementById('editor-panel');
const btnOpenAdjust = document.getElementById('btn-open-adjust');
const btnExportFit = document.getElementById('btn-export-fit');
const selectionInfo = document.getElementById('selection-info');

// Elementos del Modal
const modalAdjust = document.getElementById('modal-adjust-time');
const formAdjust = document.getElementById('form-adjust-time');
const lblCurrentTime = document.getElementById('lbl-current-time');
const inputNewTime = document.getElementById('input-new-time');
const btnCancelModal = document.getElementById('btn-cancel-modal');

// Actualizar panel de resumen
function updateStatsUI() {
  if (!workoutData?.sessionMesg) return;
  const sess = workoutData.sessionMesg;

  document.getElementById('stat-dist').textContent = `${sess.totalDistance || 0} m`;
  const t = Math.round(sess.totalTimerTime || 0);
  const min = Math.floor(t / 60);
  const sec = t % 60;
  document.getElementById('stat-time').textContent = `${min}:${sec.toString().padStart(2, '0')}`;
  document.getElementById('stat-lengths').textContent = workoutData.lengthMesgs.length;
  document.getElementById('stat-pool').textContent = `${sess.poolLength || 25} m`;
}

// Manejar selección de largo en el gráfico
function handleSelectLength(index) {
  selectedLengthIndex = index;
  const len = workoutData.lengthMesgs[index];
  const dur = Math.round(len.totalTimerTime || len.totalElapsedTime || 0);

  selectionInfo.textContent = `Seleccionado Largo #${index + 1} (${len.swimStroke}, ${dur}s)`;

  // Desactivar ajuste si ya es un descanso
  if (len.swimStroke === 'rest' || len.lengthType === 'idle') {
    btnOpenAdjust.disabled = true;
    btnOpenAdjust.textContent = '⏱️ Es un descanso (Rest)';
  } else {
    btnOpenAdjust.disabled = false;
    btnOpenAdjust.textContent = '⏱️ Ajustar tiempo del largo';
  }
}

// Carga del archivo .FIT
fitInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  currentFileName = file.name;
  fileNameLabel.textContent = file.name;

  try {
    workoutData = await parseFitFile(file);
    statsPanel.classList.remove('hidden');
    editorPanel.classList.remove('hidden');

    updateStatsUI();
    renderLengthsChart(workoutData.lengthMesgs, handleSelectLength);
    selectedLengthIndex = null;
    btnOpenAdjust.disabled = true;
    selectionInfo.textContent = 'Haz clic en una barra para seleccionarla';
  } catch (err) {
    alert("Error al parsear el archivo FIT: " + err.message);
  }
});

// Abrir modal de ajuste
btnOpenAdjust.addEventListener('click', () => {
  if (selectedLengthIndex === null) return;
  const len = workoutData.lengthMesgs[selectedLengthIndex];
  const dur = Math.round(len.totalTimerTime || len.totalElapsedTime || 0);

  lblCurrentTime.textContent = `Tiempo registrado: ${dur} segundos`;
  inputNewTime.value = '';
  modalAdjust.showModal();
});

btnCancelModal.addEventListener('click', () => modalAdjust.close());

// Confirmar ajuste de tiempo
formAdjust.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = inputNewTime.value.trim();
  let newSec = 0;

  if (val.includes(':')) {
    const parts = val.split(':').map(Number);
    newSec = (parts[0] * 60) + parts[1];
  } else {
    newSec = Number(val);
  }

  if (isNaN(newSec) || newSec <= 0) {
    alert("Introduce un tiempo válido en segundos");
    return;
  }

  try {
    workoutData = trimLengthAndConvertToRest(workoutData, selectedLengthIndex, newSec);
    modalAdjust.close();

    updateStatsUI();
    renderLengthsChart(workoutData.lengthMesgs, handleSelectLength);
    btnOpenAdjust.disabled = true;
    selectionInfo.textContent = 'Largo ajustado correctamente. Nuevo descanso creado.';
  } catch (err) {
    alert(err.message);
  }
});

// Descargar archivo corregido
btnExportFit.addEventListener('click', () => {
  if (!workoutData) return;
  exportAndDownloadFit(workoutData, currentFileName);
});
