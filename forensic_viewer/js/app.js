let isPlaying = false;
let currentFrameIndex = 0;
let simulationData = []; 
let playbackInterval;
let currentFilter = 'all'; 

const playBtn = document.getElementById('play-btn');
const slider = document.getElementById('timeline-slider');
const timeDisplay = document.getElementById('time-display');
const dashcamImg = document.getElementById('dashcam-img');
const eventLogContainer = document.getElementById('event-log');
const timelineMarkersContainer = document.getElementById('timeline-markers');

async function initViewer() {
    try {
        const response = await fetch('./carla_backend/forensic_data.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const fullData = await response.json();
        
        simulationData = fullData.telemetry;
        const eventsData = fullData.events;

        slider.max = Math.max(0, simulationData.length - 1);
        
        if (typeof initCharts === 'function') initCharts(simulationData);
        
        generateCausalChain(eventsData, simulationData);
        renderTimelineMarkers(eventsData, simulationData); 
        setupFilterListeners();

        updateDashboard(0);
        
    } catch (error) {
        console.error("error update json: ", error);
    }
}

function loadDashcamImageSmart(targetFrameNumber) {
    const offsetsToTry = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5];
    let currentTryIndex = 0;

    function attemptLoad() {
        if (currentTryIndex >= offsetsToTry.length) return; 

        const testFrameNumber = targetFrameNumber + offsetsToTry[currentTryIndex];
        const formattedNumber = String(testFrameNumber).padStart(6, '0');
        const tentativeSrc = `./carla_backend/dashcam_records/frame_${formattedNumber}.jpg`;

        const tempImg = new Image();
        tempImg.onload = () => { dashcamImg.src = tentativeSrc; };
        tempImg.onerror = () => {
            currentTryIndex++;
            attemptLoad();
        };

        tempImg.src = tentativeSrc;
    }

    attemptLoad();
}

function updateDashboard(index) {
    if (!simulationData[index]) return;
    const frameData = simulationData[index];
    currentFrameIndex = index;
    slider.value = index;
    timeDisplay.textContent = parseFloat(frameData.t).toFixed(1) + "s";
    
    loadDashcamImageSmart(index);
    if (typeof drawBEV === 'function') drawBEV(frameData);
    if (typeof updateChartSync === 'function') updateChartSync(); 
    updateDynamicLog(index);
}

function jumpToFrame(index) {
    if (isPlaying) {
        togglePlay();
    }
    currentFrameIndex = parseInt(index, 10);
    updateDashboard(currentFrameIndex);
}

function togglePlay() {
    isPlaying = !isPlaying;
    playBtn.textContent = isPlaying ? "PAUSE" : "PLAY";
    
    if (isPlaying) {
        let frameDelayMs = 80; 
        if (simulationData.length > 1) {
            const t1 = simulationData[0].t;
            const t2 = simulationData[1].t;
            frameDelayMs = (t2 - t1) * 1000; 
        }

        playbackInterval = setInterval(() => {
            currentFrameIndex++;
            if (currentFrameIndex >= simulationData.length) {
                currentFrameIndex = 0;
                togglePlay();
            } else {
                updateDashboard(currentFrameIndex);
            }
        }, frameDelayMs); 
    } else {
        clearInterval(playbackInterval);
    }
}

