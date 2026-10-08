import Chart from 'chart.js/auto';

let chartInstance = null;

const STROKE_COLORS = {
  freestyle: '#38bdf8',
  backstroke: '#818cf8',
  breaststroke: '#fbbf24',
  butterfly: '#f87171',
  drill: '#a78bfa',
  rest: '#64748b'
};

function getStrokeColor(stroke) {
  const key = String(stroke).toLowerCase();
  return STROKE_COLORS[key] || '#94a3b8';
}

export function renderLengthsChart(lengthMesgs, onSelectLength) {
  const ctx = document.getElementById('lengthsChart').getContext('2d');

  const labels = lengthMesgs.map((_, i) => `#${i + 1}`);
  const dataDurations = lengthMesgs.map(l => Math.round(l.totalElapsedTime || l.totalTimerTime || 0));
  const backgroundColors = lengthMesgs.map(l => getStrokeColor(l.swimStroke));

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Duración (segundos)',
        data: dataDurations,
        backgroundColor: backgroundColors,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#334155'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          onSelectLength(index);
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const len = lengthMesgs[ctx.dataIndex];
              const sec = ctx.raw;
              const min = Math.floor(sec / 60);
              const remSec = sec % 60;
              const timeFmt = min > 0 ? `${min}:${remSec.toString().padStart(2, '0')}` : `${sec}s`;
              return `Estilo: ${len.swimStroke} | Duración: ${timeFmt}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', maxRotation: 0 },
          grid: { display: false }
        },
        y: {
          ticks: { color: '#94a3b8' },
          grid: { color: '#334155' },
          title: {
            display: true,
            text: 'Segundos',
            color: '#94a3b8'
          }
        }
      }
    }
  });
}
