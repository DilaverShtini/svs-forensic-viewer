const canvas = document.getElementById('bev-canvas');
const ctx = canvas.getContext('2d');
const SCALE = 8; 

function drawBEV(frameData) {
    if(!canvas.parentElement) return;

    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight - 40; 
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const ego = frameData.ego_vehicle;
    const egoYawRad = ego.rotation.yaw * (Math.PI / 180);

    const roadWidthPx = 8 * SCALE; 
    
    ctx.fillStyle = '#262630';
    ctx.fillRect(centerX - roadWidthPx / 2, 0, roadWidthPx, canvas.height);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - roadWidthPx / 2, 0);
    ctx.lineTo(centerX - roadWidthPx / 2, canvas.height);
    ctx.moveTo(centerX + roadWidthPx / 2, 0);
    ctx.lineTo(centerX + roadWidthPx / 2, canvas.height);
    ctx.stroke();

    const forwardX = Math.cos(egoYawRad);
    const forwardY = Math.sin(egoYawRad);
    const distanceTraveled = (ego.position.x * forwardX) + (ego.position.y * forwardY);
    
    const dashPatternLength = 40; 
    const scrollOffset = (distanceTraveled * SCALE) % dashPatternLength;

    ctx.strokeStyle = '#facc15'; 
    ctx.lineWidth = 2;
    ctx.setLineDash([20, 20]);
    ctx.lineDashOffset = -scrollOffset;
    
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvas.height);
    ctx.stroke();
    
    ctx.setLineDash([]);
    frameData.actors.forEach(actor => {
        const deltaX = actor.position.x - ego.position.x;
        const deltaY = actor.position.y - ego.position.y; 

        const relX = deltaX * Math.cos(egoYawRad) + deltaY * Math.sin(egoYawRad);
        const relY = -deltaX * Math.sin(egoYawRad) + deltaY * Math.cos(egoYawRad);

        const pixelX = centerX + (relY * SCALE);
        const pixelY = centerY - (relX * SCALE); 

        ctx.beginPath();
       if (actor.id.includes('van_volkswagen')) {
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(pixelX - 10, pixelY - 20, 20, 40); 
        } else if(actor.id.includes('vehicle_stopped')){
            ctx.fillStyle = '#f59e0b';
            ctx.fillRect(pixelX - 9, pixelY - 18, 18, 36);
        } else {
            ctx.arc(pixelX, pixelY, 6, 0, 2 * Math.PI);
            ctx.fillStyle = '#ef4444';
            ctx.fill();
        }
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        ctx.fillStyle = '#fff';
        ctx.font = '10px Arial';
        ctx.fillText(actor.id, pixelX + 12, pixelY + 4);
    });

    ctx.fillStyle = '#10b981'; 
    ctx.fillRect(centerX - 10, centerY - 20, 20, 40); 
}