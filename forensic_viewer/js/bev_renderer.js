const canvas = document.getElementById('bev-canvas');
const ctx = canvas.getContext('2d');
const SCALE = 8; 
let cachedRoadPath = null;

function drawPathLine(context, path, lateralOffset) {
    if (!path || path.length === 0) return;
    context.beginPath();
    let started = false;
    path.forEach((pt) => {
        const yawRad = pt.yaw; 
        const nx = -Math.sin(yawRad);
        const ny = Math.cos(yawRad);
        const px = pt.x + (nx * lateralOffset);
        const py = pt.y + (ny * lateralOffset);
        
        if (isNaN(px) || isNaN(py)) return;

        if (!started) {
            context.moveTo(px, py);
            started = true;
        } else {
            context.lineTo(px, py);
        }
    });
    context.stroke();
}

function drawBEV(frameData) {
    if(!canvas.parentElement || !simulationData || simulationData.length === 0) return;

    const currentIndex = simulationData.indexOf(frameData);
    if (currentIndex === -1) return;

    // Cache the road path if not already cached
    if (!cachedRoadPath) {
        let rawPts = [];
        let lastP = null;
        let isOvertaking = false;
        let lastValidAudi = null;

        for (let i = 0; i < simulationData.length; i++) {
            const f = simulationData[i];
            const ego = f.e;
            const audi = f.a.find(a => a.id && (a.id.includes('car_audi') || a.id.includes('audi')));
            if (audi) lastValidAudi = audi;

            if (lastValidAudi) {
                const dx = ego.x - lastValidAudi.x;
                const dy = ego.y - lastValidAudi.y;
                const refYaw = (lastValidAudi.yaw || 0) * (Math.PI / 180);
                const latDist = -dx * Math.sin(refYaw) + dy * Math.cos(refYaw);
                
                if (latDist < -1.5) isOvertaking = true;
                else if (latDist > -0.5) isOvertaking = false;
            }

            let px = ego.x;
            let py = ego.y;
            
            if (isOvertaking) {
                const egoYawRad = (ego.yaw || 0) * (Math.PI / 180);
                const nx = -Math.sin(egoYawRad);
                const ny = Math.cos(egoYawRad);
                px = ego.x + nx * 3.5; 
                py = ego.y + ny * 3.5;
            }

            if (!lastP || Math.hypot(px - lastP.x, py - lastP.y) > 0.5) {
                rawPts.push({ x: px, y: py });
                lastP = { x: px, y: py };
            }
        }

        let smoothPts = [];
        const windowSize = 12; 
        for (let i = 0; i < rawPts.length; i++) {
            let sx = 0, sy = 0, count = 0;
            const start = Math.max(0, i - windowSize);
            const end = Math.min(rawPts.length - 1, i + windowSize);
            for (let j = start; j <= end; j++) {
                sx += rawPts[j].x;
                sy += rawPts[j].y;
                count++;
            }
            smoothPts.push({ x: sx / count, y: sy / count });
        }

        for (let i = 0; i < smoothPts.length; i++) {
            if (i < smoothPts.length - 1) {
                const dx = smoothPts[i+1].x - smoothPts[i].x;
                const dy = smoothPts[i+1].y - smoothPts[i].y;
                smoothPts[i].yaw = Math.atan2(dy, dx);
            } else if (i > 0) {
                smoothPts[i].yaw = smoothPts[i-1].yaw;
            } else {
                smoothPts[i].yaw = 0;
            }
        }

        cachedRoadPath = [];
        if (smoothPts.length > 0) {
            const p0 = smoothPts[0];
            cachedRoadPath.push({
                x: p0.x - Math.cos(p0.yaw) * 200,
                y: p0.y - Math.sin(p0.yaw) * 200,
                yaw: p0.yaw
            });
            cachedRoadPath.push(...smoothPts);
            const pLast = smoothPts[smoothPts.length - 1];
            cachedRoadPath.push({
                x: pLast.x + Math.cos(pLast.yaw) * 200,
                y: pLast.y + Math.sin(pLast.yaw) * 200,
                yaw: pLast.yaw
            });
        }
    }

    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight - 40; 
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const ego = frameData.e;

    let minDist = Infinity;
    let roadPt = cachedRoadPath[0];
    cachedRoadPath.forEach(pt => {
        const d = Math.hypot(pt.x - ego.x, pt.y - ego.y);
        if (d < minDist) {
            minDist = d;
            roadPt = pt;
        }
    });

    const roadYawRad = roadPt.yaw;
    const nx = -Math.sin(roadYawRad);
    const ny = Math.cos(roadYawRad);
    
    const camX = roadPt.x + (nx * -5.25);
    const camY = roadPt.y + (ny * -5.25);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(-Math.PI / 2);
    ctx.rotate(-roadYawRad);
    ctx.scale(SCALE, SCALE);
    ctx.translate(-camX, -camY);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const laneWidth = 3.5;
    const roadWidth = laneWidth * 4;

    ctx.lineWidth = roadWidth;
    ctx.strokeStyle = '#262630';
    drawPathLine(ctx, cachedRoadPath, -5.25);

    ctx.lineWidth = laneWidth * 1.5;
    ctx.strokeStyle = '#1e1e26';
    drawPathLine(ctx, cachedRoadPath, 3.5);

    ctx.lineWidth = 0.25;
    ctx.strokeStyle = '#cbd5e1';
    ctx.setLineDash([]);
    drawPathLine(ctx, cachedRoadPath, 1.75);
    drawPathLine(ctx, cachedRoadPath, -12.25);

    ctx.lineWidth = 0.15;
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([1.5, 2]);
    drawPathLine(ctx, cachedRoadPath, -1.75);
    drawPathLine(ctx, cachedRoadPath, -8.75);

    ctx.lineWidth = 0.25;
    ctx.strokeStyle = '#facc15';
    ctx.setLineDash([2.5, 2.5]);
    drawPathLine(ctx, cachedRoadPath, -5.25);
    ctx.setLineDash([]);

    // Render the actors
    frameData.a.forEach(actor => {
        ctx.save();
        ctx.translate(actor.x, actor.y);
        
        // Align the actor with the closest road point
        let minActorDist = Infinity;
        let closestRoadPt = cachedRoadPath[0];
        cachedRoadPath.forEach(pt => {
            const d = Math.hypot(pt.x - actor.x, pt.y - actor.y);
            if (d < minActorDist) {
                minActorDist = d;
                closestRoadPt = pt;
            }
        });

        const actorYawRad = closestRoadPt ? closestRoadPt.yaw : (actor.yaw || 0) * (Math.PI / 180);
        ctx.rotate(actorYawRad);

        ctx.beginPath();
        if (actor.id && actor.id.includes('van_volkswagen')) {
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(-2.5, -1.1, 5.0, 2.2);
            ctx.fillStyle = '#111827';
            ctx.fillRect(0.8, -0.9, 1.2, 1.8);
        } else if (actor.id && actor.id.includes('car_audi')) {
            ctx.fillStyle = '#f59e0b';
            ctx.fillRect(-2.4, -1.0, 4.8, 2.0);
            ctx.fillStyle = '#111827';
            ctx.fillRect(0.6, -0.9, 1.2, 1.8);
        } else {
            ctx.arc(0, 0, 0.6, 0, 2 * Math.PI);
            ctx.fillStyle = '#ef4444';
            ctx.fill();
        }
        ctx.lineWidth = 0.1;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.restore();
    });

    // Render Ego Vehicle
    ctx.save();
    ctx.translate(ego.x, ego.y);
    ctx.rotate((ego.yaw || 0) * (Math.PI / 180));
    ctx.fillStyle = '#10b981';
    ctx.fillRect(-2.4, -1.0, 4.8, 2.0);
    ctx.fillStyle = '#111827';
    ctx.fillRect(0.6, -0.9, 1.2, 1.8);
    ctx.restore(); // End of Ego Vehicle rendering

    ctx.restore(); // Restore the context of the canvas to the original state

    // Tag for the actors with their IDs
    frameData.a.forEach(actor => {
        const dX = actor.x - camX;
        const dY = actor.y - camY;
        const relX = dX * Math.cos(roadYawRad) + dY * Math.sin(roadYawRad);
        const relY = -dX * Math.sin(roadYawRad) + dY * Math.cos(roadYawRad);
        const pixelX = centerX + relY * SCALE;
        const pixelY = centerY - relX * SCALE;
        
        ctx.fillStyle = '#fff';
        ctx.font = '10px Arial';
        ctx.fillText(actor.id || 'actor', pixelX + 12, pixelY + 4);
    });
}