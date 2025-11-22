console.log('Script.js loaded');

const socket = io();
console.log('Socket initialized:', socket);

// State
let isHost = false;
let myRoomCode = '';
let myPlayerId = ''; // Socket ID
let myName = '';
let currentSelection = null; // Index
let currentScore = 0;
let lastPlayerResults = []; // Store latest response times

// DOM Elements
const views = {
    menu: document.getElementById('view-menu'),
    hostLobby: document.getElementById('view-host-lobby'),
    playerJoin: document.getElementById('view-player-join'),
    playerWaiting: document.getElementById('view-player-waiting'),
    game: document.getElementById('view-game'),
    gameOver: document.getElementById('view-game-over')
};

// Debug: Check if all elements are found
console.log('Views initialized:', views);
Object.keys(views).forEach(key => {
    if (!views[key]) {
        console.error(`Element not found: view-${key}`);
    }
});

// Initialize the menu view
showView('menu');

// --- Navigation ---
function showView(viewName) {
    console.log('showView called with:', viewName);
    console.log('Available views:', Object.keys(views));
    Object.values(views).forEach(el => {
        if (el) el.classList.add('hidden');
    });
    Object.values(views).forEach(el => {
        if (el) el.classList.remove('flex');
    });
    
    const target = views[viewName];
    console.log('Target element for', viewName, ':', target);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('flex');
        console.log('Successfully switched to', viewName);
    } else {
        console.error('Target element not found for view:', viewName);
    }
}

// --- Event Listeners: Menu ---

document.getElementById('btn-menu-host').addEventListener('click', () => {
    isHost = true;
    socket.emit('host_create_game');
});

document.getElementById('btn-menu-join').addEventListener('click', () => {
    isHost = false;
    showView('playerJoin');
});

document.getElementById('btn-join-back').addEventListener('click', () => {
    showView('menu');
});

// --- Event Listeners: Host ---

document.getElementById('btn-host-start').addEventListener('click', () => {
    socket.emit('host_start_game', { roomCode: myRoomCode });
});

document.getElementById('btn-host-next').addEventListener('click', () => {
    socket.emit('host_next_question', { roomCode: myRoomCode });
    document.getElementById('btn-host-next').classList.add('hidden'); // Hide to prevent double clicks
});

// --- Event Listeners: Player ---

document.getElementById('form-join').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('input-name').value.trim();
    const code = document.getElementById('input-code').value.trim();
    
    if(name && code) {
        socket.emit('player_join', { name, roomCode: code });
    }
});

// --- SOCKET EVENTS ---

socket.on('connect', () => {
    myPlayerId = socket.id;
    console.log("Connected", myPlayerId);
});

socket.on('error_msg', (msg) => {
    alert(msg);
});

// 1. Host Logic
socket.on('game_created', ({ roomCode }) => {
    myRoomCode = roomCode;
    document.getElementById('host-room-code').textContent = roomCode;
    showView('hostLobby');
});

