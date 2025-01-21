const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require("path")

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: true
});

app.use(cors());

let games = {};

const quizBank = [
    {
        question: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAK1JREFUOE9jZKAQMKLrX1ju8R+fmfGdO1D0oHBAmtn//cLrpp9MbAzIhsANIEYzzGRkQ7AaEDvhMNwViwtsGdD5WA1gZWXF63d0f/3+/RtsOfVcQNUwIJQ0CAYizAD0wMMbCyBJYryBMx3ATMdnCLrme+1G/zGSMswl2MIBOQWCNKNEI0wDofQAin+YZqXKc4xwF4AE1esuE4oAsPzNJl0GkGYUF5BiACwVggwAALr2dT2+TkdgAAAAAElFTkSuQmCC",
        options: ["3", "4", "5", "6"],
        answer: "4",
        image: "images/cat.jpg"
    },
    {
        question: "What is 5 x 5?",
        options: ["20", "25", "30", "35"],
        answer: "25"
    },
    {
        question: "What is 10 - 3?",
        options: ["5", "6", "7", "8"],
        answer: "7"
    },
    {
        question: "What is 12 ÷ 3?",
        options: ["2", "3", "4", "5"],
        answer: "4"
    },
    {
        question: "What is 7 + 8?",
        options: ["13", "14", "15", "16"],
        answer: "15"
    }
];

function checkWin(board) {
    // Check rows
    for (let i = 0; i < 3; i++) {
        if (board[i][0] && board[i][0] === board[i][1] && board[i][0] === board[i][2]) {
            return board[i][0];
        }
    }
    // Check columns
    for (let i = 0; i < 3; i++) {
        if (board[0][i] && board[0][i] === board[1][i] && board[0][i] === board[2][i]) {
            return board[0][i];
        }
    }
    // Check diagonals
    if (board[0][0] && board[0][0] === board[1][1] && board[0][0] === board[2][2]) {
        return board[0][0];
    }
    if (board[0][2] && board[0][2] === board[1][1] && board[0][2] === board[2][0]) {
        return board[0][2];
    }
    // Check for draw
    const isDraw = board.every(row => row.every(cell => cell !== null));
    if (isDraw) return 'draw';
    return null;
}

app.use('/images', express.static(path.join(__dirname, 'images')));
let unusedQuestions = [...quizBank]; // Copy of quizBank to track unused questions

function getRandomQuiz() {
    if (unusedQuestions.length === 0) {
        unusedQuestions = [...quizBank]; // Reset when all have been used
    }

    const randomIndex = Math.floor(Math.random() * unusedQuestions.length);
    const quiz = unusedQuestions.splice(randomIndex, 1)[0]; // Remove the selected question from unusedQuestions

    return quiz;
}



io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinGame', (room) => {
        socket.join(room);
        console.log(`${socket.id} joined room ${room}`);

        if (!games[room]) {
            games[room] = {
                board: Array(3).fill().map(() => Array(3).fill(null)),
                players: {},
                gameStarted: false,
                playerQuizzes: {},
                pendingMoves: {},
                winner: null
            };
        }

        const game = games[room];

        if (!game.players['X']) {
            game.players['X'] = socket.id;
            game.playerQuizzes['X'] = getRandomQuiz();
            socket.emit('playerAssigned', 'X');
            socket.emit('newQuiz', game.playerQuizzes['X']);
        } else if (!game.players['O']) {
            game.players['O'] = socket.id;
            game.playerQuizzes['O'] = getRandomQuiz();
            socket.emit('playerAssigned', 'O');
            socket.emit('newQuiz', game.playerQuizzes['O']);
            game.gameStarted = true;
            io.to(room).emit('gameStarted');
        } else {
            socket.emit('playerAssigned', 'spectator');
        }

        io.to(room).emit('gameState', {
            board: game.board,
            gameStarted: game.gameStarted,
            playersCount: Object.keys(game.players).length,
            winner: game.winner
        });
    });

    socket.on('attemptMove', ({ room, row, col, player }) => {
        const game = games[room];
        if (!game || !game.gameStarted || game.winner) return;
        if (game.board[row][col] !== null) return;

        game.pendingMoves[player] = { row, col };
        socket.emit('moveRegistered');
    });

    socket.on('answerQuiz', ({ room, answer, player }) => {
        const game = games[room];
        if (!game || !game.pendingMoves[player] || game.winner) return;

        const playerQuiz = game.playerQuizzes[player];
        if (answer === playerQuiz.answer) {
            const { row, col } = game.pendingMoves[player];
            const newBoard = game.board.map(row => [...row]);
            newBoard[row][col] = player;
            game.board = newBoard;

            // Check for win or draw
            const gameResult = checkWin(game.board);
            if (gameResult) {
                game.winner = gameResult;
                game.gameStarted = false;
                io.to(room).emit('gameOver', gameResult);
            }

            // Generate new quiz for the player
            game.playerQuizzes[player] = getRandomQuiz();
            socket.emit('newQuiz', game.playerQuizzes[player]);
            
            io.to(room).emit('gameState', {
                board: game.board,
                gameStarted: game.gameStarted,
                playersCount: Object.keys(game.players).length,
                winner: game.winner
            });
            socket.emit('quizResult', true);
        } else {
            socket.emit('quizResult', false);
        }
        delete game.pendingMoves[player];
    });



    socket.on('disconnect', () => {
        Object.entries(games).forEach(([room, game]) => {
            Object.entries(game.players).forEach(([symbol, playerId]) => {
                if (playerId === socket.id) {
                    delete game.players[symbol];
                    delete game.playerQuizzes[symbol];
                    game.gameStarted = false;
                    game.winner = 'disconnect';
                    io.to(room).emit('playerDisconnected', symbol);
                    io.to(room).emit('gameState', {
                        board: game.board,
                        gameStarted: false,
                        playersCount: Object.keys(game.players).length,
                        winner: game.winner
                    });
                }
            });
        });
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});