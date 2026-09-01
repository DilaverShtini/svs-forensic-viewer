let isPlaying = false;
let currentFrameIndex = 0;
let simulationData = []; 
let playbackInterval;
let currentFilter = 'all'; 
let timeToFrameMap = {};
let eventMap = {};

const playBtn = document.getElementById('play-btn');
const slider = document.getElementById('timeline-slider');
const timeDisplay = document.getElementById('time-display');
const dashcamImg = document.getElementById('dashcam-img');
const eventLogContainer = document.getElementById('event-log');
const timelineMarkersContainer = document.getElementById('timeline-markers');

async function initViewer() {
    try {
        const response = await fetch('forensic_data.json');
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
        const tentativeSrc = `/dashcam_records/frame_${formattedNumber}.jpg`;

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

function updateDashboard(index, forceEventId = null) {
    if (!simulationData[index]) return;
    const frameData = simulationData[index];
    currentFrameIndex = index;
    slider.value = index;
    timeDisplay.textContent = parseFloat(frameData.t).toFixed(1) + "s";
    
    loadDashcamImageSmart(index);
    if (typeof drawBEV === 'function') drawBEV(frameData);
    if (typeof updateChartSync === 'function') updateChartSync(); 
    updateDynamicLog(index, forceEventId);
}

function jumpToFrame(index, forceEventId = null) {
    if (isPlaying) {
        togglePlay();
    }
    currentFrameIndex = parseInt(index, 10);
    updateDashboard(currentFrameIndex, forceEventId);
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

    events.forEach(evt => {
        eventMap[evt.id] = evt;
        
        let targetIdx = telemetry.length - 1; 
        for (let i = 0; i < telemetry.length; i++) {
            if (telemetry[i].t >= evt.t) {
                targetIdx = i;
                break;
            }
        }
        
        evt.targetFrameIndex = targetIdx;
        timeToFrameMap[parseFloat(evt.t).toFixed(2)] = targetIdx;
    });

    events.forEach(evt => {
        let eventType = 'perception';
        let color = '#38bdf8'; 
        
        const safeId = evt.id.toLowerCase();
        const safeDesc = evt.desc.toLowerCase();

        if (safeId.includes('critical') || safeId.includes('collision') || safeDesc.includes('critical') || safeDesc.includes('collision')) {
            eventType = 'critical';
            color = '#ef4444';
        } else if (safeId.includes('v2x') || safeDesc.includes('v2x')) {
            eventType = 'v2x';
            color = '#a855f7';
        } else if (safeId.includes('brake') || safeDesc.includes('braking')) {
            eventType = 'system';
            color = '#f97316';
        }

        const li = document.createElement('li');
        li.className = 'log-item active log-item-custom';
        li.style.borderLeft = `4px solid ${color}`; 
        
        li.dataset.index = evt.targetFrameIndex;
        li.dataset.type = eventType;
        li.dataset.eventId = evt.id;
        li.dataset.originalColor = color;
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
                        jumpToFrame(causeEvt.targetFrameIndex, causeEvt.id); 
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
    const markerGroups = {};
    events.forEach(evt => {
        const timeKey = parseFloat(evt.t).toFixed(2);
        if (!markerGroups[timeKey]) {
            markerGroups[timeKey] = [];
        }
        markerGroups[timeKey].push(evt);
    });

    Object.values(markerGroups).forEach(group => {
        const firstEvt = group[0];
        const percentage = (firstEvt.t / maxTime) * 100;
        const colors = [...new Set(group.map(evt => {
            const safeId = evt.id.toLowerCase();
            const safeDesc = evt.desc.toLowerCase();
            if (safeId.includes('critical') || safeId.includes('collision') || safeDesc.includes('critical') || safeDesc.includes('collision')) return '#ef4444';
            if (safeId.includes('v2x') || safeDesc.includes('v2x')) return '#a855f7';
            if (safeId.includes('brake') || safeDesc.includes('braking')) return '#f97316';
            return '#38bdf8';
        }))];
        const marker = document.createElement('div');
        marker.className = 'timeline-marker timeline-marker-line';
        marker.style.left = `${percentage}%`;
        
        if (colors.length === 1) {
            marker.style.backgroundColor = colors[0];
        } else {
            marker.style.background = `linear-gradient(to bottom, ${colors[0]} 50%, ${colors[1]} 50%)`;
        }
        marker.title = group.map(e => `t=${parseFloat(e.t).toFixed(2)}s: ${e.desc}`).join('\n'); 
        marker.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetFrameIdx = timeToFrameMap[parseFloat(firstEvt.t).toFixed(2)];
            jumpToFrame(targetFrameIdx);
        });

        timelineMarkersContainer.appendChild(marker);
    });
}

function updateDynamicLog(currentIndex, forceEventId = null) {
    if (!eventLogContainer) return;

    const logItems = eventLogContainer.querySelectorAll(':scope > .log-item');
    let targetActiveItem = null;
    let lastChronologicalItem = null;

    logItems.forEach(item => {
        const itemIndex = parseInt(item.dataset.index, 10);
        const itemType = item.dataset.type;
        const timeMatch = itemIndex <= currentIndex;

        const filterMatch = (currentFilter === 'all' || itemType === currentFilter);
        if (timeMatch && filterMatch) {
            item.style.display = 'block';
            item.classList.remove('active');
            lastChronologicalItem = item; 
            
            if (forceEventId && item.dataset.eventId === forceEventId) {
                targetActiveItem = item;
            }
        } else {
            item.style.display = 'none';
        }
    });
    const itemToFocus = targetActiveItem || lastChronologicalItem;

    if (itemToFocus) {
        itemToFocus.classList.add('active');
        
        eventLogContainer.scrollTo({
            top: itemToFocus.offsetTop - eventLogContainer.offsetTop - 10,
            behavior: 'smooth'
        });
        if (forceEventId) {
            itemToFocus.style.transition = 'none';
            itemToFocus.style.backgroundColor = 'rgba(250, 204, 21, 0.27)';
            itemToFocus.style.borderLeftColor = '#facc15';
            void itemToFocus.offsetWidth;
            setTimeout(() => {
                itemToFocus.style.transition = 'all 1.5s ease-out';
                itemToFocus.style.backgroundColor = '';
                itemToFocus.style.borderLeftColor = itemToFocus.dataset.originalColor; 
            }, 50);
        }
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