function generateCausalChain(events, telemetry) {
    if (!eventLogContainer) return;
    eventLogContainer.innerHTML = '';
    const eventMap = {};
    events.forEach(evt => {
        let targetFrameIndex = 0;
        let minDiff = Infinity;
        telemetry.forEach((frame, idx) => {
            const diff = Math.abs(frame.t - evt.t);
            if (diff < minDiff) {
                minDiff = diff;
                targetFrameIndex = idx;
            }
        });
        evt.targetFrameIndex = targetFrameIndex;
        eventMap[evt.id] = evt;
    });

    events.forEach(evt => {
        let eventType = 'perception';
        let color = '#38bdf8'; 

        if (evt.desc.includes('braking')) {
            eventType = 'system';
            color = '#f97316';
        }
        if (evt.desc.includes('V2X')) {
            eventType = 'v2x';
            color = '#a855f7';
        }
        if (evt.desc.includes('CRITICAL') || evt.desc.includes('Collision')) {
            eventType = 'critical';
            color = '#ef4444';
        }

        const li = document.createElement('li');
        li.className = 'log-item active log-item-custom';
        li.style.borderLeft = `4px solid ${color}`; 
        
        li.dataset.index = evt.targetFrameIndex;
        li.dataset.type = eventType;

        li.innerHTML = `<span class="log-time-span">t=${parseFloat(evt.t).toFixed(2)}s:</span> <strong>${evt.desc}</strong>`;

        if (evt.causes && evt.causes.length > 0) {
            const causeDiv = document.createElement('div');
            causeDiv.className = 'cause-div';
            
            const introSpan = document.createElement('span');
            introSpan.innerHTML = `↳ <strong class="cause-intro-strong">Caused by:</strong> `;
            causeDiv.appendChild(introSpan);
            
            evt.causes.forEach((causeId, index) => {
                const causeEvt = eventMap[causeId];
                const causeText = causeEvt ? causeEvt.desc : causeId;
                
                if (index > 0) {
                    const separator = document.createElement('span');
                    separator.innerHTML = `<br>↳ e da: `;
                    causeDiv.appendChild(separator);
                }
                const linkSpan = document.createElement('span');
                linkSpan.className = 'cause-link-span';
                linkSpan.innerText = causeText;

                if (causeEvt) {
                    linkSpan.addEventListener('click', (e) => {
                        e.stopPropagation();
                        jumpToFrame(causeEvt.targetFrameIndex);
                    });
                }
                causeDiv.appendChild(linkSpan);
            });
            
            li.appendChild(causeDiv);
        }
        li.addEventListener('click', () => jumpToFrame(evt.targetFrameIndex));
        eventLogContainer.appendChild(li);
    });
}

function renderTimelineMarkers(events, telemetry) {
    if (!timelineMarkersContainer) return;
    timelineMarkersContainer.innerHTML = '';
    
    const maxTime = telemetry.length > 0 ? telemetry[telemetry.length - 1].t : 1;

    events.forEach(evt => {
        const percentage = (evt.t / maxTime) * 100;
        
        let color = '#38bdf8'; 
        if (evt.desc.includes('V2X')) color = '#a855f7'; 
        if (evt.desc.includes('CRITICAL') || evt.desc.includes('Collision')) color = '#ef4444'; 
        if (evt.desc.includes('braking')) color = '#f97316'; 

        const marker = document.createElement('div');
        marker.className = 'timeline-marker timeline-marker-line';
        marker.style.left = `${percentage}%`;
        marker.style.backgroundColor = color;
        
        marker.title = `t=${parseFloat(evt.t).toFixed(2)}s: ${evt.desc}`; 

        marker.addEventListener('click', (e) => {
            e.stopPropagation();
            
            let targetFrameIdx = 0;
            let minDiff = Infinity;
            telemetry.forEach((frame, idx) => {
                const diff = Math.abs(frame.t - evt.t);
                if (diff < minDiff) {
                    minDiff = diff;
                    targetFrameIdx = idx;
                }
            });
            
            jumpToFrame(targetFrameIdx);
        });

        timelineMarkersContainer.appendChild(marker);
    });
}

function createLogItem(index, time, text, color, type) {
    const li = document.createElement('li');
    li.className = 'log-item';
    li.style.borderLeft = `4px solid ${color}`; 
    li.innerHTML = `<span class="log-time-span">t=${parseFloat(time).toFixed(2)}s:</span> ${text}`;
    li.dataset.index = index; 
    li.dataset.type = type;
    li.style.display = 'none'; 
    return li;
}

function updateDynamicLog(currentIndex) {
    if(!eventLogContainer) return;

    const logItems = eventLogContainer.querySelectorAll(':scope > .log-item');
    let latestVisibleItem = null;

    logItems.forEach(item => {
        const itemIndex = parseInt(item.dataset.index, 10);
        const itemType = item.dataset.type;
        const timeMatch = itemIndex <= currentIndex;

        const filterMatch = (currentFilter === 'all' || itemType === currentFilter);

        if (timeMatch && filterMatch) {
            item.style.display = 'block';
            item.classList.remove('active');
            latestVisibleItem = item; 
        } else {
            item.style.display = 'none';
        }
    });

    if (latestVisibleItem) {
        latestVisibleItem.classList.add('active');
        eventLogContainer.scrollTo({
            top: latestVisibleItem.offsetTop - eventLogContainer.offsetTop,
            behavior: 'smooth'
        });
    }
}

function setupFilterListeners() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => b.classList.remove('active-filter'));
            e.target.classList.add('active-filter');
            
            currentFilter = e.target.dataset.filter;
            updateDynamicLog(currentFrameIndex); 
        });
    });
}

if (playBtn) playBtn.addEventListener('click', togglePlay);
if (slider) {
    slider.addEventListener('input', (e) => {
        jumpToFrame(e.target.value);
    });
}

initViewer();