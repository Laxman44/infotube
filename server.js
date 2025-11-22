const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Load questions from file
let questionsData = [];
try {
    const data = fs.readFileSync(path.join(__dirname, 'data', 'gk_sansthan.json'), 'utf8');
    questionsData = JSON.parse(data);
    console.log(`Loaded ${questionsData.length} questions.`);
} catch (err) {
    console.error("Error loading questions:", err);
}

// Serve static files from root
app.use(express.static(__dirname));

// Game State Storage (In-memory)
const rooms = {}; // { roomCode: { status, players, currentQuestionIndex, timerInterval, answers, gameQuestions, questionStartTime, answerTimes } }

// Constants
const QUESTION_TIME = 15;
const SCORE_CORRECT = 5;
const SCORE_WRONG = -5;
const SPEED_BONUS_MAX = 10; // Maximum bonus points for fastest answer

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- HOST EVENTS ---

    socket.on('host_create_game', () => {
        const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
        rooms[roomCode] = {
            status: 'LOBBY',
            hostId: socket.id,
            players: [], // { id, name, score }
            currentQuestionIndex: 0,
            timerInterval: null,
            answers: {}, // { playerId: answerIndex }
            gameQuestions: [], // Will hold the specific questions for this session
            questionStartTime: null, // Track when question was sent
            answerTimes: {} // { playerId: timestamp }
        };
        socket.join(roomCode);
        socket.emit('game_created', { roomCode });
        console.log(`Game created: ${roomCode}`);
    });

    socket.on('host_start_game', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        // --- CUSTOM LOGIC: FILTER QUESTIONS HERE ---
        // Currently set to: Play questions with ID 5 to 10
        room.gameQuestions = questionsData.filter(q => q.id >= 5 && q.id <= 10);

        // Fallback: If filter finds nothing (or you want all), load all questions
        if (room.gameQuestions.length === 0) {
            console.log("Filter returned empty, loading all questions.");
            room.gameQuestions = [...questionsData];
        }
        
        console.log(`Starting game with ${room.gameQuestions.length} questions`);
        // -------------------------------------------

        room.status = 'GAME_ACTIVE';
        room.currentQuestionIndex = 0;
        // Reset scores and response time tracking
        room.players.forEach(p => {
            p.score = 0;
            p.totalResponseTime = 0;
            p.questionsAnswered = 0;
            p.correctAnswers = 0;
            p.incorrectAnswers = 0;
            p.skippedAnswers = 0;
        });
        
        io.to(roomCode).emit('update_players', room.players);
        sendQuestion(roomCode);
    });

    socket.on('host_next_question', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.currentQuestionIndex++;
        
        // Check against the room's specific question list length
        if (room.currentQuestionIndex < room.gameQuestions.length) {
            sendQuestion(roomCode);
        } else {
            endGame(roomCode);
        }
    });

    // --- PLAYER EVENTS ---

    socket.on('player_join', ({ name, roomCode }) => {
        const room = rooms[roomCode];
        if (!room) {
            socket.emit('error_msg', "Invalid Room Code");
            return;
        }
        if (room.status !== 'LOBBY') {
            socket.emit('error_msg', "Game already in progress");
            return;
        }
        
        // Check for duplicate names (simple check)
        const existing = room.players.find(p => p.name === name);
        if (existing) {
            socket.emit('error_msg', "Name taken in this room");
            return;
        }

        const player = { 
            id: socket.id, 
            name, 
            score: 0, 
            totalResponseTime: 0, 
            questionsAnswered: 0,
            correctAnswers: 0,
            incorrectAnswers: 0,
            skippedAnswers: 0
        };
        room.players.push(player);
        socket.join(roomCode);

        // Notify player and update room
        socket.emit('player_joined_success', { roomCode, name });
        io.to(roomCode).emit('update_players', room.players);
        console.log(`${name} joined ${roomCode}`);
    });

    socket.on('player_submit_answer', ({ roomCode, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.status !== 'QUESTION_ACTIVE') return;

        // Only accept first answer
        if (room.answers[socket.id] === undefined) {
            room.answers[socket.id] = answerIndex;
            // Record the time when answer was submitted (but not for skipped questions)
            if (answerIndex !== -1) { // -1 indicates skip
                room.answerTimes[socket.id] = Date.now();
            }
        }
    });

    socket.on('disconnect', () => {
        // Clean up if host disconnects or player leaves
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id) {
                // Host left, destroy room
                io.to(code).emit('game_ended', { reason: "Host disconnected" });
                if (room.timerInterval) clearInterval(room.timerInterval);
                delete rooms[code];
            } else {
                const pIndex = room.players.findIndex(p => p.id === socket.id);
                if (pIndex !== -1) {
                    room.players.splice(pIndex, 1);
                    io.to(code).emit('update_players', room.players);
                }
            }
        }
    });
});

