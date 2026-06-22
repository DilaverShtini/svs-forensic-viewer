let telemetryChart;

function initCharts(data) {
    const ctx = document.getElementById('telemetryChart').getContext('2d');

    const times = data.map(d => parseFloat(d.t).toFixed(1));
    const speeds = data.map(d => d.v);
    const brakes = data.map(d => d.b * 100); 

    const verticalLinePlugin = {
        id: 'verticalLine',
        afterDraw: chart => {
            if (typeof currentFrameIndex !== 'undefined') {
                const meta = chart.getDatasetMeta(0);
                if(meta.data[currentFrameIndex]) {
                    let x = meta.data[currentFrameIndex].x;
                    const topY = chart.scales.y.top;
                    const bottomY = chart.scales.y.bottom;
                    
                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, topY);
                    ctx.lineTo(x, bottomY);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = '#ef4444'; 
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }
    };

    telemetryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: times,
            datasets: [
                {
                    label: 'Speed (km/h)',
                    data: speeds,
                    borderColor: '#38bdf8',
                    tension: 0.1,
                    yAxisID: 'y',
                    pointRadius: 0, 
                    pointHoverRadius: 6
                },
                {
                    label: 'Brake Pressure (%)',
                    data: brakes,
                    borderColor: '#10b981',
                    tension: 0.1,
                    yAxisID: 'y1',
                    pointRadius: 0,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, 
            interaction: {
                mode: 'index',
                intersect: false,
            },
            onClick: (event, elements) => {
                if (elements && elements.length > 0) {
                    const dataIndex = elements[0].index;
                    if (typeof jumpToFrame === 'function') {
                        jumpToFrame(dataIndex);
                    }
                }
            },
            scales: {
                x: { ticks: { color: '#94a3b8' }, grid: { color: '#3f3f4e' } },
                y: { type: 'linear', position: 'left', title: {display: true, text: 'Km/h', color: '#94a3b8'}, grid: { color: '#3f3f4e' } },
                y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: {display: true, text: 'Freno %', color: '#94a3b8'} }
            },
            plugins: { 
                legend: { labels: { color: '#e0e0e0' } },
                tooltip: { mode: 'index', intersect: false }
            }
        },
        plugins: [verticalLinePlugin]
    });
}

function updateChartSync() {
    if (telemetryChart) {
        telemetryChart.draw(); 
    }
}