socket.on('update_players', (players) => {
    // Update Lobby List
    const list = document.getElementById('host-player-list');
    list.innerHTML = '';
    players.forEach(p => {
        const badge = document.createElement('span');
        badge.className = "bg-gray-800 text-white px-4 py-2 rounded-full text-lg font-bold border border-gray-700 animate-bounce-in";
        badge.textContent = p.name;
        list.appendChild(badge);
    });
    document.getElementById('host-player-count').textContent = players.length;
    
    // Enable Start Button if players > 0
    const startBtn = document.getElementById('btn-host-start');
    if (players.length > 0) {
        startBtn.disabled = false;
        startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        startBtn.disabled = true;
        startBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    // Update Sidebar Leaderboard if in game
    updateLeaderboard(players);
    
    // Update my score display
    if (!isHost) {
        const me = players.find(p => p.id === myPlayerId);
        if (me) {
            if (me.score !== currentScore) {
                // Score changed animation could go here
                currentScore = me.score;
                document.getElementById('my-score').textContent = currentScore;
            }
        }
    }
});

// 2. Player Join Logic
socket.on('player_joined_success', ({ roomCode, name }) => {
    myRoomCode = roomCode;
    myName = name;
    document.getElementById('player-display-name').textContent = name;
    showView('playerWaiting');
});

// 3. Game Loop
socket.on('new_question', (q) => {
    console.log('Received new_question:', q);
    // Reset UI
    showView('game');
    currentSelection = null;
    
    // Clear previous response time display
    const responseTimeEl = document.getElementById('my-response-time');
    if (responseTimeEl && responseTimeEl.parentNode) {
        responseTimeEl.parentNode.removeChild(responseTimeEl);
    }
    
    // Clear host statistics from previous round
    const hostStatsEl = document.getElementById('host-round-stats');
    if (hostStatsEl && hostStatsEl.parentNode) {
        hostStatsEl.parentNode.removeChild(hostStatsEl);
    }
    
    // Clear skip button from previous round
    const oldSkipBtn = document.getElementById('skip-btn');
    if (oldSkipBtn && oldSkipBtn.parentNode) {
        oldSkipBtn.parentNode.removeChild(oldSkipBtn);
    }
    
    // Update Texts
    document.getElementById('q-current').textContent = q.index + 1;
    document.getElementById('q-total').textContent = q.total;
    document.getElementById('question-text').textContent = q.text;
    document.getElementById('timer-display').textContent = q.time;
    document.getElementById('timer-display').classList.remove('text-red-500');
    
    // Host vs Player specific UI
    if (isHost) {
        document.getElementById('host-controls').classList.add('hidden');
        document.getElementById('player-status-bar').classList.add('hidden');
    } else {
        document.getElementById('host-controls').classList.add('hidden');
        document.getElementById('player-status-bar').classList.remove('hidden');
    }

    // Render Options
    const grid = document.getElementById('options-grid');
    grid.innerHTML = '';
    
    q.options.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = optText;
        
        // Interaction
        if (!isHost) {
            btn.onclick = () => {
                if (currentSelection !== null) return; // Already answered
                
                currentSelection = idx;
                btn.classList.add('selected');
                
                // Disable hover effects on all
                Array.from(grid.children).forEach(c => c.disabled = true);
                
                socket.emit('player_submit_answer', { roomCode: myRoomCode, answerIndex: idx });
            };
        } else {
            // Host can't click
            btn.disabled = true;
            btn.style.cursor = 'default';
        }
        
        grid.appendChild(btn);
    });
    
    // Add skip button for players
    if (!isHost) {
        const skipBtn = document.createElement('button');
        skipBtn.id = 'skip-btn';
        skipBtn.className = 'w-full mt-6 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-4 px-6 rounded-xl transition';
        skipBtn.textContent = '⏭️ Skip Question';
        skipBtn.onclick = () => {
            if (currentSelection !== null) return; // Already answered
            
            currentSelection = -1; // Skip indicator
            skipBtn.classList.add('bg-yellow-600', 'text-white');
            skipBtn.textContent = '⏭️ Skipped';
            skipBtn.disabled = true;
            
            // Disable all option buttons
            Array.from(grid.children).forEach(c => c.disabled = true);
            
            socket.emit('player_submit_answer', { roomCode: myRoomCode, answerIndex: -1 });
        };
        
        // Insert skip button after options grid
        grid.parentNode.insertBefore(skipBtn, grid.nextSibling);
    }
});

socket.on('timer_tick', (timeLeft) => {
    const el = document.getElementById('timer-display');
    el.textContent = timeLeft;
    if (timeLeft <= 5) {
        el.classList.add('text-red-500');
    }
});

socket.on('round_result', ({ correctIndex, players, playerResults, fastestCorrect, roundStats }) => {
    // Store player results for leaderboard display
    if (playerResults) {
        lastPlayerResults = playerResults;
    }
    
    // Reveal Colors
    const grid = document.getElementById('options-grid');
    const buttons = Array.from(grid.children);
    
    buttons.forEach((btn, idx) => {
        if (idx === correctIndex) {
            btn.classList.add('correct');
            btn.classList.remove('selected'); // Priority to green
        } else {
            if (idx === currentSelection && currentSelection !== -1) {
                btn.classList.add('wrong');
            } else {
                btn.classList.add('dimmed');
            }
        }
    });
    
    // Update skip button appearance if question was skipped
    const skipBtn = document.getElementById('skip-btn');
    if (skipBtn && currentSelection === -1) {
        skipBtn.classList.add('bg-yellow-600', 'text-white');
        skipBtn.textContent = '⏭️ Skipped - No penalty';
    }

    // Update scores
    updateLeaderboard(players);
    
    // Show fastest correct answer notification if exists
    if (fastestCorrect && fastestCorrect.responseTime !== null) {
        showSpeedWinner(fastestCorrect);
    }
    
    // Show response time for current player if they answered
    if (!isHost && playerResults) {
        const myResult = playerResults.find(r => r.id === myPlayerId);
        if (myResult && (myResult.responseTime !== null || myResult.isSkipped)) {
            showMyResponseTime(myResult);
        }
    }
    
    // Show host statistics if host
    if (isHost && roundStats) {
        showHostStatistics(roundStats);
    }
    
    // If Host, show Next Button
    if (isHost) {
        document.getElementById('host-controls').classList.remove('hidden');
        document.getElementById('btn-host-next').classList.remove('hidden');
    }
});

