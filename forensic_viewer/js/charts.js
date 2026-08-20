let telemetryChart;
let fullTimes = [];
let fullSpeeds = [];
let fullBrakes = [];
let fullSteers = [];

function initCharts(data) {
    const ctx = document.getElementById('telemetryChart').getContext('2d');

    fullTimes = data.map(d => parseFloat(d.t).toFixed(1));
    fullSpeeds = data.map(d => d.v);
    fullBrakes = data.map(d => d.b * 100); 
    fullSteers = data.map(d => d.s); 

    const maxTimeStr = fullTimes[fullTimes.length - 1];
    
    telemetryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [fullTimes[0]],
            datasets: [
                {
                    label: 'Speed (km/h)',
                    data: [fullSpeeds[0]],
                    borderColor: '#38bdf8',
                    tension: 0.1,
                    yAxisID: 'y',
                    pointRadius: 0, 
                    pointHoverRadius: 6
                },
                {
                    label: 'Brake Pressure (%)',
                    data: [fullBrakes[0]],
                    borderColor: '#10b981',
                    tension: 0.1,
                    yAxisID: 'y1',
                    pointRadius: 0,
                    pointHoverRadius: 6
                },
                {
                    label: 'Steering (-1 L, +1 R)',
                    data: [fullSteers[0]],
                    borderColor: '#facc15',
                    borderWidth: 2,
                    tension: 0.1,
                    yAxisID: 'y2',
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
                x: { 
                    ticks: { color: '#94a3b8', maxTicksLimit: 10 }, 
                    grid: { color: '#3f3f4e' },
                    min: fullTimes[0],
                    max: maxTimeStr
                },
                y: { 
                    type: 'linear', position: 'left', 
                    title: { display: true, text: 'Km/h', color: '#94a3b8' }, 
                    grid: { color: '#3f3f4e' },
                    min: 0, max: 60 
                },
                y1: { 
                    type: 'linear', position: 'right', 
                    grid: { drawOnChartArea: false }, 
                    title: { display: true, text: 'Brake %', color: '#94a3b8' },
                    min: 0, max: 100
                },
                y2: {
                    type: 'linear', position: 'right',
                    grid: { drawOnChartArea: false }, 
                    title: { display: true, text: 'Steer', color: '#facc15' },
                    min: -1.0, max: 1.0,
                    ticks: {
                        color: '#facc15',
                        callback: function(value) {
                            if (value === -1) return 'L';
                            if (value === 0) return '0';
                            if (value === 1) return 'R';
                            return null;
                        }
                    }
                }
            },
            plugins: { 
                legend: { labels: { color: '#e0e0e0' } },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
}

function updateChartSync() {
    if (telemetryChart && typeof currentFrameIndex !== 'undefined') {
        
        const visibleElements = currentFrameIndex + 1;
        
        telemetryChart.data.labels = fullTimes.slice(0, visibleElements);
        telemetryChart.data.datasets[0].data = fullSpeeds.slice(0, visibleElements);
        telemetryChart.data.datasets[1].data = fullBrakes.slice(0, visibleElements);
        telemetryChart.data.datasets[2].data = fullSteers.slice(0, visibleElements);
        
        telemetryChart.update('none');
    }
}