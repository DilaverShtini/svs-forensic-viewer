let isPlaying = false;
let currentFrameIndex = 0;
let simulationData = []; 
let playbackInterval;
let currentFilter = 'all'; 
const SIMULATION_FPS_MS = 80; 

const playBtn = document.getElementById('play-btn');
const slider = document.getElementById('timeline-slider');
const timeDisplay = document.getElementById('time-display');
const dashcamImg = document.getElementById('dashcam-img');
const eventLogContainer = document.getElementById('event-log');
const timelineMarkersContainer = document.getElementById('timeline-markers');

async function initViewer() {
    try {
        const response = await fetch('../../carla_backend/forensic_data.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        simulationData = await response.json();

        slider.max = Math.max(0, simulationData.length - 1);
        
        if (typeof initCharts === 'function') initCharts(simulationData);
        generateCausalChain(simulationData);
        renderTimelineMarkers(simulationData); 
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
        const tentativeSrc = `../../carla_backend/dashcam_records/frame_${formattedNumber}.jpg`;

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
    timeDisplay.textContent = parseFloat(frameData.time_sim_s).toFixed(1) + "s";

    const formattedNumber = String(index).padStart(6, '0');
    dashcamImg.src = `../../carla_backend/dashcam_records/frame_${formattedNumber}.jpg`;

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
            const t1 = simulationData[0].time_sim_s;
            const t2 = simulationData[1].time_sim_s;
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

function generateCausalChain(data) {
    if (!eventLogContainer) return;
    eventLogContainer.innerHTML = ''; 
    
    if (data.length === 0) return;
    let lastState = data[0].system_state;

    data.forEach((frame, index) => {
        let frameEvents = [];

        if (frame.system_state !== lastState) {
            frameEvents.push({ 
                text: `state changed: ${lastState.toLowerCase()} ➔ ${frame.system_state.toLowerCase()}`, 
                color: '#facc15', 
                type: 'state_change' 
            });
            lastState = frame.system_state;
        }

        if (frame.ego_vehicle && frame.ego_vehicle.controls) {
            const currentBrake = frame.ego_vehicle.controls.brake;
            const prevBrake = index > 0 ? data[index-1].ego_vehicle.controls.brake : 0;
            
            if (currentBrake > 0 && prevBrake === 0) {
                frameEvents.push({ 
                    text: `action: start of braking (pressure: ${currentBrake.toFixed(2)})`, 
                    color: '#38bdf8', 
                    type: 'vehicle_action' 
                });
            }
        }

        const hasExplanations = frame.explanations && frame.explanations.length > 0;

        frameEvents.forEach(evt => {
            const li = createLogItem(index, frame.time_sim_s, evt.text, evt.color, evt.type);

            if (hasExplanations) {
                li.style.cursor = 'pointer';
                const causeList = document.createElement('ul');
                causeList.style.display = 'none'; 
                causeList.style.paddingLeft = '20px';
                causeList.style.marginTop = '8px';
                causeList.style.listStyleType = 'none';

                frame.explanations.forEach(exp => {
                    let expColor = '#ef4444'; 
                    if (exp.type === 'communication_delay') expColor = '#a855f7';
                    if (exp.type === 'environment_hazard') expColor = '#f97316';
                    if (exp.type === 'system_activation') expColor = '#ec4899';

                    const causeItem = document.createElement('li');
                    causeItem.dataset.type = exp.type;
                    causeItem.style.borderLeft = `3px solid ${expColor}`;
                    causeItem.style.paddingLeft = '8px';
                    causeItem.style.marginBottom = '6px';
                    causeItem.style.color = '#ccc';
                    causeItem.style.fontSize = '0.9em';
                    causeItem.innerHTML = `↳ cause: ${exp.event.toLowerCase()}`;

                    causeItem.addEventListener('click', (e) => {
                        e.stopPropagation(); 
                        jumpToFrame(index);
                    });
                    causeList.appendChild(causeItem);
                });
                li.appendChild(causeList);

                li.addEventListener('click', () => {
                    const isHidden = causeList.style.display === 'none';
                    causeList.style.display = isHidden ? 'block' : 'none';
                    jumpToFrame(index);
                });
            } else {
                li.addEventListener('click', () => jumpToFrame(index));
            }

            eventLogContainer.appendChild(li);
        });

        if (hasExplanations && frameEvents.length === 0) {
            frame.explanations.forEach(exp => {
                let expColor = '#ef4444'; 
                if (exp.type === 'communication_delay') expColor = '#a855f7';
                if (exp.type === 'environment_hazard') expColor = '#f97316';
                if (exp.type === 'system_activation') expColor = '#ec4899';

                const li = createLogItem(index, frame.time_sim_s, `event: ${exp.event.toLowerCase()}`, expColor, exp.type);
                li.addEventListener('click', () => jumpToFrame(index));
                eventLogContainer.appendChild(li);
            });
        }
    });
}

function createLogItem(index, time, text, color, type) {
    const li = document.createElement('li');
    li.className = 'log-item';
    li.style.borderLeft = `4px solid ${color}`; 
    li.innerHTML = `<span style="color: #94a3b8;">t=${parseFloat(time).toFixed(2)}s:</span> ${text}`;
    li.dataset.index = index; 
    li.dataset.type = type;
    li.style.display = 'none'; 
    return li;
}

function renderTimelineMarkers(data) {
    if (!timelineMarkersContainer) {
        console.error("error: timelineMarkersContainer not found in DOM.");
        return;
    }
    
    timelineMarkersContainer.innerHTML = '';
    const totalFrames = Math.max(1, data.length - 1);
    let count = 0;
    
    data.forEach((frame, index) => {
        if (frame.explanations && frame.explanations.length > 0) {
            const percentage = (index / totalFrames) * 100;

            frame.explanations.forEach(exp => {
                let color = '#ef4444'; 
                if (exp.type === 'communication_delay') color = '#a855f7';
                if (exp.type === 'environment_hazard') color = '#f97316';
                if (exp.type === 'system_activation') color = '#ec4899';

                const marker = document.createElement('div');
                marker.className = 'timeline-marker';
                marker.style.left = `${percentage}%`;
                marker.style.backgroundColor = color;
                marker.title = exp.event.toLowerCase(); 

                marker.addEventListener('click', (e) => {
                    e.stopPropagation(); 
                    jumpToFrame(index);
                });

                timelineMarkersContainer.appendChild(marker);
                count++;
            });
        }
    });
    
}

function updateDynamicLog(currentIndex) {
    if(!eventLogContainer) return;
    
    const logItems = eventLogContainer.querySelectorAll(':scope > .log-item');
    let latestVisibleItem = null;

    logItems.forEach(item => {
        const itemIndex = parseInt(item.dataset.index, 10);
        const itemType = item.dataset.type;
        const timeMatch = itemIndex <= currentIndex;

        let filterMatch = (currentFilter === 'all' || itemType === currentFilter);

        if (!filterMatch && currentFilter !== 'all') {
            const childCauses = item.querySelectorAll('li[data-type]');
            childCauses.forEach(child => {
                if (child.dataset.type === currentFilter) {
                    filterMatch = true;
                }
            });
        }

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