socket.on('game_over', ({ players }) => {
    showView('gameOver');
    const container = document.getElementById('final-leaderboard');
    container.innerHTML = '';
    
    // Sort players
    const sorted = [...players].sort((a, b) => b.score - a.score);
    
    sorted.forEach((p, i) => {
        const div = document.createElement('div');
        const isMe = p.id === myPlayerId;
        div.className = `flex items-center p-6 rounded-2xl border-2 ${i === 0 ? 'bg-yellow-900/20 border-yellow-500' : 'bg-gray-800 border-gray-700'} ${isMe ? 'ring-2 ring-indigo-500' : ''}`;
        
        // Calculate average response time
        const avgResponseTime = p.questionsAnswered > 0 
            ? (p.totalResponseTime / p.questionsAnswered).toFixed(2) 
            : 'N/A';
            
        div.innerHTML = `
            <div class="flex items-center gap-4 flex-1">
                <span class="text-3xl font-black ${i===0 ? 'text-yellow-500' : 'text-gray-500'}">#${i+1}</span>
                <div class="flex flex-col flex-1">
                    <span class="text-2xl font-bold ${i===0 ? 'text-white' : 'text-gray-300'}">${p.name}</span>
                    <div class="text-sm ${i===0 ? 'text-yellow-200' : 'text-gray-400'}">
                        Total Time: ${p.totalResponseTime ? p.totalResponseTime.toFixed(1) + 's' : 'N/A'}
                        ${p.questionsAnswered > 0 ? ` | Avg: ${avgResponseTime}s` : ''}
                    </div>
                    <div class="text-xs ${i===0 ? 'text-yellow-300' : 'text-gray-500'} mt-1">
                        ✅ ${p.correctAnswers || 0} Correct | ❌ ${p.incorrectAnswers || 0} Wrong | ⏭️ ${p.skippedAnswers || 0} Skipped
                    </div>
                </div>
            </div>
            <div class="text-right">
                <div class="text-3xl font-mono font-bold ${i===0 ? 'text-yellow-400' : 'text-gray-400'}">${p.score}</div>
                <div class="text-xs ${i===0 ? 'text-yellow-300' : 'text-gray-500'}">points</div>
            </div>
        `;
        container.appendChild(div);
    });
});

function updateLeaderboard(players) {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    list.innerHTML = '';
    
    const sorted = [...players].sort((a, b) => b.score - a.score);
    
    sorted.forEach((p, i) => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center p-3 bg-gray-800/50 rounded-lg";
        
        // Find response time for this player from last round
        const playerResult = lastPlayerResults.find(pr => pr.id === p.id);
        let responseTimeDisplay;
        if (playerResult && playerResult.isSkipped) {
            responseTimeDisplay = '<div class="text-xs text-yellow-400">Skipped</div>';
        } else if (playerResult && playerResult.responseTime !== null) {
            responseTimeDisplay = `<div class="text-xs text-gray-400">Last: ${playerResult.responseTime.toFixed(3)}s</div>`;
        } else {
            responseTimeDisplay = '<div class="text-xs text-gray-500">-</div>';
        }
            
        // Add total response time display
        const totalTimeDisplay = playerResult && playerResult.totalResponseTime > 0
            ? `<div class="text-xs text-blue-400">Total: ${playerResult.totalResponseTime.toFixed(1)}s</div>`
            : '';
            
        // Add speed bonus indicator
        const speedBonusDisplay = playerResult && playerResult.speedBonus > 0
            ? `<div class="text-xs text-green-400">+${playerResult.speedBonus} ⚡</div>`
            : '';
        
        div.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i===0?'bg-yellow-500 text-black':'bg-gray-700 text-gray-300'}">${i+1}</div>
                <div class="flex flex-col flex-1 min-w-0">
                    <span class="font-bold truncate text-sm">${p.name}</span>
                    ${responseTimeDisplay}
                    ${totalTimeDisplay}
                </div>
            </div>
            <div class="flex flex-col items-end">
                <span class="font-mono font-bold text-indigo-400">${p.score}</span>
                ${speedBonusDisplay}
            </div>
        `;
        list.appendChild(div);
    });
}

function showSpeedWinner(fastestCorrect) {
    // Create a floating notification showing the fastest correct answer
    const notification = document.createElement('div');
    notification.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-green-600 to-green-500 text-white px-8 py-4 rounded-xl shadow-xl z-50 speed-winner border-2 border-green-400';
    notification.innerHTML = `
        <div class="text-center">
            <div class="text-lg font-bold flex items-center justify-center gap-2">
                <span class="text-2xl">⚡</span>
                <span>Fastest Correct Answer!</span>
                <span class="text-2xl">⚡</span>
            </div>
            <div class="text-xl font-black text-yellow-200">${fastestCorrect.name}</div>
            <div class="text-lg font-mono bg-black/20 px-3 py-1 rounded-full mt-1">${fastestCorrect.responseTime.toFixed(3)}s</div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Remove after 4 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 4000);
}

