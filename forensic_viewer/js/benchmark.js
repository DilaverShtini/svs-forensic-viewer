function runPerformanceBenchmark() {
    if (!simulationData || simulationData.length === 0) {
        console.warn("No simulation data available. Reload the page.");
        return;
    }

    console.log("Starting rendering benchmark...");
    const renderStats = [];
    let i = 0;
    const originalFrame = currentFrameIndex;
    function testNextFrame() {
        if (i >= simulationData.length) {
            analyzeBenchmark(renderStats);
            updateDashboard(originalFrame); 
            return;
        }
        const startTime = performance.now();
        updateDashboard(i);
        const endTime = performance.now();
        renderStats.push({ frame: i, time: (endTime - startTime) });
        i++;
        setTimeout(testNextFrame, 0); 
    }

    testNextFrame();
}

function analyzeBenchmark(stats) {
    const times = stats.map(s => s.time);
    const total = times.reduce((a, b) => a + b, 0);
    const avg = total / times.length;
    const max = Math.max(...times);
    const sorted = [...times].sort((a, b) => a - b);
    const p99Index = Math.floor(sorted.length * 0.99);
    const p99 = sorted[p99Index];

    console.log("--- Performance Benchmark Results ---");
    console.log(`Total frames tested: ${times.length}`);
    console.log(`Average rendering time: ${avg.toFixed(2)} ms`);
    console.log(`99th Percentile: ${p99.toFixed(2)} ms`);
    console.log(`Maximum Peak: ${max.toFixed(2)} ms`);
    
    const violations = stats.filter(s => s.time > 50);
    if (violations.length > 0) {
        console.warn(`Warning: ${violations.length} frames have exceeded the critical threshold of 50 ms:`);
        violations.forEach(v => {
            console.log(`- frame ${v.frame}: ${v.time.toFixed(2)} ms`);
        });
    } else {
        console.log("Test passed: no frame has exceeded the 50 ms threshold. Requirement satisfied.");
    }
}

window.runPerformanceBenchmark = runPerformanceBenchmark;