function sendQuestion(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.status = 'QUESTION_ACTIVE';
    room.answers = {}; // Reset answers for new round
    room.answerTimes = {}; // Reset answer times for new round
    room.questionStartTime = Date.now(); // Record when question was sent
    
    // Get question from the room's filtered list
    const question = room.gameQuestions[room.currentQuestionIndex];
    console.log(`Sending question ${room.currentQuestionIndex + 1}/${room.gameQuestions.length}: ${question ? question.text : 'UNDEFINED'}`);
    
    if (!question) {
        console.error('No question found at index:', room.currentQuestionIndex);
        return;
    }
    
    // Send question WITHOUT correct answer to clients
    const questionPayload = {
        index: room.currentQuestionIndex,
        total: room.gameQuestions.length,
        text: question.text,
        options: question.options,
        time: QUESTION_TIME
    };

    io.to(roomCode).emit('new_question', questionPayload);

    // Start Timer
    let timeLeft = QUESTION_TIME;
    if (room.timerInterval) clearInterval(room.timerInterval);

    room.timerInterval = setInterval(() => {
        timeLeft--;
        io.to(roomCode).emit('timer_tick', timeLeft);

        if (timeLeft <= 0) {
            clearInterval(room.timerInterval);
            finishRound(roomCode);
        }
    }, 1000);
}

function finishRound(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.status = 'ROUND_ENDED';
    
    // Get question from the room's filtered list
    const currentQ = room.gameQuestions[room.currentQuestionIndex];
    const correctIndex = currentQ.correct;

    // Calculate response times and collect correct answers with times
    const playerResults = [];
    const correctAnswerers = [];
    
    room.players.forEach(player => {
        const answer = room.answers[player.id];
        const answerTime = room.answerTimes[player.id];
        let responseTime = null;
        let speedBonus = 0;
        
        if (answerTime && room.questionStartTime) {
            responseTime = (answerTime - room.questionStartTime) / 1000; // Convert to seconds with decimals
        }
        
        // Calculate base score and track statistics
        if (answer === undefined || answer === -1) {
            // No answer or explicit skip: treat as skipped
            player.skippedAnswers++;
        } else if (answer === correctIndex) {
            // Correct answer
            player.score += SCORE_CORRECT;
            player.correctAnswers++;
            correctAnswerers.push({ player, responseTime });
            // Only add time and count for correct answers
            if (responseTime !== null) {
                player.totalResponseTime += responseTime;
                player.questionsAnswered++;
            }
        } else {
            // Wrong answer: negative points, no time tracking
            player.score += SCORE_WRONG;
            player.incorrectAnswers++;
        }
        
        playerResults.push({
            id: player.id,
            name: player.name,
            score: player.score,
            answer: answer,
            responseTime: responseTime,
            isCorrect: answer === correctIndex,
            isSkipped: answer === undefined || answer === -1,
            totalResponseTime: player.totalResponseTime,
            questionsAnswered: player.questionsAnswered,
            correctAnswers: player.correctAnswers,
            incorrectAnswers: player.incorrectAnswers,
            skippedAnswers: player.skippedAnswers
        });
    });
    
    // Sort correct answerers by response time (fastest first) and add speed bonus
    correctAnswerers.sort((a, b) => (a.responseTime || Infinity) - (b.responseTime || Infinity));
    
    // Award speed bonuses to correct answerers
    correctAnswerers.forEach((item, index) => {
        if (item.responseTime !== null) {
            // Speed bonus: 1st=+10, 2nd=+5, 3rd=+2, others=+0
            let speedBonus = 0;
            if (index === 0) speedBonus = 10;      // 1st place
            else if (index === 1) speedBonus = 5;  // 2nd place  
            else if (index === 2) speedBonus = 2;  // 3rd place
            
            item.player.score += speedBonus;
            
            // Update the playerResults with the new score
            const result = playerResults.find(r => r.id === item.player.id);
            if (result) {
                result.score = item.player.score;
                result.speedBonus = speedBonus;
                result.rank = index + 1; // Speed ranking among correct answerers
            }
        }
    });

    // Find the fastest correct answerer
    const fastestCorrect = correctAnswerers.length > 0 ? correctAnswerers[0] : null;
    
    // Calculate statistics for host display
    const totalAnswered = room.players.filter(p => room.answers[p.id] !== undefined).length;
    const correctAnswerCount = correctAnswerers.length;
    const averageResponseTime = correctAnswerers.length > 0 
        ? correctAnswerers.reduce((sum, item) => sum + (item.responseTime || 0), 0) / correctAnswerers.length
        : 0;

    io.to(roomCode).emit('round_result', {
        correctIndex: correctIndex,
        players: room.players,
        playerResults: playerResults,
        fastestCorrect: fastestCorrect ? {
            name: fastestCorrect.player.name,
            responseTime: fastestCorrect.responseTime
        } : null,
        roundStats: {
            totalPlayers: room.players.length,
            totalAnswered: totalAnswered,
            correctAnswers: correctAnswerCount,
            averageResponseTime: averageResponseTime
        }
    });
}

function endGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    room.status = 'GAME_OVER';
    io.to(roomCode).emit('game_over', { players: room.players });
    
    // Cleanup after delay
    setTimeout(() => {
        if (rooms[roomCode]) {
            delete rooms[roomCode];
        }
    }, 3600000); // 1 hour timeout just in case
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});