function showMyResponseTime(myResult) {
    // Show the player's response time in their status bar
    const statusBar = document.getElementById('player-status-bar');
    if (!statusBar) return;
    
    // Create or update response time display
    let responseTimeEl = document.getElementById('my-response-time');
    if (!responseTimeEl) {
        responseTimeEl = document.createElement('div');
        responseTimeEl.id = 'my-response-time';
        responseTimeEl.className = 'bg-gray-800 border border-gray-700 px-6 py-3 rounded-full text-lg font-bold mt-3 response-time-badge';
        statusBar.appendChild(responseTimeEl);
    }
    
    let speedText, colorClass, borderClass;
    
    if (myResult.isSkipped) {
        speedText = `⏭️ Question Skipped - No penalty`;
        colorClass = 'text-yellow-400';
        borderClass = 'border-yellow-500';
        responseTimeEl.className = 'bg-yellow-900/20 border-2 px-6 py-3 rounded-full text-lg font-bold mt-3 response-time-badge border-yellow-500';
    } else if (myResult.isCorrect) {
        speedText = `⏱️ Your Time: ${myResult.responseTime.toFixed(3)}s`;
        colorClass = 'text-blue-400';
        borderClass = 'border-gray-700';
        if (myResult.speedBonus > 0) {
            speedText += ` ⚡ (+${myResult.speedBonus} speed bonus!)`;
            colorClass = 'text-green-400';
            borderClass = 'border-green-500';
            responseTimeEl.className = 'bg-green-900/30 border-2 px-6 py-3 rounded-full text-lg font-bold mt-3 response-time-badge border-green-500';
        } else {
            colorClass = 'text-yellow-400';
            borderClass = 'border-yellow-500';
            responseTimeEl.className = 'bg-yellow-900/20 border-2 px-6 py-3 rounded-full text-lg font-bold mt-3 response-time-badge border-yellow-500';
        }
    } else {
        colorClass = 'text-red-400';
        borderClass = 'border-red-500';
        responseTimeEl.className = 'bg-red-900/20 border-2 px-6 py-3 rounded-full text-lg font-bold mt-3 response-time-badge border-red-500';
    }
    
    responseTimeEl.innerHTML = `<span class="${colorClass}">${speedText}</span>`;
    
    // Add animation
    responseTimeEl.classList.add('score-pop');
    setTimeout(() => {
        responseTimeEl.classList.remove('score-pop');
    }, 300);
}

function showHostStatistics(roundStats) {
    // Show statistics in the leaderboard header for host
    const leaderboardList = document.getElementById('leaderboard-list');
    if (!leaderboardList) return;
    
    // Create or update statistics display
    let statsEl = document.getElementById('host-round-stats');
    if (!statsEl) {
        statsEl = document.createElement('div');
        statsEl.id = 'host-round-stats';
        statsEl.className = 'bg-blue-900/30 border border-blue-500 rounded-lg p-3 mb-4';
        leaderboardList.parentNode.insertBefore(statsEl, leaderboardList);
    }
    
    const correctPercentage = roundStats.totalPlayers > 0 
        ? Math.round((roundStats.correctAnswers / roundStats.totalPlayers) * 100) 
        : 0;
        
    const avgTimeDisplay = roundStats.averageResponseTime > 0 
        ? roundStats.averageResponseTime.toFixed(2) + 's' 
        : 'N/A';
    
    statsEl.innerHTML = `
        <div class="text-sm font-bold text-blue-300 mb-2">Round Statistics</div>
        <div class="grid grid-cols-2 gap-3 text-xs">
            <div class="text-center">
                <div class="text-green-400 font-bold text-lg">${roundStats.correctAnswers}</div>
                <div class="text-gray-400">Correct (${correctPercentage}%)</div>
            </div>
            <div class="text-center">
                <div class="text-blue-400 font-bold text-lg">${avgTimeDisplay}</div>
                <div class="text-gray-400">Avg Time</div>
            </div>
        </div>
    `;
}
